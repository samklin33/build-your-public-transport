import { create } from 'zustand';
import { kmBetween } from '../model/geo';
import {
  cloneNetwork,
  emptyNetwork,
  findNearestStation,
  nextId,
  nextLineColor,
  nextLineName,
  packNetworkToNetwork,
  pruneOrphanStations,
} from '../model/network';
import type {
  CityPack,
  Line,
  Network,
  SimResult,
  TransitMode,
} from '../model/types';
import { prepareCity, type PreparedCity } from '../render/prepare';
import SimWorker from '../sim/worker?worker&inline';
import { createSimContext, simulate, type SimContext } from '../sim/simulate';
import type { WorkerRequest, WorkerResponse } from '../sim/worker';

export type Scenario = 'blank' | 'extend';
export type Overlay = 'density' | 'coverage' | 'access' | 'none';
export type Tool = 'select' | 'draw';

interface State {
  pack: CityPack | null;
  prepared: PreparedCity | null;
  loadError: string | null;

  scenario: Scenario;
  network: Network;
  result: SimResult | null;
  simulating: boolean;

  tool: Tool;
  drawMode: TransitMode;
  /** 正在繪製中的路線站點。 */
  draft: string[];
  selectedLineId: string | null;
  hoverStationId: string | null;

  overlay: Overlay;
  showRidership: boolean;

  init: () => Promise<void>;
  setScenario: (s: Scenario) => void;
  setTool: (t: Tool) => void;
  setDrawMode: (m: TransitMode) => void;
  addDraftPoint: (lon: number, lat: number, snapKm: number) => void;
  undoDraftPoint: () => void;
  finishDraft: () => void;
  cancelDraft: () => void;
  selectLine: (id: string | null) => void;
  setHoverStation: (id: string | null) => void;
  setLineHeadway: (id: string, sec: number) => void;
  renameLine: (id: string, name: string) => void;
  deleteLine: (id: string) => void;
  setOverlay: (o: Overlay) => void;
  toggleRidership: () => void;
  loadRealNetwork: () => void;
  exportJson: () => string;
  importJson: (text: string) => void;
}

let worker: Worker | null = null;
/**
 * Worker 建不起來時的退路（某些嚴格的 CSP 環境會擋掉 blob: worker）。
 * 全網模擬只要 50–70ms，直接在主執行緒跑也不會卡住畫面，
 * 有這條退路就不會因為執行環境的限制整個玩不了。
 */
let fallbackCtx: SimContext | null = null;
let seq = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** 玩家連續編輯時不需要每一筆都重算，等操作停下來再跑。 */
const SIM_DEBOUNCE_MS = 220;

function scheduleSim(get: () => State, set: (p: Partial<State>) => void) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const { network } = get();
    seq += 1;

    if (worker) {
      set({ simulating: true });
      const msg: WorkerRequest = { type: 'simulate', network, seq };
      worker.postMessage(msg);
      return;
    }

    if (fallbackCtx) {
      set({ simulating: true });
      const mySeq = seq;
      // 讓出一次事件迴圈，「計算中」的狀態才有機會畫出來
      setTimeout(() => {
        try {
          const result = simulate(fallbackCtx!, network);
          if (mySeq === seq) set({ result, simulating: false });
        } catch (err) {
          set({
            loadError: err instanceof Error ? err.message : String(err),
            simulating: false,
          });
        }
      }, 0);
    }
  }, SIM_DEBOUNCE_MS);
}

