/**
 * 抓取雙北的水域（河川、水體）→ data/sources/twn-water.json
 *
 * 執行：npm run fetch:water
 *
 * ⚠️ 需要能連到 overpass-api.de。開發這支程式的環境連不到，
 * 因此「查詢本身」沒有實測過，只有解析與簡化的部分有測試
 * （tests/water.test.ts）。跑不起來的話把 Overpass 回來的內容貼出來就能修。
 *
 * 為什麼一定要這份資料：
 * 內政部的村里界「完整覆蓋」河道 —— 淡水河、基隆河、新店溪的河面
 * 都被算在某個里的範圍內（實測：淡水河中央落在三重區文化里）。
 * 所以光靠村里多邊形是畫不出河的，水域必須另外來源。
 *
 * 拿到之後可以做兩件事：
 *   1. 地圖畫出河川，水陸關係才正確
 *   2. 跨河路段套用 riverCrossingMultiplier —— 這個係數在成本模型裡
 *      定義好了卻一直沒被套用，目前跨淡水河跟在平地蓋一樣便宜
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOverpassWater } from './water-parse';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/sources');

const BBOX = { south: 24.85, west: 121.25, north: 25.32, east: 121.78 };

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * 只抓「面狀」水域，不抓 waterway=river 的中心線 ——
 * 中心線畫出來是一條線，看起來還是不像河。
 *
 * 同時抓 way 與 relation：大型河川在 OSM 常以 multipolygon relation 表示。
 * `out geom` 會把 relation 的成員 way 連同座標一起回傳。
 */
function buildQuery(): string {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `
[out:json][timeout:300];
(
  way["natural"="water"](${b});
  way["waterway"="riverbank"](${b});
  relation["natural"="water"](${b});
  relation["waterway"="riverbank"](${b});
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

/**
 * 手動下載的 Overpass 輸出放這裡也可以。
 *
 * 有些網路環境連不到 Overpass API（開發這支程式的環境就是被組織的 egress
 * 政策擋掉，回 403）。這種情況可以改用瀏覽器：到 overpass-turbo.eu 貼上
 * 查詢、按執行，再 Export → raw data directly from Overpass API，
 * 把檔案存成下面這個路徑，重跑一次就會直接讀它。
 */
const MANUAL_PATH = 'data/sources/overpass-water-raw.json';

async function loadRaw(): Promise<{ raw: unknown; from: string }> {
  const manual = resolve(ROOT, MANUAL_PATH);
  try {
    const text = await readFile(manual, 'utf8');
    console.log(`  使用手動下載的檔案 ${MANUAL_PATH}`);
    return { raw: JSON.parse(text), from: MANUAL_PATH };
  } catch {
    // 沒有手動檔案就走 API
  }
  return { raw: await fetchOverpass(buildQuery()), from: 'Overpass API' };
}

async function main() {
  // npm run fetch:water -- --print-query
  if (process.argv.includes('--print-query')) {
    console.log(buildQuery());
    return;
  }

  await mkdir(OUT, { recursive: true });
  console.log('抓取雙北水域');
  console.log(`  範圍 ${BBOX.south},${BBOX.west} – ${BBOX.north},${BBOX.east}`);

  const { raw } = await loadRaw();
  const water = parseOverpassWater(raw);

  if (water.length === 0) {
    throw new Error('沒有解析到任何水域 —— 查詢或回應格式可能不如預期');
  }

  const path = resolve(OUT, 'twn-water.json');
  const json = JSON.stringify(water);
  await writeFile(path, json);

  const pts = water.reduce((a, w) => a + w.ring.length / 2, 0);
  const named = water.filter((w) => w.name).length;
  console.log(`\n  ✓ ${path.replace(ROOT + '/', '')} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  水域 ${water.length.toLocaleString()} 個（${named.toLocaleString()} 個有名稱）、${pts.toLocaleString()} 點`);
  const names = [...new Set(water.map((w) => w.name).filter(Boolean))].slice(0, 12);
  if (names.length) console.log(`  例：${names.join('、')}`);
  console.log('\n完成。接著執行 npm run build:pack');
}

main().catch((err) => {
  console.error('\n✗ fetch-water 失敗:', err instanceof Error ? err.message : err);
  console.error(
    `\n連不到 Overpass API 的話，用瀏覽器也可以，不需要任何設定：

  1. 開 https://overpass-turbo.eu
  2. 把下面整段查詢貼進左邊的編輯器，按「執行 / Run」
  3. 按「匯出 / Export」→「raw data directly from Overpass API」
  4. 把下載的檔案存成 ${MANUAL_PATH}
  5. 重跑 npm run fetch:water（會自動讀那個檔案，不再連 API）

查詢內容：
`,
  );
  console.error(buildQuery());
  process.exit(1);
});
