# 雙北運輸規劃 · Build Your Public Transport

用**真實的開放資料**規劃你自己的雙北大眾運輸路網，然後看模擬告訴你這樣蓋會怎樣。

比《Cities: Skylines》單純：這裡只做大眾運輸規劃這一件事。
沒有土地分區、沒有道路繪製、沒有水電管線、沒有地形編輯、沒有單體車輛模擬。
畫出一條會動的線只要三步：**選運具 → 在地圖上點站 → 按 Enter**。

而且地圖是真的台北跟新北，不是隨機生成的虛構城市。

---

## 快速開始

```bash
npm install
npm run build:pack     # 由 data/sources/ 產生城市資料（原始資料已在 repo 裡）
# 道路資料要另外抓一次（已 commit，通常不用重跑）：npm run fetch:roads
npm run dev            # http://localhost:5173
```

想更新到更新年份的資料再跑 `npm run fetch:sources`（需要連外網路）。

其他指令：

```bash
npm run calibrate      # 用真實台北捷運驗證模擬器準不準
npm test               # 單元測試
npm run build          # 產生靜態網站到 dist/
npm run build:single   # 產生單檔版 dist-single/index.html
```

## 部署

### 單檔版（最簡單）

`npm run build:single` 會把城市資料、JS、CSS 全部內嵌成**一個 HTML 檔**，
直接雙擊就能玩，不需要伺服器也不需要網路。約 1.8 MB。

模擬預設跑在 Web Worker，但遇到擋 blob: worker 的嚴格 CSP 環境會自動退回主執行緒
（全網模擬只要 50–70 ms，主執行緒跑也不會卡）。

### GitHub Pages

已部署於 **https://samklin33.github.io/build-your-public-transport/**

`.github/workflows/deploy.yml` 會在推上 `main` 時自動建置並部署，
部署前先跑單元測試與校準檢查 —— 模擬器算不準就不該發出去。
功能分支也會跑測試與校準，但不部署。

第一次設定時踩到的兩個坑，記錄在這裡免得重蹈：

1. **Pages 必須先手動啟用一次**：repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。
   workflow 沒辦法自動完成，`GITHUB_TOKEN` 沒有建立 Pages site 的權限
   （`configure-pages` 會回 `Resource not accessible by integration`）。

2. **只能從預設分支部署**：啟用 Pages 時自動建立的 `github-pages` 環境，
   預設只允許預設分支部署。從功能分支跑的話，`deploy` job 會在還沒開始執行前
   就被擋掉 —— 狀態是 failure 但**完全沒有 log**，很難查。
   所以 `deploy` job 加了 `if: github.ref == 'refs/heads/main'`。

---

## 玩法

1. 選**情境**：「白紙重畫」（雙北完全沒有軌道運輸，從零規劃）或
   「現況延伸」（載入現實的台北捷運 116 站，規劃下一階段擴建）
2. 選**運具**：地下捷運（40 億/km）、高架捷運（15 億/km）、輕軌（6 億/km）、公車／BRT（1 億/km）
3. 在地圖上依序**點擊車站**位置，按 <kbd>Enter</kbd> 完成
   - 點到既有車站附近會自動吸附，形成轉乘站
   - <kbd>Backspace</kbd> 退一步、<kbd>Esc</kbd> 取消
4. 模擬立刻重跑（約 50–70 ms），右側面板更新

### 看得到什麼

- **各站／各線運量** —— 每條線的全日搭乘人次、最大斷面負載率（超過 100% 代表尖峰擠不上車）
- **人口涵蓋率** —— 多少人住在車站 800 公尺步行範圍內，地圖著色直接顯示服務缺口
- **通勤時間變化** —— 跟「完全沒有大眾運輸」相比改善了多少
- **財務** —— 建設成本、年營運成本、票箱收入、回收率

地圖著色可以切換「人口密度／涵蓋率／可及性」，路線粗細代表運量。

---

## 資料來源

| 資料 | 來源 | 年份 |
|---|---|---|
| 村里界與行政區界（41 區 / 1465 村里） | 內政部（經 npm `taiwan-atlas`） | 2021 |
| 各鄉鎮市區人口（總計 6,669,946 人） | 內政部戶政司 | 民國 106 年 |
| 台北捷運站點與站序（116 站 / 7 條分支）與實際軌道走線 | OpenStreetMap route relation | 2026 |
| 雙北主要道路（11,236 段幹道與次要道路） | OpenStreetMap（經 [game-project](https://github.com/samklin33/game-project) 擷取） | 2026 |

**村里層級人口**是由區級往下推估的，**就業分布**沒有開放資料、是用就業中心模型合成的。
兩者都在 UI 的「資料來源」視窗與 `docs/simulation.md` 中明確標示。

這個模擬適合用來**比較不同規劃方案的相對優劣**，不適合當作工程可行性或財務評估的依據。

---

## 模擬準不準？

`npm run calibrate` 會把**現實中的台北捷運**餵進模擬器，跟實際數字對照：

| 項目 | 模擬 | 現實 |
|---|---|---|
| 全日運量 | 2,082,485 | 約 210 萬人次 |
| 最繁忙路線 | 板南線（負載 85%） | 板南線 |
| 建設成本 | 9,449 億 | 約 7,000–9,000 億 |
| 年營運成本 | 199 億 | 約 180 億 |
| 票箱回收率 | 95% | 約 100–110% |

運量前幾大的車站（中山、忠孝復興、台北車站、台北101/世貿、台北小巨蛋…）
也與實際的台北捷運大站名單高度吻合。

模型細節、參數怎麼調、已知偏差有哪些 → [`docs/simulation.md`](docs/simulation.md)

---

## 換一座城市

遊戲程式不知道「台北」是什麼，它只讀一個 **city pack**（自給自足的 JSON）。
加一座新城市 = 寫一個新 pack，不用改遊戲程式碼。

步驟與注意事項 → [`docs/city-pack.md`](docs/city-pack.md)

---

## 架構

```
scripts/          資料管線（Node）
  fetch-sources     抓原始開放資料 → data/sources/
  build-city-pack   → public/city-packs/taipei.json
  calibrate         用真實路網驗證模擬器
src/
  model/          型別、幾何、成本、路網操作
  sim/            模擬引擎（跑在 Web Worker）
                    demand    重力模型 + IPF（建 pack 時執行）
                    graph     路網建圖
                    dijkstra  最短路徑
                    simulate  運具選擇 + 壅塞回饋 + 路網指派
  render/         Canvas 2D 地圖（自繪，不依賴線上圖磚）
  ui/             控制面板與分析面板
```

技術選型：Vite + React + TypeScript、Zustand、Web Worker、Web Mercator。
純靜態網站，沒有後端。

**設計上的兩個關鍵決定：**

1. **起訖矩陣烘焙進 pack。** 「誰想從哪去哪」只取決於人口與就業分布，
   跟玩家蓋什麼線無關，所以在建 pack 時算好。執行期只跑運具選擇與路網指派 ——
   這是能做到即時回饋的原因。

2. **指派時從車站而非 zone 出發跑 Dijkstra。** 車站數是幾百，zone 數是 1465，
   差一個數量級。

---

## 目前的範圍

已完成的是**沙盒**：自由規劃、即時模擬、四種分析輸出、兩種起始情境、存檔匯出匯入。

尚未實作的**挑戰層**：預算上限與年度推進、TOD 土地使用回饋（好的車站帶動周邊發展）、
評分與目標系統、更多城市。
