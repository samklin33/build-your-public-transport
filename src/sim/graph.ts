import { kmBetween } from '../model/geo';
import type { CostModel, Network, SimParams } from '../model/types';

/**
 * 大眾運輸路網圖。
 *
 * 節點分兩種：
 *   - 車站節點     index 0 .. S-1          （街道層，步行進出與轉乘都經過這裡）
 *   - 月台節點     index S .. S+P-1        （每一組「路線 × 車站」一個）
 *
 * 邊：
 *   車站 → 月台   上車，成本 = 候車時間（班距/2）
 *   月台 → 車站   下車，成本 = 轉乘罰值
 *   月台 → 月台   行駛，成本 = 車內時間（同一條線上的相鄰站）
 *
 * 轉乘罰值掛在「下車」而非「上車」，是為了讓每多轉一次車就多付一次罰值。
 * 直達的行程也會付到一次（最後一次下車），因此最終旅行時間要扣掉一個罰值 —
 * 這是一個對所有大眾運輸路徑都相同的常數，不影響最短路徑的排序。
 */
export interface TransitGraph {
  nodeCount: number;
  stationCount: number;
  /** 車站 id ←→ 節點索引 */
  stationIds: string[];
  stationIndex: Map<string, number>;
  stationLon: Float64Array;
  stationLat: Float64Array;

  // CSR 鄰接表
  nodeStart: Int32Array;
  edgeHead: Int32Array;
  /** 邊的起點。CSR 本身查不到，追溯路徑時需要，直接存起來比反查快。 */
  edgeFrom: Int32Array;
  edgeCost: Float32Array;
  /** 該邊對應的路段索引；非行駛邊為 -1。 */
  edgeSegment: Int32Array;

  /** 每個路段的中繼資料，用來累積客流。 */
  segmentLineIdx: Int32Array;
  segmentFrom: Int32Array;
  segmentTo: Int32Array;
  /** 該路段每小時單向運能（人）。 */
  segmentCapacity: Float32Array;
  segmentKm: Float32Array;
  segmentCount: number;

  /** 每條線的長度（公里）與站數，供成本與財務計算使用。 */
  lineKm: Float64Array;
  lineStops: Int32Array;
  lineIds: string[];
  /** 節點所屬的路線索引；車站節點為 -1。追溯路徑時用來判斷在哪一條線上車。 */
  nodeLine: Int32Array;
}

interface EdgeDraft {
  from: number;
  to: number;
  cost: number;
  segment: number;
}

export function buildTransitGraph(
  network: Network,
  params: SimParams,
  costModel: CostModel,
): TransitGraph {
  // 只納入實際被路線使用到的車站，避免玩家刪線後殘留的孤立站影響計算。
  const usedStationIds = new Set<string>();
  for (const line of network.lines) {
    if (line.stationIds.length < 2) continue;
    for (const id of line.stationIds) {
      if (network.stations[id]) usedStationIds.add(id);
    }
  }

  const stationIds = [...usedStationIds];
  const stationIndex = new Map<string, number>();
  stationIds.forEach((id, i) => stationIndex.set(id, i));
  const S = stationIds.length;

  const stationLon = new Float64Array(S);
  const stationLat = new Float64Array(S);
  stationIds.forEach((id, i) => {
    stationLon[i] = network.stations[id].lon;
    stationLat[i] = network.stations[id].lat;
  });

  const edges: EdgeDraft[] = [];
  const segLineIdx: number[] = [];
  const segFrom: number[] = [];
  const segTo: number[] = [];
  const segCap: number[] = [];
  const segKm: number[] = [];

  const lineKm = new Float64Array(network.lines.length);
  const lineStops = new Int32Array(network.lines.length);
  const lineIds = network.lines.map((l) => l.id);
  const nodeLineDraft: number[] = new Array(S).fill(-1);

  let nextNode = S;

  network.lines.forEach((line, lineIdx) => {
    const stops = line.stationIds.filter((id) => stationIndex.has(id));
    if (stops.length < 2) return;

    const spec = costModel.modes[line.mode];
    const headway = Math.max(spec.minHeadwaySec, Math.min(spec.maxHeadwaySec, line.headwaySec));
    const waitMin = headway / 2 / 60;
    // 每小時單向運能 = 每班車載客量 × 每小時班次
    const capacity = spec.capacityPerVehicle * (3600 / headway);
    const dwellMin = spec.dwellSec / 60;

    // 為這條線的每一站建立月台節點
    const platform: number[] = [];
    for (let i = 0; i < stops.length; i++) {
      platform.push(nextNode);
      nodeLineDraft[nextNode] = lineIdx;
      nextNode++;
    }

    lineStops[lineIdx] = stops.length;

    for (let i = 0; i < stops.length; i++) {
      const st = stationIndex.get(stops[i])!;
      // 上車：候車
      edges.push({ from: st, to: platform[i], cost: waitMin, segment: -1 });
      // 下車：轉乘罰值
      edges.push({ from: platform[i], to: st, cost: params.transferPenaltyMin, segment: -1 });
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stationIndex.get(stops[i])!;
      const b = stationIndex.get(stops[i + 1])!;
      const km = kmBetween(stationLon[a], stationLat[a], stationLon[b], stationLat[b]);
      lineKm[lineIdx] += km;
      const rideMin = (km / spec.avgSpeedKmh) * 60 + dwellMin;

      // 去程與回程各自是一個路段，這樣才能分別統計尖峰方向的斷面客流。
      const segFwd = segLineIdx.length;
      segLineIdx.push(lineIdx);
      segFrom.push(a);
      segTo.push(b);
      segCap.push(capacity);
      segKm.push(km);

      const segBwd = segLineIdx.length;
      segLineIdx.push(lineIdx);
      segFrom.push(b);
      segTo.push(a);
      segCap.push(capacity);
      segKm.push(km);

      edges.push({ from: platform[i], to: platform[i + 1], cost: rideMin, segment: segFwd });
      edges.push({ from: platform[i + 1], to: platform[i], cost: rideMin, segment: segBwd });
    }
  });

  // 轉成 CSR
  const nodeCount = nextNode;
  const nodeStart = new Int32Array(nodeCount + 1);
  for (const e of edges) nodeStart[e.from + 1]++;
  for (let i = 0; i < nodeCount; i++) nodeStart[i + 1] += nodeStart[i];

  const edgeHead = new Int32Array(edges.length);
  const edgeFrom = new Int32Array(edges.length);
  const edgeCost = new Float32Array(edges.length);
  const edgeSegment = new Int32Array(edges.length);
  const cursor = Int32Array.from(nodeStart.subarray(0, nodeCount));
  for (const e of edges) {
    const p = cursor[e.from]++;
    edgeHead[p] = e.to;
    edgeFrom[p] = e.from;
    edgeCost[p] = e.cost;
    edgeSegment[p] = e.segment;
  }

  return {
    nodeCount,
    stationCount: S,
    stationIds,
    stationIndex,
    stationLon,
    stationLat,
    nodeStart,
    edgeHead,
    edgeFrom,
    edgeCost,
    edgeSegment,
    segmentLineIdx: Int32Array.from(segLineIdx),
    segmentFrom: Int32Array.from(segFrom),
    segmentTo: Int32Array.from(segTo),
    segmentCapacity: Float32Array.from(segCap),
    segmentKm: Float32Array.from(segKm),
    segmentCount: segLineIdx.length,
    lineKm,
    lineStops,
    lineIds,
    nodeLine: Int32Array.from(nodeLineDraft),
  };
}
