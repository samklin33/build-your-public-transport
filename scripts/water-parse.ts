/**
 * 把 Overpass 的水域回應轉成精簡的多邊形。
 * 跟網路存取分開，才能單獨測試（開發環境連不到 Overpass）。
 */
import { simplifyPath } from './roads-parse';

export interface Water {
  name: string;
  /** 外環，扁平化的 [lon,lat,lon,lat,...]，首尾閉合。 */
  ring: number[];
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** 水域幾何可以簡化得比道路兇：河岸線本來就是模糊的。 */
const SIMPLIFY_M = 20;
/** 太小的水池（池塘、游泳池）對規劃沒有意義，濾掉以免資料量爆掉。 */
const MIN_AREA_KM2 = 0.01;

type Geom = { lat: number; lon: number };
type Member = { type?: string; role?: string; geometry?: Geom[] };
type Element = {
  type?: string;
  tags?: Record<string, string>;
  geometry?: Geom[];
  members?: Member[];
};

/** 環的面積（平方公里），用於濾掉小水池。 */
function ringAreaKm2(ring: number[]): number {
  let s = 0;
  for (let i = 0, n = ring.length - 2; i < n; i += 2) {
    s += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
  }
  const deg2 = Math.abs(s / 2);
  // 在台灣的緯度：1 度緯 ≈ 110.6 km、1 度經 ≈ 100.9 km
  return deg2 * 110.6 * 100.9;
}

function toRing(geometry: Geom[]): number[] | null {
  if (!Array.isArray(geometry) || geometry.length < 4) return null;
  const pts: [number, number][] = geometry
    .filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon))
    .map((g) => [g.lon, g.lat]);
  if (pts.length < 4) return null;

  const simplified = simplifyPath(pts, SIMPLIFY_M);
  if (simplified.length < 4) return null;

  const flat: number[] = [];
  for (const [lon, lat] of simplified) flat.push(round5(lon), round5(lat));
  // 閉合
  if (flat[0] !== flat[flat.length - 2] || flat[1] !== flat[flat.length - 1]) {
    flat.push(flat[0], flat[1]);
  }
  return flat;
}

/**
 * 解析 Overpass 的水域回應。
 *
 * way 直接就是一個環；relation（multipolygon）則取 role 為 outer 的成員，
 * 每個 outer way 各自成環。內環（島、沙洲）忽略 —— 對這個遊戲的尺度沒有影響，
 * 而且正確處理 multipolygon 的內外環配對複雜度遠高於它帶來的價值。
 */
export function parseOverpassWater(raw: unknown): Water[] {
  const data = raw as { elements?: Element[] };
  if (!data || !Array.isArray(data.elements)) {
    throw new Error('Overpass 回應沒有 elements 陣列');
  }

  const out: Water[] = [];
  for (const el of data.elements) {
    const name = el.tags?.name ?? '';

    if (el.type === 'way' && el.geometry) {
      const ring = toRing(el.geometry);
      if (ring && ringAreaKm2(ring) >= MIN_AREA_KM2) out.push({ name, ring });
      continue;
    }

    if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const m of el.members) {
        // 沒標 role 的成員在 multipolygon 裡預設當外環處理
        if (m.role && m.role !== 'outer') continue;
        if (!m.geometry) continue;
        const ring = toRing(m.geometry);
        if (ring && ringAreaKm2(ring) >= MIN_AREA_KM2) out.push({ name, ring });
      }
    }
  }
  return out;
}
