/**
 * 全專案共用的型別定義。
 * scripts/（Node 端的資料管線）與 src/（瀏覽器端）都從這裡取用。
 */

// ─────────────────────────────────────────── 運具

export type TransitMode = 'metro_underground' | 'metro_elevated' | 'lrt' | 'bus';

export const MODE_ORDER: TransitMode[] = [
  'metro_underground',
  'metro_elevated',
  'lrt',
  'bus',
];

export interface ModeSpec {
  id: TransitMode;
  name: string;
  /** 建設成本（新台幣「億元」／公里）。城市 pack 可覆寫。 */
  buildCostPerKm: number;
  /** 每站建設成本（億元）。 */
  stationCost: number;
  /** 營運成本（新台幣元／車公里）。 */
  opCostPerVehKm: number;
  /** 含停站的平均營運速度（km/h）。 */
  avgSpeedKmh: number;
  /** 每班車的載客量（人）。 */
  capacityPerVehicle: number;
  /** 每站的平均停站時間（秒）。 */
  dwellSec: number;
  minHeadwaySec: number;
  maxHeadwaySec: number;
  defaultHeadwaySec: number;
  /** 跨河路段的造價加成倍率。 */
  riverCrossingMultiplier: number;
  /**
   * 走線係數：實際路線長度 ÷ 兩站直線距離。
   *
   * 真實路線不可能是直線 —— 要沿著路廊、避開建物、配合地形。
   * 玩家畫的線沒有實際走線資料，就用這個係數把長度修正回合理值，
   * 否則建設成本與行駛時間都會被系統性低估。
   * 軌道系統的 1.10 是從真實台北捷運量出來的（159.1 km ÷ 145.3 km）；
   * 公車必須沿著街廓走，繞得更多。
   */
  alignmentFactor: number;
  /** 預設畫線顏色。 */
  color: string;
}

// ─────────────────────────────────────────── 城市資料

export interface District {
  id: number;
  code: string;
  name: string;
  county: string;
  population: number;
  areaKm2: number;
}

export interface Zone {
  id: number;
  code: string;
  name: string;
  districtId: number;
  /** 幾何中心（經緯度）。 */
  lon: number;
  lat: number;
  areaKm2: number;
  population: number;
  /** 就業人口。無真實資料，由就業中心模型推估 — 見 docs/simulation.md。 */
  jobs: number;
  /** 多邊形環，每環是扁平化的 [lon,lat,lon,lat,...]。 */
  rings: number[][];
}

/**
 * 道路。
 *   0 幹道（trunk/primary）—— 夠寬，高架與 BRT 可行
 *   1 次要道路（secondary/tertiary）—— 公車可走
 *   2 街廓道路（residential/unclassified）—— 只做底圖紋理
 */
export interface Road {
  cls: 0 | 1 | 2;
  name: string;
  /** 折線，扁平化的 [lon,lat,lon,lat,...]。 */
  path: number[];
}

/** 水域多邊形（外環，扁平化的 [lon,lat,...]）。 */
export interface Water {
  name: string;
  ring: number[];
}

export interface EmploymentCenter {
  name: string;
  lon: number;
  lat: number;
  /** 該中心的就業機會數。 */
  jobs: number;
  /** 距離衰減半徑（公里）。 */
  radiusKm: number;
}

export interface PackStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface PackLine {
  id: string;
  name: string;
  color: string;
  mode: TransitMode;
  stationIds: string[];
  headwaySec: number;
  /**
   * 每一段（第 i 站到第 i+1 站）的實際走線，扁平化的 [lon,lat,lon,lat,...]。
   * 長度為 stationIds.length - 1。沒有這筆資料時就退回兩站之間的直線。
   *
   * 真實路線是彎的：文湖線兩站直線相加只有 22.2 km，實際軌道長 27.4 km，
   * 少算 19%。整個台北捷運少算 9%，換算成建設成本就是 552 億。
   */
  segmentShapes?: number[][];
}

export interface PackNetwork {
  stations: PackStation[];
  lines: PackLine[];
}

/**
 * 稀疏起訖矩陣。每個 zone 只保留權重最高的前 K 個目的地。
 * 三個陣列等長且一一對應，用扁平陣列而非物件陣列以縮小檔案並加速載入。
 */
export interface SparseOD {
  /** 每個 origin zone 在 dest/flow 裡的起始索引，長度 = zones 數 + 1。 */
  rowStart: number[];
  /** 目的地 zone id。 */
  dest: number[];
  /** 尖峰小時的行程數。 */
  flow: number[];
}

export interface CostModel {
  modes: Record<TransitMode, ModeSpec>;
  /** 平均票箱收入（元／趟）。 */
  farePerTrip: number;
  /** 每日營運班次時數，用來從班距推算車公里。 */
  serviceHoursPerDay: number;
}

