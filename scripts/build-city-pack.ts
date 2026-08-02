/**
 * data/sources/ → public/city-packs/taipei.json
 *
 * 執行：npm run build:pack
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

import { kmBetween, ringAreaKm2, ringCentroid } from '../src/model/geo';
import { DEFAULT_COST_MODEL, DEFAULT_SIM_PARAMS } from '../src/model/defaults';
import { buildGravityOD } from '../src/sim/demand';
import type {
  CityPack,
  District,
  PackLine,
  PackNetwork,
  PackStation,
  TransitMode,
  Zone,
} from '../src/model/types';
import {
  JOB_POP_EXPONENT,
  LOCAL_JOB_RATE,
  TAIPEI_EMPLOYMENT_CENTERS,
  TAIPEI_SOURCES,
} from './taipei-config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'data/sources');
const OUT = resolve(ROOT, 'public/city-packs');

const normCounty = (s: string) => s.replace(/^台北市$/, '臺北市');

type VillageProps = {
  VILLCODE: string;
  VILLNAME: string;
  TOWNCODE: string;
  TOWNNAME: string;
  COUNTYNAME: string;
};
type DistrictProps = { TOWNCODE: string; TOWNNAME: string; COUNTYNAME: string };

/** 把 GeoJSON 的 Polygon / MultiPolygon 攤平成扁平化的環陣列 [lon,lat,...]。 */
function toFlatRings(geom: Polygon | MultiPolygon): number[][] {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const rings: number[][] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      const flat = new Array<number>(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        flat[i * 2] = ring[i][0];
        flat[i * 2 + 1] = ring[i][1];
      }
      rings.push(flat);
    }
  }
  return rings;
}

/** 取最大環（外環）的形心與所有環的面積和。 */
function ringsMetrics(rings: number[][]) {
  let bestIdx = 0;
  let bestAbs = -1;
  let areaKm2 = 0;
  // 先用第一環的緯度當作經度收斂的基準
  const refLat = rings[0][1];
  for (let i = 0; i < rings.length; i++) {
    const a = ringAreaKm2(rings[i], refLat);
    areaKm2 += a;
    if (a > bestAbs) {
      bestAbs = a;
      bestIdx = i;
    }
  }
  const [lon, lat] = ringCentroid(rings[bestIdx]);
  return { lon, lat, areaKm2 };
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, 'utf8')) as T;
}

/** 解析內政部的人口 CSV。第一列是英文欄名，第二列是中文說明，資料從第三列開始。 */
async function readPopulation(): Promise<Map<string, { pop: number; areaKm2: number }>> {
  const text = await readFile(resolve(SRC, 'twn-township-population.csv'), 'utf8');
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const header = lines[0].split(',').map((s) => s.trim());
  const iSite = header.indexOf('site_id');
  const iPop = header.indexOf('people_total');
  const iArea = header.indexOf('area');
  if (iSite < 0 || iPop < 0 || iArea < 0)
    throw new Error(`人口 CSV 欄位不符預期，實際欄名：${header.join(',')}`);

  const out = new Map<string, { pop: number; areaKm2: number }>();
  for (const line of lines.slice(2)) {
    const cols = line.split(',');
    const site = normCounty(cols[iSite]?.trim() ?? '');
    const pop = Number(cols[iPop]);
    const area = Number(cols[iArea]);
    if (!site || !Number.isFinite(pop)) continue;
    out.set(site, { pop, areaKm2: Number.isFinite(area) ? area : 0 });
  }
  return out;
}

// ─────────────────────────────────────────── 真實捷運路網

type RawMrt = {
  lines: {
    id: string;
    name: string;
    color: string;
    peakHeadwaySec?: number;
    stations: { name: string; lat: number; lon: number }[];
  }[];
};

