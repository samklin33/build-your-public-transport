---
name: diff-review
description: >
  對本專案的 Git 改動做 code review——working copy、某個 commit、或分支比較。
  適用於使用者說「review 我的改動」「幫我看這個 PR」「這樣寫可以嗎」
  「檢查一下 code」「合之前先看一下」的時候。依照 .opencodereview/rule.json
  的專案規則逐檔審查，輸出帶行號、分類、嚴重度的結構化意見。
  安全性專用檢查請改用 security-scan。
license: Apache-2.0
metadata:
  adapted-from: https://github.com/alibaba/open-code-review
  note: >
    改寫自 open-code-review 的 delegate 模式（skills/open-code-review-delegate）。
    delegate 模式本來就不需要 LLM 端點——OCR 只做檔案篩選與規則解析。
    此處連 ocr CLI 都不需要：用 git 直接做檔案篩選，規則從
    .opencodereview/rule.json 讀（格式與 ocr 相容，裝了 ocr 也能用）。
---

# Diff Review

依照專案自己的規則做 code review。不需要外部 CLI，也不需要額外的 API key。

> 如果環境裡剛好有 `ocr`（`npm i -g @alibaba-group/open-code-review`），
> 可以用 `ocr delegate preview` 與 `ocr delegate rule <paths>` 取代
> 步驟 1、2 —— 它讀的是同一份 `.opencodereview/rule.json`。沒裝就照下面走，
> 結果一樣。

## 步驟 1 — 決定要看哪些檔案

| 使用者說 | 指令 |
|---|---|
| 「review 我的改動」（預設） | `git status --short && git diff HEAD` |
| 「review 這個 PR / 分支」 | `git diff $(git merge-base main HEAD)..HEAD` |
| 「review commit abc123」 | `git show abc123` |
| 「哪些檔案會被 review？」 | 只列清單，不進行 review |

untracked 檔案要一併納入（整個檔案都是新程式碼），直接讀檔而不是用 `git diff`。

**排除這些**——它們是產物或抓下來的資料，不是手寫程式碼：

```
public/city-packs/*.json    生成的 city pack
data/sources/*              抓下來的開放資料
package-lock.json
node_modules/  dist/  dist-single/
```

排除它們的原因是 diff 很大且無意義。但如果**生成它們的腳本**改了，
那些腳本本身要 review。

## 步驟 2 — 取得規則

讀 `.opencodereview/rule.json`。對每個要 review 的檔案，找出 `path` glob
匹配的規則。同一條規則涵蓋的檔案一起處理，不要重複貼規則內容。

沒有匹配到規則的檔案，用通用標準 review（正確性、可讀性、是否符合周圍慣例）。

## 步驟 3 — 逐檔 review

對每個檔案：

1. 取得它的 diff
2. 套用步驟 2 找到的規則
3. **讀周圍的程式碼**，不要只看 diff 那幾行。這個專案的模擬邏輯有很多
   跨檔案的隱含契約（例如 `src/sim/` 跟 `scripts/build-city-pack.ts` 對
   city pack 結構的假設必須一致）
4. 判斷改動是否破壞了既有的驗收（`npm test`、`npm run calibrate`）

本專案特別容易出問題的地方：

- **city pack 結構改動**——`scripts/build-city-pack.ts` 產出的形狀變了，
  `src/model/types.ts`、`src/render/`、`src/sim/` 都要跟著改，
  而且 `public/city-packs/taipei.json` 要重新產生
- **模擬參數**——改了 `src/model/defaults.ts` 或成本模型要跑
  `npm run calibrate`，對照真實台北捷運不能跑掉
- **座標精度**——降精度會縮小檔案但影響 render 與路徑計算
- **Overpass 查詢**——改 `scripts/overpass.ts` 的查詢要考慮鏡像會 504
  （fallback 鏈必須保留）

## 步驟 4 — 分級並回報

每筆意見要有：

| 欄位 | 必填 | 說明 |
|---|---|---|
| `path` | 是 | 相對路徑 |
| `line` | 是 | 行號（`檔案:行號` 格式，可點擊） |
| `content` | 是 | 問題描述 |
| `category` | 是 | bug / performance / maintainability / test / style / docs |
| `severity` | 是 | high / medium / low |

分級：

- **High** — 明確的 bug、會破壞既有驗收的改動、有精確修法的紮實建議
- **Medium** — 合理但取決於情境的疑慮、效能問題、需要人工判斷的修改
- **Low** — 風格細節、微小建議。**只有在真的有價值時才報**

**Low 以下直接丟掉，不要列出來。** 可能是誤報、缺乏足夠上下文、
純粹挑毛病的，靜靜丟棄。使用者要的是能行動的意見，不是清單長度。

安全性問題不要在這裡處理——交給 `/security-scan`，它有 threat model 跟
嚴重度準則。

## 輸出格式

```markdown
## Code Review 結果

**檔案**：N 個
**問題**：X high / Y medium

### High

- **`src/sim/graph.ts:42`** — 一句話描述
  > 建議：具體怎麼改

### Medium

- **`scripts/build-city-pack.ts:88`** — 一句話描述
  > 建議：具體怎麼改
```

沒問題就直接說：「Review 完成 —— N 個檔案，沒有發現問題。」

## 步驟 5 — 修（選用）

先確認使用者的意圖：

- 說了「review 並修」之類的 → 直接修
- 只說「review」 → **先問過再動任何程式碼**

修的時候專注在 High 與 Medium。修完要跑 `npm test` 跟 `npm run typecheck`
確認沒弄壞東西。

## 常見錯誤

- **只看 diff 不看周圍** → 漏掉跨檔案契約被打破
- **報一堆 low** → 訊噪比變差，重要的被淹沒
- **review 生成的檔案** → `taipei.json` 的 diff 有幾萬行且完全沒有意義
- **沒問就開始改** → 使用者只是想知道有什麼問題
- **在這裡處理安全問題** → 沒有 threat model 就會誤判嚴重度，用 `/security-scan`
