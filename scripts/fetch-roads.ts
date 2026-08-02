/**
 * 抓取雙北的道路 → data/sources/twn-roads.json
 *
 * 執行：npm run fetch:roads
 *
 * 資料來源是 samklin33/game-project 已經 commit 進 repo 的道路 GeoJSON
 * （臺北市 + 新北市，由 Overpass 抓好）。直接用現成的有幾個好處：
 *   - 不必每次都跑一次要花好幾分鐘的 Overpass 查詢
 *   - 範圍正好就是雙北
 *   - 它的 tier 欄位是由 OSM highway 等級推出來的，可以對應回道路分級
 *
 * 想從 OSM 原始資料重新產生的話，那個 repo 的 scripts/build_roads.py 就是
 * 產生器（需要能連到 Overpass）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNamedRoads, type Road } from './roads-parse';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/sources');

const SOURCES = [
  {
    city: '臺北市',
    url: 'https://raw.githubusercontent.com/samklin33/game-project/main/data/taipei.geojson',
  },
  {
    city: '新北市',
    url: 'https://raw.githubusercontent.com/samklin33/game-project/main/data/newtaipei.geojson',
  },
];

/** 簡化容差（公尺）。這個遊戲的縮放層級下 10 公尺的偏差看不出來。 */
const SIMPLIFY_M = 10;

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('抓取雙北道路');

  const roads: Road[] = [];
  for (const src of SOURCES) {
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`下載失敗 ${res.status} ${res.statusText}: ${src.url}`);
    const raw = await res.json();
    const parsed = parseNamedRoads(raw, SIMPLIFY_M);
    const pts = parsed.reduce((a, r) => a + r.path.length / 2, 0);
    console.log(
      `  ${src.city}：${parsed.length.toLocaleString()} 段、${pts.toLocaleString()} 點`,
    );
    roads.push(...parsed);
  }

  if (roads.length === 0) throw new Error('沒有解析到任何道路');

  const path = resolve(OUT, 'twn-roads.json');
  const json = JSON.stringify(roads);
  await writeFile(path, json);

  const arterial = roads.filter((r) => r.cls === 0).length;
  const totalPts = roads.reduce((a, r) => a + r.path.length / 2, 0);
  console.log(`\n  ✓ ${path.replace(ROOT + '/', '')} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  幹道 ${arterial.toLocaleString()} 段 / 次要道路 ${(roads.length - arterial).toLocaleString()} 段`);
  console.log(`  座標點 ${totalPts.toLocaleString()}（簡化容差 ${SIMPLIFY_M} m）`);
  console.log('\n完成。接著執行 npm run build:pack');
}

main().catch((err) => {
  console.error('\n✗ fetch-roads 失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
