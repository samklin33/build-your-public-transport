import { kmBetween } from '../model/geo';
import type {
  CityPack,
  Finance,
  LineResult,
  Network,
  SegmentLoad,
  SimParams,
  SimResult,
  StationResult,
} from '../model/types';
import { Dijkstra } from './dijkstra';
import { buildTransitGraph, type TransitGraph } from './graph';

/** 每個 zone 最多連接幾個車站。超過的話多半只是繞路，留太多只會拖慢計算。 */
const MAX_ACCESS_STATIONS = 6;

/**
 * 與路網無關、只需算一次的資料。worker 會把它快取起來，
 * 玩家每次改線時只重跑 simulate()，不用重建這些。
 */
export interface SimContext {
  pack: CityPack;
  zoneCount: number;
  lon: Float64Array;
  lat: Float64Array;
  population: Float64Array;
  /** 每組起訖對的實際行駛距離（公里，已含繞路係數），與 baseOD 的 dest/flow 同索引。 */
  carDistKm: Float32Array;
  totalPeakTrips: number;
  /** 完全沒有大眾運輸時的平均旅行時間 —— 拿來當「改善了多少」的基準。 */
  baselineTimeMin: number;
  /** 完全沒有大眾運輸時的道路速度（km/h）。 */
  baselineCarSpeedKmh: number;
}

/**
 * BPR 型的壅塞函數：路上的車越多，大家開得越慢。
 * 這是大眾運輸真正創造價值的機制 —— 把人從道路移走，留在路上的人也受益。
 */
export function congestedCarSpeed(p: SimParams, peakCarTrips: number): number {
  const ratio = peakCarTrips / p.roadCapacityPeakTrips;
  return p.carFreeFlowSpeedKmh / (1 + p.congestionAlpha * ratio ** p.congestionBeta);
}

export function createSimContext(pack: CityPack): SimContext {
  const zones = pack.zones;
  const n = zones.length;
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const population = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = zones[i].lon;
    lat[i] = zones[i].lat;
    population[i] = zones[i].population;
  }

  const { rowStart, dest, flow } = pack.baseOD;
  const p = pack.simParams;
  const carDistKm = new Float32Array(dest.length);

  let totalPeakTrips = 0;
  let weightedKm = 0;
  for (let i = 0; i < n; i++) {
    for (let k = rowStart[i]; k < rowStart[i + 1]; k++) {
      const j = dest[k];
      const km = kmBetween(lon[i], lat[i], lon[j], lat[j]) * p.detourFactor;
      carDistKm[k] = km;
      totalPeakTrips += flow[k];
      weightedKm += flow[k] * km;
    }
  }

  // 基準情境：完全沒有大眾運輸，所有旅次都上路，道路最塞。
  const baselineCarSpeedKmh = congestedCarSpeed(p, totalPeakTrips);

  return {
    pack,
    zoneCount: n,
    lon,
    lat,
    population,
    carDistKm,
    totalPeakTrips,
    baselineTimeMin:
      totalPeakTrips > 0 ? ((weightedKm / totalPeakTrips) / baselineCarSpeedKmh) * 60 : 0,
    baselineCarSpeedKmh,
  };
}

/** 每個 zone 步行可及的車站清單（扁平化的 CSR）。 */
interface AccessIndex {
  start: Int32Array;
  station: Int32Array;
  walkMin: Float32Array;
}