export interface SimParams {
  /** 重力模型的距離衰減係數。 */
  gravityBeta: number;
  /** 每人每日總行程數。 */
  tripsPerPersonPerDay: number;
  /** 尖峰小時佔全日行程的比例。 */
  peakHourShare: number;
  /** 步行速度（km/h）。 */
  walkSpeedKmh: number;
  /** 願意步行到車站的最大距離（公尺）。 */
  maxWalkM: number;
  /** 轉乘的等效時間罰值（分鐘）。 */
  transferPenaltyMin: number;
  /** 建立起訖矩陣時用的代表性私人運具速度（km/h）。與下面的壅塞模型分開。 */
  carSpeedKmh: number;
  /** 道路無壅塞時的私人運具速度（km/h）。 */
  carFreeFlowSpeedKmh: number;
  /** 尖峰小時道路可順暢承載的旅次數，超過就開始塞。 */
  roadCapacityPeakTrips: number;
  /** BPR 壅塞函數的係數。 */
  congestionAlpha: number;
  congestionBeta: number;
  /** 直線距離換算實際路徑的繞路係數。 */
  detourFactor: number;
  /** 運具選擇 logit 的常數項，越大越偏好私人運具。 */
  logitConstant: number;
  /** 運具選擇 logit 對時間差的敏感度（每分鐘）。 */
  logitTimeCoef: number;
  /** 稀疏 OD 每個起點保留的目的地數。 */
  odTopK: number;
}

export interface SourceRef {
  name: string;
  provider: string;
  year: string;
  url: string;
  note?: string;
}

export interface CityPack {
  id: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  districts: District[];
  zones: Zone[];
  /**
   * 陸地範圍（縣市界的環）。畫在村里之下當底圖。
   *
   * 村里界只畫到河岸，河面本身留白；少了這層底圖，那些縫隙會露出背景色，
   * 看起來像一條又細又斷的假河 —— 而且只有縣市界經過的河才會出現這種縫隙，
   * 完全在台北市內的基隆河反而一點都看不到。
   */
  landmass: number[][];
  /** 主要道路。空陣列代表這座城市還沒有道路資料。 */
  roads: Road[];
  /** 水域。空陣列代表還沒跑過 npm run fetch:water。 */
  water: Water[];
  employmentCenters: EmploymentCenter[];
  /** 現實世界既有路網，供「現況延伸」情境與校準對照使用。 */
  referenceNetwork: PackNetwork;
  costModel: CostModel;
  simParams: SimParams;
  baseOD: SparseOD;
  sources: SourceRef[];
}

// ─────────────────────────────────────────── 玩家的路網（執行期可變）

export interface Station {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface Line {
  id: string;
  name: string;
  color: string;
  mode: TransitMode;
  stationIds: string[];
  headwaySec: number;
  /** 實際走線，見 PackLine.segmentShapes。玩家自己畫的線沒有這筆資料。 */
  segmentShapes?: number[][];
}

export interface Network {
  stations: Record<string, Station>;
  lines: Line[];
}

// ─────────────────────────────────────────── 模擬結果

export interface StationResult {
  /** 尖峰小時上車人次。 */
  boardings: number;
  alightings: number;
  /** 換乘人次。 */
  transfers: number;
}

export interface SegmentLoad {
  lineId: string;
  fromStationId: string;
  toStationId: string;
  /** 尖峰小時單向最大斷面客流。 */
  load: number;
  /** load ÷ 該路段運能。>1 代表爆滿。 */
  loadFactor: number;
}

export interface LineResult {
  lineId: string;
  /** 尖峰小時總搭乘人次。 */
  ridership: number;
  /** 全日推估搭乘人次。 */
  dailyRidership: number;
  lengthKm: number;
  /** 最大斷面客流。 */
  maxLoad: number;
  maxLoadFactor: number;
  buildCost: number;
  annualOpCost: number;
  annualFareRevenue: number;
}

export interface Finance {
  /** 總建設成本（億元）。 */
  totalBuildCost: number;
  /** 年營運成本（億元）。 */
  annualOpCost: number;
  /** 年票箱收入（億元）。 */
  annualFareRevenue: number;
  /** 年營運損益（億元），負值代表需要補貼。 */
  annualBalance: number;
  /** 每人次補貼額（元）。 */
  subsidyPerTrip: number;
  /** 票箱回收率。 */
  fareboxRecovery: number;
}

export interface SimResult {
  /** 尖峰小時的大眾運輸旅次。 */
  peakTransitTrips: number;
  /** 全日大眾運輸旅次。 */
  dailyTransitTrips: number;
  /** 大眾運輸分擔率。 */
  modeShare: number;
  /** 搭乘大眾運輸者的平均旅行時間（分鐘）。 */
  avgTransitTimeMin: number;
  /** 全體（含私人運具）的平均旅行時間（分鐘）。 */
  avgAllTimeMin: number;
  /** 未建設任何路網時的平均旅行時間，用來顯示「改善了多少」。 */
  baselineTimeMin: number;
  /** 住在車站 800 公尺內的人口。 */
  coveredPopulation: number;
  coveragePct: number;
  stations: Record<string, StationResult>;
  lines: LineResult[];
  segments: SegmentLoad[];
  finance: Finance;
  /** 每個 zone 的平均大眾運輸可及時間（分鐘），用於地圖著色。Infinity 表示無服務。 */
  zoneAccessMin: Float32Array;
  /** 每個 zone 是否在步行範圍內有車站。 */
  zoneCovered: Uint8Array;
  computeMs: number;
}
