# City Pack —— 怎麼加入一座新城市

遊戲程式本身不知道「台北」是什麼。它只讀一個 **city pack**：
一個自給自足的 JSON，描述一座城市的地理、人口、就業、既有路網與各種參數。

**加一座新城市 = 寫一個新的 pack，不用改任何遊戲程式碼。**

---

## 結構

```ts
interface CityPack {
  id: string;                    // "taipei"
  name: string;                  // "雙北都會區"
  bbox: [west, south, east, north];

  districts: District[];         // 行政區，主要用於標籤與人口統計
  zones: Zone[];                 // 分析單元（雙北用村里），模擬的最小顆粒
  employmentCenters: EmpCenter[];// 就業推估的輸入
  referenceNetwork: PackNetwork; // 現實既有路網（可留空）

  costModel: CostModel;          // 各運具造價、營運成本、票價
  simParams: SimParams;          // 重力模型與 logit 係數、速度、壅塞參數
  baseOD: SparseOD;              // 預先算好的起訖矩陣

  sources: SourceRef[];          // 每份資料的出處與年份，會顯示在 UI 上
}
```

完整的型別定義在 `src/model/types.ts`，那是唯一的權威來源。

### Zone

模擬的最小單元。雙北用村里（1465 個），但這只是選擇 —— 用網格、
統計區或郵遞區號都可以，只要每個 zone 有位置、面積、人口、就業與多邊形。

```ts
interface Zone {
  id: number;            // 索引，必須等於它在陣列裡的位置
  code: string;          // 原始資料的代碼
  name: string;
  districtId: number;
  lon: number; lat: number;   // 形心
  areaKm2: number;
  population: number;
  jobs: number;
  rings: number[][];     // 多邊形環，每環是扁平化的 [lon,lat,lon,lat,...]
}
```

**zone 數量的取捨**：起訖矩陣是 O(n²)。1465 個 zone → 215 萬格，
建 pack 時約 0.7 秒、記憶體 8.6 MB，很舒服。
超過 3000 個 zone 就要考慮改用階層式或更激進的稀疏化。

### SparseOD

```ts
interface SparseOD {
  rowStart: number[];  // 長度 = zones 數 + 1
  dest: number[];      // 目的地 zone id
  flow: number[];      // 尖峰小時旅次
}
```

CSR 格式。第 `i` 個 zone 的起訖對在 `dest[rowStart[i] .. rowStart[i+1]]`。

這是**預先算好的**，因為行程產生與分布只取決於人口與就業，跟玩家蓋什麼線無關。
用 `src/sim/demand.ts` 的 `buildGravityOD()` 產生。

---

## 加一座新城市的步驟

以「高雄」為例：

### 1. 準備原始資料 → `data/sources/`

需要三樣東西：

- **分析單元的多邊形**（GeoJSON，含名稱與所屬行政區）
- **人口**（能對應到行政區或直接對應到分析單元）
- **既有路網**（選用；沒有的話 `referenceNetwork` 給空的 `{stations:[],lines:[]}`）

台灣的城市可以直接沿用 `scripts/fetch-sources.ts` 的做法：
村里界來自 npm 套件 `taiwan-atlas`（內政部圖資，全台都有），
把 `TARGET_COUNTIES` 改成 `new Set(['高雄市'])` 即可。

### 2. 寫城市專屬設定

複製 `scripts/taipei-config.ts` 成 `kaohsiung-config.ts`，改三樣：

- `EMPLOYMENT_CENTERS` —— 該市的主要就業中心（位置、就業數、衰減半徑）
- `LOCAL_JOB_RATE` / `JOB_POP_EXPONENT` —— 通常沿用即可
- `SOURCES` —— 資料出處，會顯示在 UI 的「資料來源」視窗

> 就業中心是最需要花心思的部分，它直接決定通勤流向。
> 半徑不要為了「加強」某個中心而放大 —— 那會把工作攤散到走不到的地方，
> 反而讓該站運量下降。詳見 `docs/simulation.md`。

### 3. 複製並調整建置腳本

`scripts/build-city-pack.ts` 大致可以照抄，主要改：

- 讀取的檔名
- 人口對應的鍵（不同資料集的行政區命名慣例不同）
- 結尾的驗收斷言（zone 數、總人口、既有路網站數）

**驗收斷言請務必寫。** 開發雙北版本時，正是這些斷言在資料對應出錯時立刻擋下來，
而不是等到遊戲跑出奇怪的數字才發現。

### 4. 校準

複製 `scripts/calibrate.ts`，把該市既有的路網餵進模擬器，
跟公開的實際運量對照，調整 `simParams` 直到吻合。

沒有既有路網的城市（例如純虛構的城市）就沒辦法這樣校準，
這時直接沿用雙北校準出來的參數是合理的起點。

### 5. 掛上去

把產出的 `public/city-packs/kaohsiung.json` 放好，
在 `src/state/store.ts` 的 `init()` 改成可選城市即可。
（目前是寫死載入 `taipei.json`；要支援多城市選單的話，這裡是唯一要動的地方。）

---

## 為什麼幾何資料是內建的，不是線上圖磚

遊戲不依賴任何線上圖磚服務，所有幾何都打包在 pack 裡，用 Canvas 2D 自己畫。

- 美術風格可以完全掌控，看起來像遊戲而不是地圖網站
- 離線可玩，不受圖磚服務的使用條款與流量限制
- 雙北 1465 個多邊形只有 34,412 個座標點，Canvas 畫起來毫無壓力

代價是沒有街道細節。對一個「規劃路網」的遊戲來說，這是划算的取捨。
