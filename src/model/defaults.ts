import type { CostModel, ModeSpec, SimParams, TransitMode } from './types';

/**
 * 各運具的預設參數。
 *
 * 建設成本是台灣實務的「數量級」估計，單位為新台幣億元，非官方決算數字。
 * 參考依據：地下捷運約 30–60 億/km（信義線、松山線量級），高架約其 1/3，
 * 輕軌約 5–8 億/km（淡海輕軌量級），公車專用道則以道路改善成本計。
 * 這些值可在 city pack 的 costModel 覆寫，方便日後校準。
 */
export const DEFAULT_MODES: Record<TransitMode, ModeSpec> = {
  metro_underground: {
    id: 'metro_underground',
    name: '地下捷運',
    buildCostPerKm: 40,
    stationCost: 25,
    opCostPerVehKm: 420,
    avgSpeedKmh: 35,
    capacityPerVehicle: 1900,
    dwellSec: 30,
    minHeadwaySec: 90,
    maxHeadwaySec: 900,
    defaultHeadwaySec: 240,
    riverCrossingMultiplier: 1.6,
    color: '#0070BD',
  },
  metro_elevated: {
    id: 'metro_elevated',
    name: '高架捷運',
    buildCostPerKm: 15,
    stationCost: 12,
    opCostPerVehKm: 380,
    avgSpeedKmh: 35,
    capacityPerVehicle: 1900,
    dwellSec: 30,
    minHeadwaySec: 90,
    maxHeadwaySec: 900,
    defaultHeadwaySec: 300,
    riverCrossingMultiplier: 1.25,
    color: '#C48C31',
  },
  lrt: {
    id: 'lrt',
    name: '輕軌',
    buildCostPerKm: 6,
    stationCost: 2,
    opCostPerVehKm: 150,
    avgSpeedKmh: 20,
    capacityPerVehicle: 265,
    dwellSec: 25,
    minHeadwaySec: 120,
    maxHeadwaySec: 900,
    defaultHeadwaySec: 360,
    riverCrossingMultiplier: 1.4,
    color: '#00A0A0',
  },
  bus: {
    id: 'bus',
    name: '公車／BRT',
    buildCostPerKm: 1,
    stationCost: 0.2,
    opCostPerVehKm: 60,
    avgSpeedKmh: 16,
    capacityPerVehicle: 80,
    dwellSec: 20,
    minHeadwaySec: 90,
    maxHeadwaySec: 1800,
    defaultHeadwaySec: 480,
    riverCrossingMultiplier: 1.0,
    color: '#7A5AA8',
  },
};

export const DEFAULT_COST_MODEL: CostModel = {
  modes: DEFAULT_MODES,
  farePerTrip: 25,
  serviceHoursPerDay: 18,
};

/**
 * 模擬參數的初始值。gravityBeta 與 logit 係數是靠 npm run calibrate
 * 對照真實台北捷運運量調出來的 — 調整前請先讀 docs/simulation.md。
 */
export const DEFAULT_SIM_PARAMS: SimParams = {
  gravityBeta: 0.02,
  tripsPerPersonPerDay: 2.4,
  peakHourShare: 0.12,
  walkSpeedKmh: 4.8,
  maxWalkM: 800,
  transferPenaltyMin: 5,
  carSpeedKmh: 22,
  // 壅塞回饋：把車流從道路移到軌道上，剩下的人開車才會變快。
  // 少了這一段，模擬會得出「蓋捷運讓平均通勤時間變長」的荒謬結論 ——
  // 因為模型裡搭車的人旅行時間本來就比開車長，卻沒有任何人因此受益。
  // roadCapacityPeakTrips 設成接近尖峰總旅次數，代表現況的道路已經在容量邊緣。
  carFreeFlowSpeedKmh: 32,
  roadCapacityPeakTrips: 1_920_000,
  congestionAlpha: 0.6,
  congestionBeta: 4,
  detourFactor: 1.32,
  logitConstant: -0.72,
  logitTimeCoef: 0.11,
  odTopK: 50,
};

/** 玩家新增路線時輪流套用的顏色。刻意避開真實台北捷運的線色以免混淆。 */
export const LINE_PALETTE = [
  '#E3002C',
  '#0070BD',
  '#008659',
  '#F8B61C',
  '#C48C31',
  '#8A4FBF',
  '#00A0A0',
  '#E0007F',
  '#5B7F3A',
  '#D2691E',
];
