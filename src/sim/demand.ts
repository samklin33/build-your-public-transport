import { kmBetween } from '../model/geo';
import type { SparseOD } from '../model/types';

export interface DemandInput {
  lon: Float64Array;
  lat: Float64Array;
  population: Float64Array;
  jobs: Float64Array;
  gravityBeta: number;
  /** 每人每日行程數 × 尖峰小時佔比 = 尖峰小時每人行程數。 */
  tripsPerPersonPerDay: number;
  peakHourShare: number;
  carSpeedKmh: number;
  detourFactor: number;
  topK: number;
}

/**
 * 雙約束重力模型 + Furness/IPF 疊代，產生尖峰小時的起訖矩陣。
 *
 * 這一步「與路網無關」— 誰想從哪裡去哪裡只取決於人口與就業分布，
 * 不取決於玩家蓋了什麼線。因此在建 pack 時算好一次即可，
 * 執行期改線時完全不用重算，這是能做到即時回饋的關鍵。
 *
 * 排除 i===j 的區內旅次：那多半是步行或機車可達的短程，
 * 不是大眾運輸路網的服務對象，納入只會稀釋運具分擔率的解讀。
 */
export function buildGravityOD(input: DemandInput): {
  od: SparseOD;
  totalPeakTrips: number;
  iterations: number;
} {
  const n = input.population.length;
  const { lon, lat, population, jobs, gravityBeta, carSpeedKmh, detourFactor } = input;

  const peakTripsPerPerson = input.tripsPerPersonPerDay * input.peakHourShare;

  // 產生量（來自居住人口）與吸引量（來自就業機會）
  const P = new Float64Array(n);
  const A = new Float64Array(n);
  let sumP = 0;
  let sumA = 0;
  for (let i = 0; i < n; i++) {
    P[i] = population[i] * peakTripsPerPerson;
    A[i] = jobs[i];
    sumP += P[i];
    sumA += A[i];
  }
  // 雙約束模型要求總產生量 = 總吸引量，把吸引量等比例縮放對齊。
  const scale = sumA > 0 ? sumP / sumA : 0;
  for (let i = 0; i < n; i++) A[i] *= scale;

  // 阻抗矩陣 f_ij = exp(-β · 小汽車旅行時間)。1465² ≈ 215 萬格，用 Float32 存約 8.6 MB。
  const f = new Float32Array(n * n);
  const minPerKm = 60 / carSpeedKmh;
  for (let i = 0; i < n; i++) {
    const base = i * n;
    const loni = lon[i];
    const lati = lat[i];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        f[base + j] = 0; // 排除區內旅次
        continue;
      }
      const km = kmBetween(loni, lati, lon[j], lat[j]) * detourFactor;
      f[base + j] = Math.exp(-gravityBeta * km * minPerKm);
    }
  }

  // Furness/IPF：交替調整 a_i 與 b_j 直到行列總和都收斂到 P 與 A。
  const a = new Float64Array(n).fill(1);
  const b = new Float64Array(n).fill(1);
  const MAX_ITER = 40;
  const TOL = 1e-4;
  let iterations = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterations = iter + 1;
    let maxErr = 0;

    for (let i = 0; i < n; i++) {
      const base = i * n;
      let s = 0;
      for (let j = 0; j < n; j++) s += b[j] * A[j] * f[base + j];
      const na = s > 0 ? 1 / s : 0;
      if (a[i] > 0) maxErr = Math.max(maxErr, Math.abs(na - a[i]) / a[i]);
      a[i] = na;
    }

    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += a[i] * P[i] * f[i * n + j];
      const nb = s > 0 ? 1 / s : 0;
      if (b[j] > 0) maxErr = Math.max(maxErr, Math.abs(nb - b[j]) / b[j]);
      b[j] = nb;
    }

    if (maxErr < TOL) break;
  }

  // 取每個起點權重最大的前 K 個目的地，並把被捨棄的流量按比例補回保留的目的地，
  // 讓每個 zone 的總產生量仍然等於 P[i]（不會憑空少掉旅次）。
  const K = Math.min(input.topK, n - 1);
  const rowStart = new Array<number>(n + 1);
  const dest: number[] = [];
  const flow: number[] = [];
  let totalPeakTrips = 0;

  const idxBuf = new Int32Array(n);
  const valBuf = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    rowStart[i] = dest.length;
    const base = i * n;
    const ai = a[i] * P[i];
    if (ai <= 0) continue;

    let m = 0;
    let rowTotal = 0;
    for (let j = 0; j < n; j++) {
      const t = ai * b[j] * A[j] * f[base + j];
      if (t > 0) {
        idxBuf[m] = j;
        valBuf[m] = t;
        m++;
        rowTotal += t;
      }
    }
    if (m === 0 || rowTotal <= 0) continue;

    // 部分排序：只需要前 K 大，用選擇法即可（K 很小）。
    const keep = Math.min(K, m);
    for (let k = 0; k < keep; k++) {
      let best = k;
      for (let t = k + 1; t < m; t++) if (valBuf[t] > valBuf[best]) best = t;
      if (best !== k) {
        const tv = valBuf[k];
        valBuf[k] = valBuf[best];
        valBuf[best] = tv;
        const ti = idxBuf[k];
        idxBuf[k] = idxBuf[best];
        idxBuf[best] = ti;
      }
    }

    let keptTotal = 0;
    for (let k = 0; k < keep; k++) keptTotal += valBuf[k];
    const renorm = keptTotal > 0 ? rowTotal / keptTotal : 0;

    for (let k = 0; k < keep; k++) {
      const v = valBuf[k] * renorm;
      dest.push(idxBuf[k]);
      flow.push(v);
      totalPeakTrips += v;
    }
  }
  rowStart[n] = dest.length;

  return { od: { rowStart, dest, flow }, totalPeakTrips, iterations };
}
