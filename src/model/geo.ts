/** 幾何與投影工具。scripts/ 與 src/ 共用。 */

const DEG = Math.PI / 180;
/** 地球平均半徑（公里）。 */
const R_KM = 6371.0088;

/**
 * 雙北範圍內用等距圓柱近似即可（誤差 < 0.1%），比 haversine 快得多，
 * 而模擬要算幾十萬次距離，這個差別是有感的。
 */
export function kmBetween(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const midLat = (lat1 + lat2) * 0.5 * DEG;
  const dx = (lon2 - lon1) * DEG * Math.cos(midLat);
  const dy = (lat2 - lat1) * DEG;
  return Math.sqrt(dx * dx + dy * dy) * R_KM;
}

/** 扁平化 [lon,lat,lon,lat,...] 折線的長度（公里）。 */
export function polylineKm(flat: number[]): number {
  let km = 0;
  for (let i = 0; i + 3 < flat.length; i += 2) {
    km += kmBetween(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
  }
  return km;
}

/** Web Mercator 投影，輸出為 0..1 的正規化世界座標（y 軸向下，符合畫布慣例）。 */
export function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const s = Math.sin(lat * DEG);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

export function unprojectMercator(x: number, y: number): [number, number] {
  const lon = x * 360 - 180;
  const n = Math.PI * (1 - 2 * y);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return [lon, lat];
}

/** 多邊形環的帶號面積（平方度）。環是扁平化的 [lon,lat,...]。 */
export function ringSignedArea(ring: number[]): number {
  let s = 0;
  for (let i = 0, n = ring.length - 2; i < n; i += 2) {
    s += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
  }
  return s / 2;
}

/** 環的面積（平方公里），在給定緯度做經度收斂修正。 */
export function ringAreaKm2(ring: number[], atLat: number): number {
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos(atLat * DEG);
  return Math.abs(ringSignedArea(ring)) * kmPerDegLat * kmPerDegLon;
}

/** 環的面積加權形心。回傳 [lon, lat]。 */
export function ringCentroid(ring: number[]): [number, number] {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length - 2; i < n; i += 2) {
    const cross = ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
    a += cross;
    cx += (ring[i] + ring[i + 2]) * cross;
    cy += (ring[i + 1] + ring[i + 3]) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-12) {
    // 退化多邊形（面積趨近 0）就改用頂點平均。
    let sx = 0;
    let sy = 0;
    const n = ring.length / 2;
    for (let i = 0; i < ring.length; i += 2) {
      sx += ring[i];
      sy += ring[i + 1];
    }
    return [sx / n, sy / n];
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** 點是否在環內（射線法）。環是扁平化的 [x,y,...]。 */
export function pointInRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  for (
    let i = 0, j = ring.length - 2;
    i < ring.length;
    j = i, i += 2
  ) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