function buildAccessIndex(ctx: SimContext, g: TransitGraph): AccessIndex {
  const n = ctx.zoneCount;
  const maxKm = ctx.pack.simParams.maxWalkM / 1000;
  const walkMinPerKm = 60 / ctx.pack.simParams.walkSpeedKmh;

  const start = new Int32Array(n + 1);
  const stationOut: number[] = [];
  const walkOut: number[] = [];

  const candIdx: number[] = [];
  const candKm: number[] = [];

  for (let i = 0; i < n; i++) {
    start[i] = stationOut.length;
    candIdx.length = 0;
    candKm.length = 0;

    for (let s = 0; s < g.stationCount; s++) {
      const km = kmBetween(ctx.lon[i], ctx.lat[i], g.stationLon[s], g.stationLat[s]);
      if (km <= maxKm) {
        candIdx.push(s);
        candKm.push(km);
      }
    }

    // 只留最近的幾個
    if (candIdx.length > MAX_ACCESS_STATIONS) {
      const order = candIdx.map((_, k) => k).sort((a, b) => candKm[a] - candKm[b]);
      order.length = MAX_ACCESS_STATIONS;
      for (const k of order) {
        stationOut.push(candIdx[k]);
        walkOut.push(candKm[k] * walkMinPerKm);
      }
    } else {
      for (let k = 0; k < candIdx.length; k++) {
        stationOut.push(candIdx[k]);
        walkOut.push(candKm[k] * walkMinPerKm);
      }
    }
  }
  start[n] = stationOut.length;

  return {
    start,
    station: Int32Array.from(stationOut),
    walkMin: Float32Array.from(walkOut),
  };
}