/**
 * 真實路網的尖峰班距（秒）。
 *
 * 來源資料 trtc-network.json 自己標了 headway_estimated: true，那些估計值偏長
 * （板南線給 360 秒，實際尖峰約 2 分鐘），直接拿來用會讓開局的「現況延伸」情境
 * 一載入就顯示嚴重超載。這裡以各線公開的尖峰班距量級覆寫，仍是近似值。
 */
const REAL_PEAK_HEADWAY_SEC: Record<string, number> = {
  BR: 105, // 文湖線
  R: 140, // 淡水信義線
  G: 160, // 松山新店線
  O_LUZHOU: 180, // 中和新蘆線 蘆洲支線
  O_XINZHUANG: 180, // 中和新蘆線 新莊／迴龍支線
  BL: 120, // 板南線
  Y: 240, // 環狀線
};

function buildReferenceNetwork(raw: RawMrt): PackNetwork {
  const byName = new Map<string, PackStation>();
  const lines: PackLine[] = [];

  for (const L of raw.lines) {
    const stationIds: string[] = [];
    for (const s of L.stations) {
      let st = byName.get(s.name);
      if (st) {
        // 同名站在不同路線上應該是同一個實體車站（轉乘站）。距離差太多代表資料有問題。
        const d = kmBetween(st.lon, st.lat, s.lon, s.lat);
        if (d > 0.4) {
          console.warn(
            `  ! 同名站「${s.name}」座標相距 ${(d * 1000).toFixed(0)}m，仍視為同一站`,
          );
        }
      } else {
        st = { id: `ref-${byName.size}`, name: s.name, lon: s.lon, lat: s.lat };
        byName.set(s.name, st);
      }
      // 同一條線上若連續重複同一站（環狀線折返等）就跳過
      if (stationIds[stationIds.length - 1] !== st.id) stationIds.push(st.id);
    }
    lines.push({
      id: `ref-${L.id}`,
      name: L.name,
      color: L.color,
      // 真實路網全是重運量或中運量鋼輪／膠輪系統，一律歸為地下捷運的成本與速度類別。
      mode: 'metro_underground' as TransitMode,
      stationIds,
      headwaySec: REAL_PEAK_HEADWAY_SEC[L.id] ?? L.peakHeadwaySec ?? 300,
    });
  }

  return { stations: [...byName.values()], lines };
}

// ─────────────────────────────────────────── 主流程

