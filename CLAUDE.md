# CLAUDE.md

## 這個專案

雙北大眾運輸規劃遊戲。純前端（React + Vite + zustand + canvas），
沒有後端，部署在 GitHub Pages。資料來自 OSM／Overpass 與政府開放資料。

```
scripts/          建置期：抓資料、產 city pack、校準
data/sources/     抓下來的原始資料（已 commit）
public/city-packs/taipei.json   產出的 pack（已 commit，決定性產物）
src/model/        型別與預設參數
src/sim/          模擬核心（需求、圖、Dijkstra）
src/render/       canvas 繪製
src/ui/           React 面板
```

## 常用指令

```bash
npm run dev            # 開發伺服器
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run calibrate      # 對照真實台北捷運的校準檢查
npm run build:pack     # 從 data/sources/ 重建 city pack（不連外網）
npm run fetch:roads    # 從 Overpass 抓道路（會連外網）
npm run fetch:water    # 從 Overpass 抓水域（會連外網）
npm run build          # 正式建置
npm run build:single   # 單檔版：整個遊戲內嵌成一份 HTML
```

## 幾個容易踩到的點

- **city pack 是 commit 進 repo 的產物。** 改了 `scripts/` 或 `data/sources/`
  就要跑 `npm run build:pack` 並把產出的 pack 一起 commit。CI 會比對，不同步會擋。
- **`build:pack` 是決定性的**——同樣的 `data/sources/` 必得同樣的輸出。
- **Overpass 公開鏡像常回 504。** `scripts/overpass.ts` 的鏡像 fallback 鏈要保留。
- **改模擬參數或成本模型要跑 `npm run calibrate`。**
- **OSM 來的名稱是第三方可編輯輸入。** 不要用 `dangerouslySetInnerHTML`。
- 安全性相關的判準寫在 `SECURITY.md`。

## 專案 Skills

| Skill | 用途 |
|---|---|
| `/security-scan` | 安全檢查。改寫自 [openai/codex-security](https://github.com/openai/codex-security) 的方法論與嚴重度準則 |
| `/diff-review` | Code review。改寫自 [alibaba/open-code-review](https://github.com/alibaba/open-code-review) 的 delegate 模式 |

review 規則放在 `.opencodereview/rule.json`（格式與 `ocr` CLI 相容）。

## PR 流程

Sam 授權：**side project 自己開 PR，CI 過了自己合。**（2026-08-05）

流程：

1. 在指定的 `claude/*` 分支上開發
2. 開 PR 到 `main`
3. 等 `.github/workflows/ci.yml` 跑完
4. **CI 全綠**才 squash merge，然後刪掉分支
5. merge 到 `main` 會觸發 `deploy.yml` 自動部署到 GitHub Pages

不自己合、要先問 Sam 的情況：

- CI 是紅的，或有 check 還沒跑完
- 需要 force push 覆寫別人的 commit，或改寫 `main` 的歷史
- 刪資料、改 CI 權限、加新的 third-party GitHub Action
- 改動超出 Sam 當初要求的範圍
- 自己對這個改動的正確性沒把握

授權範圍是這個 repo 這類 side project。有正式使用者或協作者的專案不適用。
