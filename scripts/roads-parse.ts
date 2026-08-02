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
