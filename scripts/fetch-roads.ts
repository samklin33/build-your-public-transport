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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNamedRoads, parseOverpassRoadsDetailed, type Road } from './roads-parse';

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

/**
 * 手動下載的 Overpass 輸出。
 *
 * game-project 那份資料夠畫地圖，但**不足以做公車沿路規劃**：
 * 它的 tier 把高架快速道路（trunk）和地面幹道（primary）合併成同一級，
 * 而且沒有 bridge / tunnel / layer / oneway。少了這些，切節點時會在
 * 建國高架跨越忠孝東路的地方生出一個不存在的路口，公車就「開上高架橋」了。
 *
 * 放了這個檔案就改用它，並保留完整標籤。
 * 產生方式見 fetch:roads 失敗時印出的說明。
 */
const MANUAL_PATH = 'data/sources/overpass-roads-raw.json';

/** 保留公車繞徑需要的標籤。跟 fetch-water 的查詢是同一個模式。 */
export function buildRoadQuery(): string {
  const b = '24.85,121.25,25.32,121.78';
  return `
[out:json][timeout:600];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link)$"](${b});
);
out geom;
`.trim();
}

async function main() {
  // npm run fetch:roads -- --print-query
  // 只印出 Overpass 查詢，方便貼到 overpass-turbo.eu，不做任何抓取
  if (process.argv.includes('--print-query')) {
    console.log(buildRoadQuery());
    return;
  }

  await mkdir(OUT, { recursive: true });
  console.log('抓取雙北道路');

  // 有手動下載的 Overpass 原始檔就優先用它 —— 標籤比較完整
  const manual = resolve(ROOT, MANUAL_PATH);
  try {
    const text = await readFile(manual, 'utf8');
    console.log(`  使用手動下載的 Overpass 檔案 ${MANUAL_PATH}（標籤完整）`);
    const detailed = parseOverpassRoadsDetailed(JSON.parse(text));
    const path = resolve(OUT, 'twn-roads.json');
    await writeFile(path, JSON.stringify(detailed));
    const count = (c: number) => detailed.filter((r) => r.cls === c).length.toLocaleString();
    const grade = detailed.filter((r) => r.gradeSeparated).length;
    console.log(`\n  ✓ ${path.replace(ROOT + '/', '')}`);
    console.log(`  幹道 ${count(0)} / 次要道路 ${count(1)} / 街廓道路 ${count(2)}`);
    console.log(`  立體交叉路段（橋樑／隧道／高架）${grade.toLocaleString()} —— 公車繞徑會排除這些`);
    console.log('\n完成。接著執行 npm run build:pack');
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

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

  const count = (c: number) => roads.filter((r) => r.cls === c).length.toLocaleString();
  const totalPts = roads.reduce((a, r) => a + r.path.length / 2, 0);
  console.log(`\n  ✓ ${path.replace(ROOT + '/', '')} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  幹道 ${count(0)} / 次要道路 ${count(1)} / 街廓道路 ${count(2)}`);
  console.log(`  座標點 ${totalPts.toLocaleString()}`);
  console.log('\n完成。接著執行 npm run build:pack');
}

main().catch((err) => {
  console.error('\n✗ fetch-roads 失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * 想升級成「可做公車繞徑」的道路資料，照這個流程拿：
 *
 *   1. 開 https://overpass-turbo.eu
 *   2. 貼上 buildRoadQuery() 印出來的查詢，按執行（雙北全區約需 1–3 分鐘）
 *   3. 匯出 → raw data directly from Overpass API
 *   4. 存成 data/sources/overpass-roads-raw.json
 *   5. 重跑 npm run fetch:roads && npm run build:pack
 *
 * 印出查詢：npm run fetch:roads -- --print-query
 */
