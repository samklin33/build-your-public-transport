# Severity Policy

改寫自 [openai/codex-security](https://github.com/openai/codex-security) 的
`skills/attack-path-analysis/references/severity-policy.md`（Apache-2.0）。
原版針對企業級服務，此處刪掉本專案不可能出現的類別（多租戶、資料庫、
記憶體毀損、雲端憑證），並補上本專案的實際情境。

在 attack path 與反證都確立**之後**才做定級。

## 通則

- `high` 以上，影響必須是**實質安全相關**的（帳號被接管、認證繞過、
  有意義的權限提升、重大敏感資料外洩、可信的 RCE），不能只是「這是個 bug」。
- 要維持 `high`／`critical`，利用路徑與影響必須清楚到**一個專業安全工程師
  不需要一長串臆測論證就能認同**。
- **不要因為某個東西是 bug、或因為掃描器貼了標籤，就把普通 bug 當成高危安全問題。**
- 不要因為「湊巧的、高度臆測的、只有極端邊界情況成立」的利用故事就維持 `critical`。
  critical 的意思是「立刻要處理，威脅是真實且可能發生的」。
- 如果它是真的 bug 但不是安全漏洞 → 定為 `ignore`（真的必要時 `low`），
  然後走一般 code review 回報。
- 如果能證明它根本不是 bug（描述完全錯誤）→ 定為 `ignore`，標記為誤報。

## 本專案的分級

`SECURITY.md` 有完整版。摘要：

### Critical — 在他人機器上執行程式碼

- GitHub Actions workflow 把不可信輸入直接內插進 `run:`
  （`${{ github.event.pull_request.title }}` 這類）
- 相依套件被替換成惡意版本，或 postinstall 執行任意程式碼
- 未經審查的惡意程式碼被合進 `main`（會自動部署到 GitHub Pages）
- 未釘住的 third-party action 拿到寫入權限

### High — 在訪客瀏覽器執行 JS

- OSM 名稱或存檔內容進到 `dangerouslySetInnerHTML` / `innerHTML`
- 任何走到 `eval` / `new Function` 的路徑
- 由不可信資料組出來的 `<a href>` / `<img src>`（`javascript:` URL）

### Medium — 建置期完整性

- 遠端抓來的資料能決定寫檔路徑（path traversal 進 `scripts/`）
- Overpass 回應造成 prototype pollution 並改變產出的 city pack
- 被污染的資料悄悄產生錯誤的模擬結果卻通過 `npm run calibrate`

### Low — 只影響使用者自己

- 畸形存檔讓分頁當掉或吃光記憶體
- 惡意 city pack 讓 canvas render 爆掉

## 不要報這些

對一個**沒有帳號、沒有 secret、沒有後端**的靜態遊戲網站沒有實際影響：

- 缺 CSP、HSTS、X-Frame-Options、`X-Content-Type-Options` 等 headers
- cookie flags —— 本專案完全不用 cookie
- `npm audit` 的 devDependency 告警，且沒有指出實際可達的利用路徑
  （build 期會跑的相依套件是另一回事，那走供應鏈評估）
- 使用者自己輸入造成自己分頁變慢的「DoS」
- 開放重新導向、點擊劫持、使用者列舉、速率限制、版本號洩漏、目錄列表
- 「如果跟別的東西串起來可能會很危險」但講不出那個「別的東西」是什麼
- 需要攻擊者**已經**有 push 權限或本機 shell 才成立的問題
  （除非權限提升本身就是要報的那個問題）

## 誤報的判別

以下**不是**「這裡有漏洞」的證據：

- 某個危險函式在 repo 裡出現過 —— 要證明不可信資料能到達它
- 某段程式碼「看起來不安全」—— 要指出 source 與 sink
- 某個輸入沒有被驗證 —— 要說明沒驗證會導致什麼
- 靜態分析工具說有問題 —— 要自己驗證，工具不會看 threat model

以下**是**有效的抑制理由（要指名）：

- 「React 把它當文字節點 render，會 escape」
- 「這個值來自寫死的常數清單，不是使用者輸入」
- 「這段只在 `scripts/` 跑，開發者本機執行，不在攻擊面上」
- 「這條路徑前面有 `<具體的檢查>` 擋住」
