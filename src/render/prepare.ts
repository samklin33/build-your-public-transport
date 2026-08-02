import { projectMercator } from '../model/geo';
import type { CityPack } from '../model/types';

/**
 * 把 pack 裡的經緯度幾何投影成世界座標，只在載入時做一次。
 * 之後每一幀重畫都直接用這些 Float32Array，不再做任何三角函數運算。
 */
export interface PreparedZone {
  id: number;
  rings: Float32Array[];
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  population: number;
  areaKm2: number;
  densityPerKm2: number;
}

export interface PreparedDistrict {
  name: string;
  county: string;
  rings: Float32Array[];
  cx: number;
  cy: number;
  population: number;
}

export interface PreparedRoad {
  cls: 0 | 1 | 2;
  name: string;
  /** 投影後的世界座標，扁平化的 [x,y,x,y,...]。 */
  path: Float32Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PreparedCity {
  zones: PreparedZone[];
  districts: PreparedDistrict[];
  roads: PreparedRoad[];
  /** 世界座標的整體範圍。 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxDensity: number;
  /** 密度的 95 百分位，用來做色階的上限，避免極端值把整張圖壓成同一色。 */
  densityP95: number;
  /**
   * 都市化範圍（世界座標）。雙北有一大半面積是幾乎無人居住的山區，
   * 用完整 bbox 開場會讓真正要規劃的市區小到看不清楚，
   * 因此初始視角改用「涵蓋 97% 人口」的範圍。
   */
  urbanMinX: number;
  urbanMinY: number;
  urbanMaxX: number;
  urbanMaxY: number;
}

function projectRings(rings: number[][]): {
  out: Float32Array[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const out = rings.map((ring) => {
    const arr = new Float32Array(ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = projectMercator(ring[i], ring[i + 1]);
      arr[i] = x;
      arr[i + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return arr;
  });
  return { out, minX, minY, maxX, maxY };
}

export function prepareCity(pack: CityPack): PreparedCity {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const zones: PreparedZone[] = pack.zones.map((z) => {
    const p = projectRings(z.rings);
    const [cx, cy] = projectMercator(z.lon, z.lat);
    if (p.minX < minX) minX = p.minX;
    if (p.maxX > maxX) maxX = p.maxX;
    if (p.minY < minY) minY = p.minY;
    if (p.maxY > maxY) maxY = p.maxY;
    return {
      id: z.id,
      rings: p.out,
      cx,
      cy,
      minX: p.minX,
      minY: p.minY,
      maxX: p.maxX,
      maxY: p.maxY,
      population: z.population,
      areaKm2: z.areaKm2,
      densityPerKm2: z.areaKm2 > 0 ? z.population / z.areaKm2 : 0,
    };
  });

  // 行政區界用村里聯集畫不出乾淨的外框，這裡直接沿用 pack 內的區級資料做標籤定位，
  // 邊界則靠村里邊框的顏色深淺區分。
  const districts: PreparedDistrict[] = pack.districts.map((d) => {
    const members = zones.filter((z) => pack.zones[z.id].districtId === d.id);
    let sx = 0;
    let sy = 0;
    let w = 0;
    for (const m of members) {
      sx += m.cx * m.population;
      sy += m.cy * m.population;
      w += m.population;
    }
    return {
      name: d.name,
      county: d.county,
      rings: [],
      cx: w > 0 ? sx / w : 0,
      cy: w > 0 ? sy / w : 0,
      population: d.population,
    };
  });

  const roads: PreparedRoad[] = (pack.roads ?? []).map((r) => {
    const path = new Float32Array(r.path.length);
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    for (let i = 0; i < r.path.length; i += 2) {
      const [x, y] = projectMercator(r.path[i], r.path[i + 1]);
      path[i] = x;
      path[i + 1] = y;
      if (x < rMinX) rMinX = x;
      if (x > rMaxX) rMaxX = x;
      if (y < rMinY) rMinY = y;
      if (y > rMaxY) rMaxY = y;
    }
    return { cls: r.cls, name: r.name, path, minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY };
  });

  const densities = zones.map((z) => z.densityPerKm2).sort((a, b) => a - b);
  const densityP95 = densities[Math.floor(densities.length * 0.95)] || 1;

  // 由密度最高的里往下取，累積到 97% 人口為止，這些里的範圍就是都市化區域。
  const totalPop = zones.reduce((a, z) => a + z.population, 0);
  const byDensity = [...zones].sort((a, b) => b.densityPerKm2 - a.densityPerKm2);
  let acc = 0;
  let uMinX = Infinity;
  let uMinY = Infinity;
  let uMaxX = -Infinity;
  let uMaxY = -Infinity;
  for (const z of byDensity) {
    if (acc >= totalPop * 0.97) break;
    acc += z.population;
    if (z.minX < uMinX) uMinX = z.minX;
    if (z.maxX > uMaxX) uMaxX = z.maxX;
    if (z.minY < uMinY) uMinY = z.minY;
    if (z.maxY > uMaxY) uMaxY = z.maxY;
  }

  return {
    zones,
    districts,
    roads,
    minX,
    minY,
    maxX,
    maxY,
    maxDensity: densities[densities.length - 1] || 1,
    densityP95,
    urbanMinX: Number.isFinite(uMinX) ? uMinX : minX,
    urbanMinY: Number.isFinite(uMinY) ? uMinY : minY,
    urbanMaxX: Number.isFinite(uMaxX) ? uMaxX : maxX,
    urbanMaxY: Number.isFinite(uMaxY) ? uMaxY : maxY,
  };
}