export const useStore = create<State>((set, get) => ({
  pack: null,
  prepared: null,
  loadError: null,

  scenario: 'blank',
  network: emptyNetwork(),
  result: null,
  simulating: false,

  tool: 'draw',
  drawMode: 'metro_underground',
  draft: [],
  selectedLineId: null,
  hoverStationId: null,

  overlay: 'density',
  showRidership: true,

  async init() {
    try {
      let pack: CityPack;
      if (__INLINE_PACK__) {
        // 單檔版：城市資料直接打包進 bundle，整個遊戲一個 HTML 檔就能跑。
        const m = await import('../../public/city-packs/taipei.json');
        pack = m.default as unknown as CityPack;
      } else {
        const res = await fetch(`${import.meta.env.BASE_URL}city-packs/taipei.json`);
        if (!res.ok) throw new Error(`載入城市資料失敗（HTTP ${res.status}）`);
        pack = (await res.json()) as CityPack;
      }

      const prepared = prepareCity(pack);
      set({ pack, prepared });

      try {
        worker = new SimWorker();
        worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
          const m = ev.data;
          if (m.type === 'ready') {
            scheduleSim(get, set);
          } else if (m.type === 'result') {
            // 舊的計算結果晚到就丟掉，避免蓋掉比較新的結果。
            if (m.seq === seq) set({ result: m.result, simulating: false });
          } else if (m.type === 'error') {
            set({ loadError: m.message, simulating: false });
          }
        };
        worker.onerror = () => {
          // Worker 起不來就改用主執行緒，不要讓玩家卡在空畫面。
          worker?.terminate();
          worker = null;
          fallbackCtx ??= createSimContext(pack);
          scheduleSim(get, set);
        };
        const initMsg: WorkerRequest = { type: 'init', pack };
        worker.postMessage(initMsg);
      } catch {
        fallbackCtx = createSimContext(pack);
        scheduleSim(get, set);
      }
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  setScenario(s) {
    const { pack } = get();
    if (!pack) return;
    const network =
      s === 'extend' ? packNetworkToNetwork(pack.referenceNetwork) : emptyNetwork();
    set({ scenario: s, network, draft: [], selectedLineId: null, result: null });
    scheduleSim(get, set);
  },

  setTool(t) {
    set({ tool: t, draft: t === 'draw' ? get().draft : [] });
  },

  setDrawMode(m) {
    set({ drawMode: m });
  },

  addDraftPoint(lon, lat, snapKm) {
    const { network, draft, pack } = get();
    if (!pack) return;
    const next = cloneNetwork(network);

    const existing = findNearestStation(next, lon, lat, snapKm);
    let id: string;
    if (existing) {
      id = existing.id;
    } else {
      id = nextId('st');
      next.stations[id] = {
        id,
        name: stationNameAt(pack, next, lon, lat),
        lon,
        lat,
      };
    }
    // 連按同一站沒有意義，忽略。
    if (draft[draft.length - 1] === id) return;
    set({ network: next, draft: [...draft, id] });
  },

  undoDraftPoint() {
    const { draft, network } = get();
    if (draft.length === 0) return;
    const next = cloneNetwork(network);
    const nd = draft.slice(0, -1);
    set({ draft: nd });
    // 拿掉之後沒有任何路線或草稿用到的站
    const used = new Set(nd);
    for (const l of next.lines) for (const s of l.stationIds) used.add(s);
    for (const id of Object.keys(next.stations)) if (!used.has(id)) delete next.stations[id];
    set({ network: next });
  },

  finishDraft() {
    const { draft, network, drawMode, pack } = get();
    if (!pack) return;
    if (draft.length < 2) {
      get().cancelDraft();
      return;
    }
    const next = cloneNetwork(network);
    const line: Line = {
      id: nextId('line'),
      name: nextLineName(next, drawMode),
      color: nextLineColor(next),
      mode: drawMode,
      stationIds: [...draft],
      headwaySec: pack.costModel.modes[drawMode].defaultHeadwaySec,
    };
    next.lines.push(line);
    set({ network: next, draft: [], selectedLineId: line.id });
    scheduleSim(get, set);
  },

  cancelDraft() {
    const { network, draft } = get();
    if (draft.length === 0) return;
    const next = cloneNetwork(network);
    pruneOrphanStations(next);
    set({ network: next, draft: [] });
  },

  selectLine(id) {
    set({ selectedLineId: id });
  },

  setHoverStation(id) {
    if (get().hoverStationId !== id) set({ hoverStationId: id });
  },

  setLineHeadway(id, sec) {
    const next = cloneNetwork(get().network);
    const l = next.lines.find((x) => x.id === id);
    if (!l) return;
    l.headwaySec = sec;
    set({ network: next });
    scheduleSim(get, set);
  },

  renameLine(id, name) {
    const next = cloneNetwork(get().network);
    const l = next.lines.find((x) => x.id === id);
    if (!l) return;
    l.name = name;
    set({ network: next });
  },

  deleteLine(id) {
    const next = cloneNetwork(get().network);
    next.lines = next.lines.filter((l) => l.id !== id);
    pruneOrphanStations(next);
    set({
      network: next,
      selectedLineId: get().selectedLineId === id ? null : get().selectedLineId,
    });
    scheduleSim(get, set);
  },

  setOverlay(o) {
    set({ overlay: o });
  },

  toggleRidership() {
    set({ showRidership: !get().showRidership });
  },

  loadRealNetwork() {
    const { pack, network } = get();
    if (!pack) return;
    const real = packNetworkToNetwork(pack.referenceNetwork);
    const next = cloneNetwork(network);
    for (const [id, st] of Object.entries(real.stations)) next.stations[id] = st;
    // 已經載入過就不重複加。
    const have = new Set(next.lines.map((l) => l.id));
    for (const l of real.lines) if (!have.has(l.id)) next.lines.push(l);
    set({ network: next });
    scheduleSim(get, set);
  },

  exportJson() {
    const { network, scenario } = get();
    return JSON.stringify({ version: 1, city: 'taipei', scenario, network }, null, 2);
  },

  importJson(text) {
    try {
      const data = JSON.parse(text) as { network?: Network; scenario?: Scenario };
      if (!data.network || !data.network.stations || !data.network.lines) {
        throw new Error('檔案格式不符');
      }
      set({
        network: data.network,
        scenario: data.scenario ?? 'blank',
        draft: [],
        selectedLineId: null,
      });
      scheduleSim(get, set);
    } catch (err) {
      set({ loadError: `匯入失敗：${err instanceof Error ? err.message : String(err)}` });
    }
  },
}));

/** 新站以所在的里命名，重複的話加編號 —— 比「站1、站2」有地理感。 */
function stationNameAt(
  pack: CityPack,
  network: Network,
  lon: number,
  lat: number,
): string {
  let best = '新站';
  let bestKm = Infinity;
  for (const z of pack.zones) {
    const km = kmBetween(lon, lat, z.lon, z.lat);
    if (km < bestKm) {
      bestKm = km;
      best = z.name;
    }
  }
  const used = new Set(Object.values(network.stations).map((s) => s.name));
  if (!used.has(best)) return best;
  for (let i = 2; i < 100; i++) {
    const cand = `${best}${i}`;
    if (!used.has(cand)) return cand;
  }
  return best;
}
