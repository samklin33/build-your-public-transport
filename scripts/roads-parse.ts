/**
 * 把 Overpass 的回應轉成精簡的道路 GeoJSON。
 *
 * 這一支跟網路存取分開，是為了能單獨測試 —— 開發環境連不到 Overpass，
 * 但解析邏輯可以用真實的 Overpass 輸出樣本驗證。
 */

/**
 * 要抓的道路等級。只取幹道：巷弄對「捷運能不能蓋」「公車走哪條路」沒有意義，
 * 抓進來只會讓資料量爆掉。
 *   motorway  國道、快速道路
 *   trunk     省道等級的主要幹道
 *   primary   市區主要道路（忠孝東路、中山北路…）
 *   secondary 次要幹道
 *   tertiary  地區性聯絡道
 */
export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'motorway_link',
  'trunk_link',
  'primary_link',
] as const;

export interface RoadProps {
  /** OSM 的 highway 等級。 */
  highway: string;
  name?: string;
  /** 車道數。判斷「路夠不夠寬蓋高架」的主要依據。 */
  lanes?: number;
  /** 路寬（公尺），OSM 上有標的不多。 */
  width?: number;
  /** 是否單行道。 */
  oneway?: boolean;
}

export interface RoadFeature {
  type: 'Feature';
  properties: RoadProps;
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface RoadCollection {
  type: 'FeatureCollection';
  features: RoadFeature[];
}

/** OSM 的 lanes/width 標記常常是 "2;3"、"4.5 m"、"2" 這種，統一抽出數字。 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return undefined;
  const m = v.match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

type OverpassElement = {
  type?: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

type OverpassJson = { elements?: OverpassElement[] };

/** 從 Overpass 的 JSON（out geom）解析。 */
export function parseOverpassRoads(raw: unknown): RoadCollection {
  const data = raw as OverpassJson;
  if (!data || !Array.isArray(data.elements)) {
    throw new Error('Overpass 回應沒有 elements 陣列');
  }

  const features: RoadFeature[] = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const highway = tags.highway;
    if (!highway) continue;

    const coords: [number, number][] = el.geometry.map((g) => [
      round5(g.lon),
      round5(g.lat),
    ]);

    features.push({
      type: 'Feature',
      properties: cleanProps({
        highway,
        name: tags.name,
        lanes: num(tags.lanes),
        width: num(tags.width),
        oneway: tags.oneway === 'yes' ? true : undefined,
      }),
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * 也接受 overpass-turbo 匯出的 GeoJSON（FeatureCollection），
 * 讓連不到 API 的人可以手動匯出後直接放進來。
 */
export function parseOverpassGeoJson(raw: unknown): RoadCollection {
  const data = raw as {
    type?: string;
    features?: {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    }[];
  };
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('不是 GeoJSON FeatureCollection');
  }

  const features: RoadFeature[] = [];
  for (const f of data.features) {
    if (f.geometry?.type !== 'LineString') continue;
    const raw = f.geometry.coordinates;
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const p = f.properties ?? {};
    const highway = typeof p.highway === 'string' ? p.highway : undefined;
    if (!highway) continue;

    const coords = raw.map((c) => {
      const pair = c as [number, number];
      return [round5(pair[0]), round5(pair[1])] as [number, number];
    });

    features.push({
      type: 'Feature',
      properties: cleanProps({
        highway,
        name: typeof p.name === 'string' ? p.name : undefined,
        lanes: num(p.lanes),
        width: num(p.width),
        oneway: p.oneway === 'yes' ? true : undefined,
      }),
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  return { type: 'FeatureCollection', features };
}

function cleanProps(p: RoadProps): RoadProps {
  const out: RoadProps = { highway: p.highway };
  if (p.name) out.name = p.name;
  if (p.lanes !== undefined) out.lanes = p.lanes;
  if (p.width !== undefined) out.width = p.width;
  if (p.oneway) out.oneway = p.oneway;
  return out;
}

// ─────────────────────────────────────────── 道路分級

/**
 * 遊戲只分兩級。OSM 的六種 highway 等級對規劃決策而言分太細了，
 * 真正要回答的問題只有「這條路撐不撐得起軌道運輸」。
 *
 *   0 幹道     trunk / primary —— 夠寬，高架可行
 *   1 次要道路 secondary / tertiary —— 公車可走，高架勉強
 *
 * residential / unclassified（巷弄）整個不收：對路網規劃沒有意義，
 * 而且佔了雙北 8,635 條路、12 萬個座標點。
 */
export type RoadClass = 0 | 1;

export interface Road {
  cls: RoadClass;
  name: string;
  /** 折線，扁平化的 [lon,lat,lon,lat,...]。 */
  path: number[];
}

/** game-project 的 tier 是由 OSM highway 等級推出來的，這裡對應回道路分級。 */
const TIER_TO_CLASS: Record<string, RoadClass | undefined> = {
  easy: 0, // trunk / primary
  medium: 1, // secondary / tertiary
  hard: undefined, // residential / unclassified：巷弄，不收
};

type NamedRoadFeature = {
  properties?: { name?: unknown; tier?: unknown };
  geometry?: { type?: string; coordinates?: unknown };
};

/**
 * 解析 samklin33/game-project 產出的道路 GeoJSON。
 *
 * 那份資料是「找路」那個遊戲用的，一條路名一個 MultiLineString，
 * 已經由 Overpass 抓好並 commit 進 repo。對這裡來說剛好可以直接用：
 * 範圍正好是雙北，而且 tier 欄位可以對應回道路等級。
 */
export function parseNamedRoads(raw: unknown, simplifyToleranceM = 10): Road[] {
  const data = raw as { type?: string; features?: NamedRoadFeature[] };
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('不是 GeoJSON FeatureCollection');
  }

  const out: Road[] = [];
  for (const f of data.features) {
    const cls = TIER_TO_CLASS[String(f.properties?.tier ?? '')];
    if (cls === undefined) continue;
    if (f.geometry?.type !== 'MultiLineString') continue;
    const name = typeof f.properties?.name === 'string' ? f.properties.name : '';

    const lines = f.geometry.coordinates as [number, number][][];
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) continue;
      const simplified = simplifyPath(line, simplifyToleranceM);
      if (simplified.length < 2) continue;
      const flat: number[] = [];
      for (const [lon, lat] of simplified) flat.push(round5(lon), round5(lat));
      out.push({ cls, name, path: flat });
    }
  }
  return out;
}

/**
 * Douglas–Peucker 簡化。道路為了畫出彎道會帶很多點，
 * 但在這個遊戲的縮放層級下 10 公尺的偏差看不出來 ——
 * 雙北的幹道與次要道路可以從 11 萬點降到 3.4 萬點。
 *
 * 用迭代而非遞迴，避免長路徑爆堆疊。
 */
export function simplifyPath(
  pts: [number, number][],
  toleranceM: number,
): [number, number][] {
  if (pts.length < 3) return pts;
  // 在台灣的緯度，1 度約 105 km（經緯平均），把公尺容差換算成度
  const eps = toleranceM / 1000 / 105;

  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];

  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b <= a + 1) continue;
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const den = Math.hypot(dx, dy);

    let best = 0;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const d =
        den > 0
          ? Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / den
          : Math.hypot(x - x1, y - y1);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps && bi > 0) {
      keep[bi] = true;
      stack.push([a, bi], [bi, b]);
    }
  }

  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/**
 * 每一種道路等級的預設車道數，給沒有標 lanes 的路段用。
 * 判斷「這條路蓋得了高架嗎」時要有個依據，沒標就不能當作沒有。
 */
export const DEFAULT_LANES: Record<string, number> = {
  motorway: 6,
  trunk: 6,
  primary: 4,
  secondary: 4,
  tertiary: 2,
  motorway_link: 2,
  trunk_link: 2,
  primary_link: 2,
};

/** 推估路寬（公尺）：有標就用標的，否則用車道數 × 3.5 加上人行道。 */
export function estimateWidthM(p: RoadProps): number {
  if (p.width !== undefined && p.width > 0) return p.width;
  const lanes = p.lanes ?? DEFAULT_LANES[p.highway] ?? 2;
  return lanes * 3.5 + 4;
}
