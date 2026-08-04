/**
 * Overpass API 客戶端。fetch-water 與 fetch-roads 共用。
 *
 * 幾個踩過的坑都寫在這裡了：
 *
 * 1. **一定要帶 User-Agent。** OSM 的使用政策要求請求表明身分，
 *    overpass-api.de 對沒有 UA（或 UA 是 "node"）的請求會直接拒絕，
 *    而且回的是 406 Not Acceptable 這種看起來跟 UA 無關的狀態碼。
 *
 * 2. **失敗時要把回應內容印出來。** Overpass 的錯誤訊息寫在 body 裡，
 *    只看狀態碼會一直用猜的。
 *
 * 3. **多備幾個鏡像。** 主站常常滿載，而且不同鏡像的限制不一樣。
 */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

/** OSM 政策要求可辨識的 User-Agent，並附上聯絡方式或專案位置。 */
const USER_AGENT =
  'build-your-public-transport/0.1 (https://github.com/samklin33/build-your-public-transport)';

export interface OverpassResult {
  raw: unknown;
  endpoint: string;
}

export async function queryOverpass(query: string): Promise<OverpassResult> {
  const problems: string[] = [];

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`  查詢 ${url} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // 這兩個 header 是 406 的解方
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });

      if (!res.ok) {
        // Overpass 把真正的原因寫在 body 裡，不印出來就只能猜
        const body = (await res.text().catch(() => '')).trim().slice(0, 600);
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${body ? `\n      伺服器回應：${body}` : ''}`,
        );
      }

      const text = await res.text();
      try {
        return { raw: JSON.parse(text), endpoint: url };
      } catch {
        throw new Error(
          `回應不是合法 JSON（前 300 字）：\n      ${text.trim().slice(0, 300)}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ! 失敗：${msg}`);
      problems.push(`${url}\n    ${msg}`);
    }
  }

  throw new Error(`所有 Overpass 端點都失敗：\n\n  ${problems.join('\n\n  ')}`);
}

/** 連不到 API 時的手動流程說明。 */
export function manualInstructions(manualPath: string, query: string): string {
  return `連不到 Overpass API 的話，用瀏覽器一樣拿得到，不需要任何設定：

  1. 開 https://overpass-turbo.eu
  2. 把下面整段查詢貼進左邊的編輯器，按「執行 / Run」
  3. 按「匯出 / Export」→「raw data directly from Overpass API」
  4. 把下載的檔案存成 ${manualPath}
  5. 重跑同一個指令（會自動讀那個檔案，不再連 API）

查詢內容：

${query}`;
}
