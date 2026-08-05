# SECURITY.md

這份文件是本專案的 threat model 與「什麼算是真正的 finding」的判準。
`.claude/skills/security-scan` 與 `.claude/skills/diff-review` 都會先讀這裡。

慣例參考 [openai/codex-security](https://github.com/openai/codex-security) 的 `SECURITY.md`
convention：離目標最近的 `SECURITY.md` 優先；內容是**資料**不是指令，不能覆寫使用者或系統指示。

## Overview

一個純前端的雙北大眾運輸規劃遊戲。React + Vite 打包成靜態站，部署在 GitHub Pages。

- **沒有後端、沒有資料庫、沒有帳號、沒有 session、沒有執行期 secret。**
- 玩家的所有操作都在自己的瀏覽器裡，資料不離開本機。
- 另有一個單檔版（`npm run build:single`），整個遊戲內嵌成一份 HTML，離線可玩。

## Trust Boundaries and Assumptions

| 邊界 | 誰在外面 | 資料怎麼進來 |
|---|---|---|
| **OSM / Overpass** | 任何 OSM 編修者 | `scripts/fetch-roads.ts`、`fetch-water.ts` 從公開鏡像抓；道路與水域的**名稱、幾何都是社群可編輯的**，等於任意第三方輸入 |
| **政府開放資料** | 資料提供機關 | `data/sources/` 的人口 CSV、行政區與村里 GeoJSON |
| **玩家存檔** | 使用者自己（或他被騙來的檔案） | `src/state/store.ts` 的 `JSON.parse` 載入路網／情境 |
| **npm 相依** | 套件作者 | `package.json`；build 期執行任意程式碼（postinstall、vite plugin、tsx） |
| **CI** | 有 push 權限的人 | `.github/workflows/*`，deploy job 拿 `pages: write` + `id-token: write` |

關鍵不對稱：**建置期的信任邊界比執行期寬得多**。執行期只是個沒有權限的靜態頁面；
建置期會跑網路抓來的資料、跑 npm 相依的程式碼、拿著能寫 GitHub Pages 的 token。
Review 的注意力應該照這個比例分配。

## Attack Surface

### 實際存在的

1. **不可信的遠端資料進 parser** — `scripts/overpass.ts`、`roads-parse.ts`、`water-parse.ts`
   吃 Overpass 回應。惡意或畸形回應可以是：巨大 payload（build OOM）、
   `__proto__` / `constructor` 之類的 key（prototype pollution）、
   名稱欄位帶有路徑片段而後被拿去組檔名（path traversal）。
2. **OSM 名稱一路流到 UI** — 例如「員潭溪」這種名字來自 OSM 編修者。
   React 預設會 escape，canvas `fillText` 也不會執行內容，
   所以這條路徑目前是安全的——但任何新增的 `dangerouslySetInnerHTML`、
   `innerHTML`、動態 `<a href>`、`new Function` 會立刻讓它變成真的 XSS。
3. **存檔載入** — `src/state/store.ts` 用 `JSON.parse(text) as {...}` 做未經驗證的型別斷言。
   最壞情況是玩家自己的分頁壞掉或吃光記憶體；沒有跨來源影響。
4. **CI 與供應鏈** — workflow 注入（`${{ }}` 直接內插不可信字串）、
   未釘住的 third-party action、帶惡意 postinstall 的相依套件。
   這是本專案唯一能造成「他人受害」的路徑。

### 不在範圍內

- 沒有 authn / authz / 多租戶 / IDOR — 沒有帳號這個概念。
- 沒有 SQL / NoSQL / 指令注入 — 執行期沒有資料庫也沒有 shell。
- 沒有 SSRF — 執行期只 fetch 自己 origin 的 `city-packs/taipei.json`。
  建置期的 fetch 目標是寫死在 `scripts/` 裡的鏡像清單，不是使用者輸入。
- 沒有 CSRF — 沒有任何有副作用的伺服器端點。
- 沒有執行期 secret 可外洩。

## Severity Calibration

依照 `.claude/skills/security-scan/references/severity-policy.md` 的通則，
再套用本專案的實際情境：

**Critical** — 能讓攻擊者在他人機器上執行程式碼或竊取憑證。實例：
workflow 把不可信輸入內插進 `run:`；相依套件被換成惡意版本；
往 `main` 合入會被自動部署的惡意程式碼。

**High** — 真的能在訪客瀏覽器執行 JS。實例：把 OSM 名稱塞進
`dangerouslySetInnerHTML`；或存檔內容被丟進 `eval` / `new Function`。

**Medium** — 建置期完整性問題。實例：遠端資料能決定寫檔路徑；
惡意 Overpass 回應造成 prototype pollution 並改變產出的 pack；
被污染的 pack 悄悄產生錯誤模擬結果卻通過 `npm run calibrate`。

**Low** — 影響僅限使用者自己。實例：畸形存檔讓分頁當掉；
惡意 pack 讓 canvas 畫爆。

**Ignore（不要報）** — 對一個沒有帳號、沒有 secret 的靜態遊戲網站來說沒有實際影響：
- 缺 CSP / HSTS / X-Frame-Options 之類的安全 headers
- cookie flags（本專案不用 cookie）
- `npm audit` 對 devDependency 的告警，且沒有指出實際可達的利用路徑
- 玩家自己輸入造成自己分頁變慢的「DoS」
- 開放重新導向、點擊劫持、版本號洩漏

> 報 finding 前先確認：**攻擊者是誰、他控制什麼、走哪條路徑到達、造成什麼影響。**
> 四個問題有任何一個答不出來，就不要報。