async function main() {
  console.log('建立城市 pack: taipei\n');
  await mkdir(OUT, { recursive: true });

  const villagesFc = await readJson<FeatureCollection<Polygon | MultiPolygon, VillageProps>>(
    resolve(SRC, 'twn-villages.geojson'),
  );
  const districtsFc = await readJson<
    FeatureCollection<Polygon | MultiPolygon, DistrictProps>
  >(resolve(SRC, 'twn-districts.geojson'));
  const popByDistrict = await readPopulation();
  const rawMrt = await readJson<RawMrt>(resolve(SRC, 'trtc-network.json'));

  // ── 行政區
  const districts: District[] = [];
  const districtIndexByCode = new Map<string, number>();
  const missing: string[] = [];

  districtsFc.features.forEach((f, i) => {
    const p = f.properties;
    const county = normCounty(p.COUNTYNAME);
    const key = county + p.TOWNNAME;
    const rec = popByDistrict.get(key);
    if (!rec) missing.push(key);
    const rings = toFlatRings(f.geometry);
    const m = ringsMetrics(rings);
    districts.push({
      id: i,
      code: p.TOWNCODE,
      name: p.TOWNNAME,
      county,
      population: rec?.pop ?? 0,
      areaKm2: rec?.areaKm2 || m.areaKm2,
    });
    districtIndexByCode.set(p.TOWNCODE, i);
  });

  if (missing.length) throw new Error(`以下行政區找不到人口資料：${missing.join(', ')}`);
  const totalPop = districts.reduce((s, d) => s + d.population, 0);
  console.log(`  行政區 ${districts.length} 個，總人口 ${totalPop.toLocaleString()}`);

  // ── 村里（zones）
  const zones: Zone[] = villagesFc.features.map((f, i) => {
    const p = f.properties;
    const rings = toFlatRings(f.geometry);
    const m = ringsMetrics(rings);
    const districtId = districtIndexByCode.get(p.TOWNCODE);
    if (districtId === undefined)
      throw new Error(`村里 ${p.VILLNAME} 的 TOWNCODE ${p.TOWNCODE} 找不到對應行政區`);
    return {
      id: i,
      code: p.VILLCODE,
      name: p.VILLNAME,
      districtId,
      lon: m.lon,
      lat: m.lat,
      areaKm2: m.areaKm2,
      population: 0,
      jobs: 0,
      rings,
    };
  });

  // ── 把區級人口分配到村里
  //
  // 台灣沒有開放的村里級人口資料可直接用，只能由區級往下推估。
  // 做法：區內人口按面積分配，但每個村里的權重面積設上限（該區中位數的 2 倍）。
  // 上限的用意是處理士林、北投、新店這種含大片山地的區 —— 一個里再大，
  // 超出上限的部分視為未開發土地，不再分到更多人口。
  const zonesByDistrict = new Map<number, Zone[]>();
  for (const z of zones) {
    const arr = zonesByDistrict.get(z.districtId);
    if (arr) arr.push(z);
    else zonesByDistrict.set(z.districtId, [z]);
  }

  for (const [districtId, list] of zonesByDistrict) {
    const areas = list.map((z) => z.areaKm2).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)] || 1;
    const cap = median * 2;
    let wSum = 0;
    const weights = list.map((z) => {
      const w = Math.min(z.areaKm2, cap);
      wSum += w;
      return w;
    });
    const dPop = districts[districtId].population;
    list.forEach((z, k) => {
      z.population = wSum > 0 ? (dPop * weights[k]) / wSum : dPop / list.length;
    });
  }

  const zoneSum = zones.reduce((s, z) => s + z.population, 0);
  if (Math.abs(zoneSum - totalPop) > 1)
    throw new Error(`村里人口加總 ${zoneSum} 與區級總和 ${totalPop} 不符`);
  console.log(`  村里 ${zones.length} 個，人口分配後加總 ${Math.round(zoneSum).toLocaleString()}`);

  // ── 就業分布（模型推估，見 taipei-config.ts 的說明）
  for (const z of zones) z.jobs = z.population * LOCAL_JOB_RATE;

  for (const c of TAIPEI_EMPLOYMENT_CENTERS) {
    // 以距離衰減 exp(-d/r) 為權重，再乘上該 zone 的人口作為「可容納開發強度」的代理，
    // 避免把辦公室灌到山區或河灘地上。
    let wSum = 0;
    const weights = zones.map((z) => {
      const d = kmBetween(c.lon, c.lat, z.lon, z.lat);
      const w =
        Math.exp(-d / c.radiusKm) * Math.max(z.population, 1) ** JOB_POP_EXPONENT;
      wSum += w;
      return w;
    });
    if (wSum <= 0) continue;
    zones.forEach((z, i) => {
      z.jobs += (c.jobs * weights[i]) / wSum;
    });
  }
  const totalJobs = zones.reduce((s, z) => s + z.jobs, 0);
  console.log(`  就業機會推估總數 ${Math.round(totalJobs).toLocaleString()}`);

  // ── 真實捷運路網
  const referenceNetwork = buildReferenceNetwork(rawMrt);
  console.log(
    `  真實路網：${referenceNetwork.stations.length} 站 / ${referenceNetwork.lines.length} 條路線分支`,
  );

  // ── 起訖矩陣
  console.log('  計算重力模型起訖矩陣…');
  const t0 = Date.now();
  const n = zones.length;
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const population = new Float64Array(n);
  const jobs = new Float64Array(n);
  zones.forEach((z, i) => {
    lon[i] = z.lon;
    lat[i] = z.lat;
    population[i] = z.population;
    jobs[i] = z.jobs;
  });

  const { od, totalPeakTrips, iterations } = buildGravityOD({
    lon,
    lat,
    population,
    jobs,
    gravityBeta: DEFAULT_SIM_PARAMS.gravityBeta,
    tripsPerPersonPerDay: DEFAULT_SIM_PARAMS.tripsPerPersonPerDay,
    peakHourShare: DEFAULT_SIM_PARAMS.peakHourShare,
    carSpeedKmh: DEFAULT_SIM_PARAMS.carSpeedKmh,
    detourFactor: DEFAULT_SIM_PARAMS.detourFactor,
    topK: DEFAULT_SIM_PARAMS.odTopK,
  });
  console.log(
    `    IPF ${iterations} 次疊代收斂，${od.dest.length.toLocaleString()} 組起訖對，` +
      `尖峰小時 ${Math.round(totalPeakTrips).toLocaleString()} 旅次（${((Date.now() - t0) / 1000).toFixed(1)}s）`,
  );

  // ── bbox
  let w = 180;
  let s = 90;
  let e = -180;
  let nBound = -90;
  for (const z of zones) {
    for (const ring of z.rings) {
      for (let i = 0; i < ring.length; i += 2) {
        if (ring[i] < w) w = ring[i];
        if (ring[i] > e) e = ring[i];
        if (ring[i + 1] < s) s = ring[i + 1];
        if (ring[i + 1] > nBound) nBound = ring[i + 1];
      }
    }
  }

  // 四捨五入到合理精度，縮小輸出檔案
  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  for (const z of zones) {
    z.population = r(z.population, 1);
    z.jobs = r(z.jobs, 1);
    z.areaKm2 = r(z.areaKm2, 4);
    z.lon = r(z.lon, 5);
    z.lat = r(z.lat, 5);
  }

  const pack: CityPack = {
    id: 'taipei',
    name: '雙北都會區',
    bbox: [w, s, e, nBound],
    districts,
    zones,
    employmentCenters: TAIPEI_EMPLOYMENT_CENTERS,
    referenceNetwork,
    costModel: DEFAULT_COST_MODEL,
    simParams: DEFAULT_SIM_PARAMS,
    baseOD: {
      rowStart: od.rowStart,
      dest: od.dest,
      flow: od.flow.map((v) => r(v, 3)),
    },
    sources: TAIPEI_SOURCES,
  };

  const outPath = resolve(OUT, 'taipei.json');
  const json = JSON.stringify(pack);
  await writeFile(outPath, json);
  const mb = json.length / 1024 / 1024;
  console.log(`\n  ✓ ${outPath.replace(ROOT + '/', '')} (${mb.toFixed(2)} MB)`);

  // ── 驗收
  const checks: [string, boolean, string][] = [
    ['行政區 41 個', districts.length === 41, `${districts.length}`],
    ['村里 1465 個', zones.length === 1465, `${zones.length}`],
    [
      '總人口約 667 萬',
      Math.abs(totalPop - 6_669_946) < 1,
      totalPop.toLocaleString(),
    ],
    ['真實捷運 116 站', referenceNetwork.stations.length === 116, `${referenceNetwork.stations.length}`],
    ['pack 小於 3 MB', mb < 3, `${mb.toFixed(2)} MB`],
    ['IPF 有收斂', iterations < 40, `${iterations} 次疊代`],
  ];
  console.log('\n  驗收：');
  let failed = 0;
  for (const [label, ok, actual] of checks) {
    console.log(`    ${ok ? '✓' : '✗'} ${label} — ${actual}`);
    if (!ok) failed++;
  }
  if (failed) throw new Error(`${failed} 項驗收未通過`);
  console.log('\n完成。');
}

main().catch((err) => {
  console.error('\n✗ build-city-pack 失敗:', err.message);
  process.exit(1);
});