export function simulate(ctx: SimContext, network: Network): SimResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const pack = ctx.pack;
  const p = pack.simParams;
  const g = buildTransitGraph(network, p, pack.costModel);

  const n = ctx.zoneCount;
  const zoneAccessMin = new Float32Array(n).fill(Infinity);
  const zoneCovered = new Uint8Array(n);

  const emptyResult = (): SimResult => ({
    peakTransitTrips: 0,
    dailyTransitTrips: 0,
    modeShare: 0,
    avgTransitTimeMin: 0,
    avgAllTimeMin: ctx.baselineTimeMin,
    baselineTimeMin: ctx.baselineTimeMin,
    coveredPopulation: 0,
    coveragePct: 0,
    stations: {},
    lines: [],
    segments: [],
    finance: emptyFinance(),
    zoneAccessMin,
    zoneCovered,
    computeMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  });

  if (g.stationCount === 0) return emptyResult();

  const access = buildAccessIndex(ctx, g);
  for (let i = 0; i < n; i++) {
    if (access.start[i + 1] > access.start[i]) zoneCovered[i] = 1;
  }

  const S = g.stationCount;
  const solver = new Dijkstra(g);

  // ── 第一階段：站到站的最短旅行時間矩陣
  //
  // 從「車站」而不是從「zone」出發跑 Dijkstra，是整個模擬能跑得快的關鍵：
  // 車站數是幾百，zone 數是 1465，差了一個數量級。
  const T = new Float32Array(S * S);
  for (let s = 0; s < S; s++) {
    solver.run(s);
    const base = s * S;
    for (let t = 0; t < S; t++) {
      // 扣掉一次轉乘罰值：每條路徑最後一次下車都會付到，那是常數項。
      const d = solver.dist[t];
      T[base + t] = d === Infinity ? Infinity : Math.max(0, d - p.transferPenaltyMin);
    }
  }

  // ── 第二階段之一：每組起訖對的最佳大眾運輸時間與進出站
  // 這一段只跟路網有關，與道路壅塞無關，所以在壅塞疊代之外算一次就好。
  const { rowStart, dest, flow } = pack.baseOD;
  const pairCount = dest.length;
  const bestFrom = new Int32Array(pairCount).fill(-1);
  const bestTo = new Int32Array(pairCount).fill(-1);
  const bestTransitMin = new Float32Array(pairCount).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const aStart = access.start[i];
    const aEnd = access.start[i + 1];
    if (aEnd === aStart) continue;

    for (let k = rowStart[i]; k < rowStart[i + 1]; k++) {
      const j = dest[k];
      const bStart = access.start[j];
      const bEnd = access.start[j + 1];
      let best = Infinity;
      let bs = -1;
      let bt = -1;

      for (let a = aStart; a < aEnd; a++) {
        const s = access.station[a];
        const wIn = access.walkMin[a];
        if (wIn >= best) continue;
        const base = s * S;
        for (let b = bStart; b < bEnd; b++) {
          const t = access.station[b];
          // 進出站同一站表示根本沒搭到車，只是走路過去。
          // 不排除的話這種「旅次」會被算成大眾運輸運量，讓總運量高於各線上車數總和。
          if (t === s) continue;
          const ride = T[base + t];
          if (ride === Infinity) continue;
          const total = wIn + ride + access.walkMin[b];
          if (total < best) {
            best = total;
            bs = s;
            bt = t;
          }
        }
      }
      bestTransitMin[k] = best;
      bestFrom[k] = bs;
      bestTo[k] = bt;
    }
  }

  // ── 第二階段之二：運具選擇，與道路壅塞互相迭代到穩定
  //
  // 搭乘大眾運輸的人越多 → 路上的車越少 → 開車越快 → 又有人選擇開車。
  // 這是個互相影響的迴圈，跑幾次就會收斂。
  const transitFlow = new Float32Array(pairCount);
  let carSpeed = ctx.baselineCarSpeedKmh;
  let peakTransitTrips = 0;

  for (let iter = 0; iter < 4; iter++) {
    const minPerKm = 60 / carSpeed;
    peakTransitTrips = 0;
    for (let k = 0; k < pairCount; k++) {
      const best = bestTransitMin[k];
      if (best === Infinity) {
        transitFlow[k] = 0;
        continue;
      }
      const carT = ctx.carDistKm[k] * minPerKm;
      const share =
        1 / (1 + Math.exp(p.logitConstant + p.logitTimeCoef * (best - carT)));
      const tf = flow[k] * share;
      transitFlow[k] = tf;
      peakTransitTrips += tf;
    }
    const newSpeed = congestedCarSpeed(p, ctx.totalPeakTrips - peakTransitTrips);
    if (Math.abs(newSpeed - carSpeed) < 0.01) {
      carSpeed = newSpeed;
      break;
    }
    carSpeed = newSpeed;
  }

  // ── 依最終的運具分配彙整時間指標
  const finalMinPerKm = 60 / carSpeed;
  let weightedTransitTime = 0;
  let weightedAllTime = 0;
  const zoneFlowSum = new Float64Array(n);
  const zoneTimeSum = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (let k = rowStart[i]; k < rowStart[i + 1]; k++) {
      const f = flow[k];
      const tf = transitFlow[k];
      const carT = ctx.carDistKm[k] * finalMinPerKm;
      if (tf > 0) {
        const best = bestTransitMin[k];
        weightedTransitTime += tf * best;
        weightedAllTime += tf * best;
        zoneFlowSum[i] += tf;
        zoneTimeSum[i] += tf * best;
      }
      // bestTransitMin 在無服務時是 Infinity，這裡必須避開 0 × Infinity = NaN。
      weightedAllTime += (f - tf) * carT;
    }
  }

  for (let i = 0; i < n; i++) {
    if (zoneFlowSum[i] > 0) zoneAccessMin[i] = zoneTimeSum[i] / zoneFlowSum[i];
  }

  // ── 第三階段：路網指派
  //
  // 依「進站車站」把起訖對分組，這樣每個車站只需要再跑一次 Dijkstra
  // 就能追溯它所有起訖對的路徑，不必把所有起點的前驅陣列都存下來。
  const segmentLoad = new Float64Array(g.segmentCount);
  const boardings = new Float64Array(S);
  const alightings = new Float64Array(S);
  const transfersAt = new Float64Array(S);
  const lineBoardings = new Float64Array(network.lines.length);

  const pairsByOrigin = groupPairsByOrigin(bestFrom, transitFlow, S);
  const boardStationBuf: number[] = [];

  for (let s = 0; s < S; s++) {
    const list = pairsByOrigin[s];
    if (!list || list.length === 0) continue;
    solver.run(s);

    for (const k of list) {
      const f = transitFlow[k];
      if (f <= 0) continue;
      const target = bestTo[k];
      boardings[s] += f;
      alightings[target] += f;
      tracePath(
        g,
        solver.prevEdge,
        s,
        target,
        f,
        segmentLoad,
        lineBoardings,
        transfersAt,
        boardStationBuf,
      );
    }
  }

  // ── 指標彙整
  const dailyFactor = 1 / p.peakHourShare;
  const dailyTransitTrips = peakTransitTrips * dailyFactor;

  let coveredPopulation = 0;
  for (let i = 0; i < n; i++) if (zoneCovered[i]) coveredPopulation += ctx.population[i];
  const totalPopulation = ctx.population.reduce((a, b) => a + b, 0);

  const stations: Record<string, StationResult> = {};
  for (let s = 0; s < S; s++) {
    stations[g.stationIds[s]] = {
      boardings: boardings[s],
      alightings: alightings[s],
      transfers: transfersAt[s],
    };
  }

  const segments: SegmentLoad[] = [];
  for (let i = 0; i < g.segmentCount; i++) {
    const load = segmentLoad[i];
    if (load <= 0) continue;
    segments.push({
      lineId: g.lineIds[g.segmentLineIdx[i]],
      fromStationId: g.stationIds[g.segmentFrom[i]],
      toStationId: g.stationIds[g.segmentTo[i]],
      load,
      loadFactor: load / g.segmentCapacity[i],
    });
  }

  const { lines, finance } = summariseLines(
    ctx,
    g,
    network,
    segmentLoad,
    lineBoardings,
    dailyFactor,
    dailyTransitTrips,
  );

  return {
    peakTransitTrips,
    dailyTransitTrips,
    modeShare: ctx.totalPeakTrips > 0 ? peakTransitTrips / ctx.totalPeakTrips : 0,
    avgTransitTimeMin:
      peakTransitTrips > 0 ? weightedTransitTime / peakTransitTrips : 0,
    avgAllTimeMin: ctx.totalPeakTrips > 0 ? weightedAllTime / ctx.totalPeakTrips : 0,
    baselineTimeMin: ctx.baselineTimeMin,
    coveredPopulation,
    coveragePct: totalPopulation > 0 ? coveredPopulation / totalPopulation : 0,
    stations,
    lines,
    segments,
    finance,
    zoneAccessMin,
    zoneCovered,
    computeMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

function groupPairsByOrigin(
  bestFrom: Int32Array,
  transitFlow: Float32Array,
  S: number,
): number[][] {
  const groups: number[][] = new Array(S);
  for (let k = 0; k < bestFrom.length; k++) {
    const s = bestFrom[k];
    if (s < 0 || transitFlow[k] <= 0) continue;
    (groups[s] ??= []).push(k);
  }
  return groups;
}

/**
 * 從終點沿前驅邊回溯到起點，把流量攤到沿途的每個路段上。
 *
 * 回溯是「終點 → 起點」的方向，所以遇到上車邊的順序跟實際行程相反。
 * 行程中第一次上車不算轉乘，之後每一次都算 —— 換算成回溯的順序，
 * 就是「除了最後遇到的那一次以外」的每一次上車都是轉乘。
 */
function tracePath(
  g: TransitGraph,
  prevEdge: Int32Array,
  source: number,
  target: number,
  f: number,
  segmentLoad: Float64Array,
  lineBoardings: Float64Array,
  transfersAt: Float64Array,
  boardStationBuf: number[],
): void {
  let node = target;
  let guard = 0;
  const limit = g.nodeCount + 8;
  boardStationBuf.length = 0;

  while (node !== source && guard++ < limit) {
    const e = prevEdge[node];
    if (e < 0) return; // 不可達，理論上不會發生
    const from = g.edgeFrom[e];
    const seg = g.edgeSegment[e];

    if (seg >= 0) {
      segmentLoad[seg] += f;
    } else if (from < g.stationCount) {
      // 車站 → 月台：在 from 這一站上了 node 所屬的那條線
      const lineIdx = g.nodeLine[node];
      if (lineIdx >= 0) lineBoardings[lineIdx] += f;
      boardStationBuf.push(from);
    }
    node = from;
  }

  // 回溯順序下，最後一個才是行程真正的起始上車站，其餘都是轉乘。
  for (let i = 0; i < boardStationBuf.length - 1; i++) {
    transfersAt[boardStationBuf[i]] += f;
  }
}

function emptyFinance(): Finance {
  return {
    totalBuildCost: 0,
    annualOpCost: 0,
    annualFareRevenue: 0,
    annualBalance: 0,
    subsidyPerTrip: 0,
    fareboxRecovery: 0,
  };
}

function summariseLines(
  ctx: SimContext,
  g: TransitGraph,
  network: Network,
  segmentLoad: Float64Array,
  lineBoardings: Float64Array,
  dailyFactor: number,
  dailyTransitTrips: number,
): { lines: LineResult[]; finance: Finance } {
  const cm = ctx.pack.costModel;
  const lines: LineResult[] = [];

  // 票價是「一趟旅次收一次」，不是「每上一次車收一次」。
  // 轉乘的旅客會在多條線各記一次上車，直接把各線上車數乘票價會重複計算，
  // 因此總收入用旅次數算，再依各線上車佔比分攤給各線。
  let totalBoardings = 0;
  for (let i = 0; i < lineBoardings.length; i++) totalBoardings += lineBoardings[i];
  const totalRevenue = (dailyTransitTrips * cm.farePerTrip * 365) / 1e8;

  let totalBuild = 0;
  let totalOp = 0;

  network.lines.forEach((line, idx) => {
    const spec = cm.modes[line.mode];
    const km = g.lineKm[idx];
    const stops = g.lineStops[idx];

    let maxLoad = 0;
    let maxLoadFactor = 0;
    for (let i = 0; i < g.segmentCount; i++) {
      if (g.segmentLineIdx[i] !== idx) continue;
      if (segmentLoad[i] > maxLoad) maxLoad = segmentLoad[i];
      const lf = segmentLoad[i] / g.segmentCapacity[i];
      if (lf > maxLoadFactor) maxLoadFactor = lf;
    }

    const buildCost = km * spec.buildCostPerKm + stops * spec.stationCost;

    // 每日車公里 = 路線長度 × 2（往返）× 每日班次
    const headway = Math.max(
      spec.minHeadwaySec,
      Math.min(spec.maxHeadwaySec, line.headwaySec),
    );
    const runsPerDay = (cm.serviceHoursPerDay * 3600) / headway;
    const vehKmPerDay = km * 2 * runsPerDay;
    const annualOpCost = (vehKmPerDay * spec.opCostPerVehKm * 365) / 1e8;

    const ridership = lineBoardings[idx];
    const dailyRidership = ridership * dailyFactor;
    const annualFareRevenue =
      totalBoardings > 0 ? (totalRevenue * ridership) / totalBoardings : 0;

    totalBuild += buildCost;
    totalOp += annualOpCost;

    lines.push({
      lineId: line.id,
      ridership,
      dailyRidership,
      lengthKm: km,
      maxLoad,
      maxLoadFactor,
      buildCost,
      annualOpCost,
      annualFareRevenue,
    });
  });

  const annualBalance = totalRevenue - totalOp;
  const annualTrips = dailyTransitTrips * 365;

  return {
    lines,
    finance: {
      totalBuildCost: totalBuild,
      annualOpCost: totalOp,
      annualFareRevenue: totalRevenue,
      annualBalance,
      subsidyPerTrip: annualTrips > 0 ? (-annualBalance * 1e8) / annualTrips : 0,
      fareboxRecovery: totalOp > 0 ? totalRevenue / totalOp : 0,
    },
  };
}
