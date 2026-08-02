/**
 * 抓取原始開放資料 → data/sources/
 *
 * 產出的檔案會 commit 進 repo，因此遊戲本身與 build:pack 都不需要連外網路。
 * 只有想更新資料到更新的年份時才需要重跑這支程式。
 *
 * 執行：npm run fetch:sources
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/sources');

/** 我們要的縣市。內政部資料裡「臺北市」有時寫成「台北市」，兩種都收。 */
const TARGET_COUNTIES = new Set(['臺北市', '台北市', '新北市']);
/** 正規化縣市名，臺/台統一成「臺」以利 join。 */
const normCounty = (s: string) => s.replace(/^台北市$/, '臺北市');

const SOURCES = {
  population:
    'https://raw.githubusercontent.com/roberthsu2003/python/master/' +
    encodeURIComponent('檔案存取') +
    '/' +
    encodeURIComponent('各鄉鎮市區人口密度.csv'),
  mrt: 'https://raw.githubusercontent.com/siriushsu/taiwan-rail-live/master/data/mrt.json',
};

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗 ${res.status} ${res.statusText}: ${url}`);
  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, body);
  console.log(`  ✓ ${dest.replace(ROOT + '/', '')} (${(body.length / 1024).toFixed(0)} KB)`);
  return body;
}

/** 座標降精度到 5 位小數（約 1.1 公尺），對遊戲綽綽有餘且大幅縮小檔案。 */
function roundCoords(coords: unknown): unknown {
  if (typeof coords === 'number') return Math.round(coords * 1e5) / 1e5;
  if (Array.isArray(coords)) return coords.map(roundCoords);
  return coords;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('抓取原始資料 →', OUT.replace(ROOT + '/', ''));

  // 1. 村里界 — 來自 npm 套件 taiwan-atlas（內政部 TopoJSON），不需連外。
  //    整份台灣有 7701 個村里，這裡只留雙北的 1465 個。
  const atlasPath = resolve(ROOT, 'node_modules/taiwan-atlas/villages-10t.json');
  const topo = JSON.parse(await readFile(atlasPath, 'utf8')) as Topology;

  const villages = feature(
    topo,
    topo.objects.villages as GeometryCollection,
  ) as FeatureCollection<Polygon | MultiPolygon>;
  const towns = feature(
    topo,
    topo.objects.towns as GeometryCollection,
  ) as FeatureCollection<Polygon | MultiPolygon>;
  const counties = feature(
    topo,
    topo.objects.counties as GeometryCollection,
  ) as FeatureCollection<Polygon | MultiPolygon>;

  const inTarget = (p: Record<string, unknown> | null) =>
    TARGET_COUNTIES.has(String(p?.COUNTYNAME ?? ''));

  const villageSubset = {
    type: 'FeatureCollection' as const,
    features: villages.features.filter((f) => inTarget(f.properties)).map((f) => ({
      type: 'Feature' as const,
      properties: {
        VILLCODE: f.properties!.VILLCODE,
        VILLNAME: f.properties!.VILLNAME,
        TOWNCODE: f.properties!.TOWNCODE,
        TOWNNAME: f.properties!.TOWNNAME,
        COUNTYNAME: normCounty(String(f.properties!.COUNTYNAME)),
      },
      geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
    })),
  };

  const townSubset = {
    type: 'FeatureCollection' as const,
    features: towns.features.filter((f) => inTarget(f.properties)).map((f) => ({
      type: 'Feature' as const,
      properties: {
        TOWNCODE: f.properties!.TOWNCODE,
        TOWNNAME: f.properties!.TOWNNAME,
        COUNTYNAME: normCounty(String(f.properties!.COUNTYNAME)),
      },
      geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
    })),
  };

  if (villageSubset.features.length !== 1465)
    throw new Error(`預期 1465 個雙北村里，實際 ${villageSubset.features.length}`);
  if (townSubset.features.length !== 41)
    throw new Error(`預期 41 個雙北行政區，實際 ${townSubset.features.length}`);

  await writeFile(
    resolve(OUT, 'twn-villages.geojson'),
    JSON.stringify(villageSubset),
  );
  console.log(`  ✓ twn-villages.geojson (${villageSubset.features.length} 村里)`);
  await writeFile(resolve(OUT, 'twn-districts.geojson'), JSON.stringify(townSubset));
  console.log(`  ✓ twn-districts.geojson (${townSubset.features.length} 區)`);

  // 縣市界。用途是當作「陸地」底圖：臺北市與新北市的界線正好走在淡水河、
  // 新店溪的河道中央，兩市聯集起來會把河面完整蓋住，而村里界不會 ——
  // 村里只畫到河岸，中間留下縫隙，那些縫隙會露出背景色被誤看成河。
  const countySubset = {
    type: 'FeatureCollection' as const,
    features: counties.features.filter((f) => inTarget(f.properties)).map((f) => ({
      type: 'Feature' as const,
      properties: { COUNTYNAME: normCounty(String(f.properties!.COUNTYNAME)) },
      geometry: { ...f.geometry, coordinates: roundCoords(f.geometry.coordinates) },
    })),
  };
  if (countySubset.features.length !== 2)
    throw new Error(`預期 2 個縣市，實際 ${countySubset.features.length}`);
  await writeFile(resolve(OUT, 'twn-counties.geojson'), JSON.stringify(countySubset));
  console.log(`  ✓ twn-counties.geojson (${countySubset.features.length} 縣市)`);

  // 2. 鄉鎮市區人口（內政部，民國 106 年）
  await download(SOURCES.population, resolve(OUT, 'twn-township-population.csv'));

  // 3. 真實台北捷運路網（站序與座標取自 OpenStreetMap route relation）
  await download(SOURCES.mrt, resolve(OUT, 'trtc-network.json'));

  console.log('\n完成。接著執行 npm run build:pack');
}

main().catch((err) => {
  console.error('\n✗ fetch-sources 失敗:', err.message);
  process.exit(1);
});
