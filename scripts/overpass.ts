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
 * 3. **多備幾個鏡像，而且要重試。** Overpass 是免費的共享服務，
 *    忙的時候回 504 / 429 是常態而不是例外 —— 尤其 504 帶著
 *    `Dispatcher_Client::request_read_a` 時，意思只是「現在排不到執行位」，
 *    過幾分鐘再送同一個查詢通常就會過。第一次失敗就放棄的客戶端，
 *    在 Overpass 上基本上是不能用的。
 */

/** 一次請求的上限。查詢本身宣告 [timeout:300]，客戶端要留更多餘裕。 */
const REQUEST_TIMEOUT_MS = 360_000;

/** 全部端點都失敗算一輪。輪與輪之間等待遞增。 */
const MAX_ROUNDS = 4;
const ROUND_BACKOFF_MS = [5_000, 20_000, 60_000];

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

/**
 * 這個狀態碼值不值得重試？
 *
 * 400 是查詢本身寫錯（Overpass 會在 body 裡指出第幾行），換端點、等再久
 * 都不會變成 200，所以直接放棄並把錯誤指出來，比耗掉 4 個端點 × 4 輪好。
 * 其餘的（429 排隊中、502/503/504 過載）都是暫時性的。
 */
export function isRetryableStatus(status: number): boolean {
  return status !== 400;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 把秒數印成人看得懂的樣子。 */
function human(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分鐘` : `${Math.round(ms / 1000)} 秒`;
}

/** 送一次請求。成功回傳解析後的 JSON，失敗一律 throw。 */
async function attempt(url: string, query: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // 這兩個 header 是 406 的解方
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Overpass 把真正的原因寫在 body 裡，不印出來就只能猜
    const body = (await res.text().catch(() => '')).trim().slice(0, 600);
    const err = new Error(
      `HTTP ${res.status} ${res.statusText}${body ? `\n      伺服器回應：${body}` : ''}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回應不是合法 JSON（前 300 字）：\n      ${text.trim().slice(0, 300)}`);
  }
}

export async function queryOverpass(query: string): Promise<OverpassResult> {
  const problems = new Map<string, string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    for (const url of OVERPASS_ENDPOINTS) {
      const label = round === 0 ? '' : `（第 ${round + 1} 輪）`;
      console.log(`  查詢 ${url} ${label}…`);
      const started = Date.now();

      try {
        const raw = await attempt(url, query);
        console.log(`  ✓ 成功，耗時 ${human(Date.now() - started)}`);
        return { raw, endpoint: url };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = (err as Error & { status?: number }).status;

        // 查詢寫錯，重試沒有意義
        if (status !== undefined && !isRetryableStatus(status)) {
          throw new Error(`查詢被拒絕（不是暫時性問題，重試也不會過）：\n\n  ${msg}`);
        }

        console.warn(`  ! 失敗：${msg}`);
        problems.set(url, msg);
      }
    }

    const wait = ROUND_BACKOFF_MS[round];
    if (wait === undefined) break; // 最後一輪跑完就不再等
    console.log(
      `\n  全部端點都忙。這是 Overpass 的常態，等 ${human(wait)} 再試一輪` +
        `（還有 ${MAX_ROUNDS - round - 1} 輪）…\n`,
    );
    await sleep(wait);
  }

  const detail = [...problems].map(([url, msg]) => `${url}\n    ${msg}`).join('\n\n  ');
  throw new Error(`重試 ${MAX_ROUNDS} 輪後所有 Overpass 端點仍然失敗：\n\n  ${detail}`);
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
