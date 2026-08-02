/**
 * 抓取雙北的主要道路 → data/sources/twn-roads.geojson
 *
 * 為什麼跟 fetch-sources 分開：Overpass 的查詢很重（要跑一兩分鐘），
 * 而且不是每次更新資料都需要重抓道路。
 *
 * 執行：npm run fetch:roads
 *
 * ⚠️ 需要能連到 overpass-api.de。開發這支程式的環境連不到，
 * 因此「查詢本身」沒有實測過，只有解析與輸出的部分有用真實的
 * Overpass GeoJSON 輸出測過（tests/roads.test.ts）。
 * 第一次跑如果失敗，把 Overpass 回來的原始內容貼出來就能修。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverpassRoads, ROAD_CLASSES } from './roads-parse';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/sources');

/** 雙北都會區的範圍。山區的產業道路對路網規劃沒意義，所以只取都市化的部分。 */
const BBOX = { south: 24.85, west: 121.25, north: 25.32, east: 121.78 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function buildQuery(): string {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const classes = ROAD_CLASSES.join('|');
  return `
[out:json][timeout:180];
(
  way["highway"~"^(${classes})$"](${b});
);
out geom;
`.trim();
}

async function fetchOverpass(query: string): Promise<unknown> {
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      console.log(`  查詢 ${url} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      console.warn(`  ! ${url} 失敗：${err instanceof Error ? err.message : err}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('所有 Overpass 端點都失敗');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('抓取雙北主要道路（Overpass）');
  console.log(`  範圍 ${BBOX.south},${BBOX.west} – ${BBOX.north},${BBOX.east}`);
  console.log(`  道路等級 ${ROAD_CLASSES.join(', ')}`);

  const raw = await fetchOverpass(buildQuery());
  const fc = parseOverpassRoads(raw);

  if (fc.features.length === 0) {
    throw new Error('沒有解析到任何道路 —— 查詢或回應格式可能不如預期');
  }

  const path = resolve(OUT, 'twn-roads.geojson');
  const json = JSON.stringify(fc);
  await writeFile(path, json);

  const byClass = new Map<string, number>();
  for (const f of fc.features) {
    byClass.set(f.properties.highway, (byClass.get(f.properties.highway) ?? 0) + 1);
  }
  console.log(`\n  ✓ ${path.replace(ROOT + '/', '')} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  路段 ${fc.features.length.toLocaleString()} 條`);
  for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(12)} ${v.toLocaleString()}`);
  }
  console.log('\n完成。接著執行 npm run build:pack');
}

main().catch((err) => {
  console.error('\n✗ fetch-roads 失敗:', err instanceof Error ? err.message : err);
  console.error('\n如果是連線問題，可以改用 overpass-turbo.eu 手動跑這段查詢並存成檔案：\n');
  console.error(buildQuery());
  process.exit(1);
});
