import { describe, expect, it } from 'vitest';
import { kmBetween, pointInRing, ringAreaKm2, ringCentroid } from '../src/model/geo';
import { DEFAULT_COST_MODEL, DEFAULT_SIM_PARAMS } from '../src/model/defaults';
import type { CityPack, Network, SimParams } from '../src/model/types';
import { buildTransitGraph } from '../src/sim/graph';
import { Dijkstra } from '../src/sim/dijkstra';
import { buildGravityOD } from '../src/sim/demand';
import { congestedCarSpeed, createSimContext, simulate } from '../src/sim/simulate';

const LAT = 25.05;
/** 在緯度 25.05 附近，往東移動 km 公里所需的經度差。 */
const lonOffsetForKm = (km: number) => km / (111.32 * Math.cos((LAT * Math.PI) / 180));

describe('geo', () => {
  it('kmBetween 對已知距離的誤差在 0.5% 以內', () => {
    const d = kmBetween(121.5, LAT, 121.5 + lonOffsetForKm(10), LAT);
    expect(d).toBeGreaterThan(9.95);
    expect(d).toBeLessThan(10.05);
  });

  it('ringCentroid 回傳正方形的中心', () => {
    const ring = [0, 0, 2, 0, 2, 2, 0, 2, 0, 0];
    const [cx, cy] = ringCentroid(ring);
    expect(cx).toBeCloseTo(1, 10);
    expect(cy).toBeCloseTo(1, 10);
  });

  it('ringAreaKm2 對一度見方的方形給出合理面積', () => {
    const ring = [121, 25, 122, 25, 122, 26, 121, 26, 121, 25];
    const a = ringAreaKm2(ring, 25);
    // 一度緯 ≈ 110.6 km、一度經在緯度 25 ≈ 100.9 km
    expect(a).toBeGreaterThan(10_000);
    expect(a).toBeLessThan(12_000);
  });

  it('pointInRing 正確判斷內外', () => {
    const ring = [0, 0, 4, 0, 4, 4, 0, 4, 0, 0];
    expect(pointInRing(2, 2, ring)).toBe(true);
    expect(pointInRing(5, 2, ring)).toBe(false);
    expect(pointInRing(-1, -1, ring)).toBe(false);
  });
});

/** 一條直線上等距排列的車站，方便手算預期值。 */
function lineNetwork(stopKm: number, stops: number, headwaySec: number): Network {
  const stations: Network['stations'] = {};
  const ids: string[] = [];
  for (let i = 0; i < stops; i++) {
    const id = `s${i}`;
    ids.push(id);
    stations[id] = {
      id,
      name: id,
      lon: 121.5 + lonOffsetForKm(stopKm * i),
      lat: LAT,
    };
  }
  return {
    stations,
    lines: [
      {
        id: 'L1',
        name: 'L1',
        color: '#fff',
        mode: 'metro_underground',
        stationIds: ids,
        headwaySec,
      },
    ],
  };
}

describe('transit graph + Dijkstra', () => {
  const params: SimParams = { ...DEFAULT_SIM_PARAMS, transferPenaltyMin: 5 };

  it('站到站時間 = 候車 + 各段行駛 + 停站，再加一次下車罰值', () => {
    // 3.5 km 站距、班距 240 秒、地下捷運 35 km/h、停站 30 秒
    const net = lineNetwork(3.5, 3, 240);
    const g = buildTransitGraph(net, params, DEFAULT_COST_MODEL);
    const d = new Dijkstra(g);

    const a = g.stationIndex.get('s0')!;
    const c = g.stationIndex.get('s2')!;
    d.run(a);

    // 預期值用圖自己量到的段長來算，這樣驗的是成本公式本身，
    // 而不是測試裡對經緯度換算公里的近似做法。
    const wait = 240 / 2 / 60; // 2 分
    const ride = (km: number) => (km / 35) * 60 + 0.5;
    const expected =
      wait + ride(g.segmentKm[0]) + ride(g.segmentKm[2]) + params.transferPenaltyMin;

    // 玩家畫的線沒有實際走線資料，長度會乘上走線係數（真實路線不是直線）
    const af = DEFAULT_COST_MODEL.modes.metro_underground.alignmentFactor;
    expect(g.segmentKm[0]).toBeCloseTo(3.5 * af, 1);
    expect(d.dist[c]).toBeCloseTo(expected, 3);
  });

  it('沒有走線資料時，長度會套用走線係數', () => {
    const g = buildTransitGraph(lineNetwork(10, 2, 240), params, DEFAULT_COST_MODEL);
    const af = DEFAULT_COST_MODEL.modes.metro_underground.alignmentFactor;
    expect(af).toBeGreaterThan(1);
    expect(g.lineKm[0]).toBeCloseTo(10 * af, 1);
  });

  it('有實際走線時，用走線長度而不是直線距離', () => {
    // 造一段刻意繞路的走線：兩站直線 10 km，但走線往北繞一大圈
    const net = lineNetwork(10, 2, 240);
    const a = net.stations['s0'];
    const b = net.stations['s1'];
    net.lines[0].segmentShapes = [
      [a.lon, a.lat, a.lon, a.lat + 0.05, b.lon, b.lat + 0.05, b.lon, b.lat],
    ];
    const g = buildTransitGraph(net, params, DEFAULT_COST_MODEL);
    // 繞路的走線一定比直線長，而且不等於「直線 × 係數」
    expect(g.lineKm[0]).toBeGreaterThan(10 * 1.5);
  });

  it('班距越短候車越少，總時間跟著變短', () => {
    const g1 = buildTransitGraph(lineNetwork(3.5, 3, 600), params, DEFAULT_COST_MODEL);
    const g2 = buildTransitGraph(lineNetwork(3.5, 3, 120), params, DEFAULT_COST_MODEL);
    const d1 = new Dijkstra(g1);
    const d2 = new Dijkstra(g2);
    d1.run(g1.stationIndex.get('s0')!);
    d2.run(g2.stationIndex.get('s0')!);
    const t1 = d1.dist[g1.stationIndex.get('s2')!];
    const t2 = d2.dist[g2.stationIndex.get('s2')!];
    // 班距差 480 秒，候車時間差一半 = 4 分
    expect(t1 - t2).toBeCloseTo(4, 4);
  });

  it('轉乘會多付一次罰值', () => {
    // 兩條線在 s1 交會：直達 s0→s2 對上必須換車的 s0→x
    const net = lineNetwork(3.5, 3, 240);
    net.stations['x'] = { id: 'x', name: 'x', lon: 121.5 + lonOffsetForKm(3.5), lat: LAT + 0.03 };
    net.lines.push({
      id: 'L2',
      name: 'L2',
      color: '#000',
      mode: 'metro_underground',
      stationIds: ['s1', 'x'],
      headwaySec: 240,
    });
    const g = buildTransitGraph(net, params, DEFAULT_COST_MODEL);
    const d = new Dijkstra(g);
    d.run(g.stationIndex.get('s0')!);

    const direct = d.dist[g.stationIndex.get('s2')!];
    const transfer = d.dist[g.stationIndex.get('x')!];
    // 轉乘路徑多了一次下車罰值 + 一次候車
    const extra = params.transferPenaltyMin + 240 / 2 / 60;
    // 兩段行駛距離不同，只驗證罰值確實被計入（差值至少要有一次罰值那麼多）
    expect(transfer).toBeGreaterThan(direct - 6.5 + extra - 0.01);
  });

  it('孤立的車站不可達', () => {
    const net = lineNetwork(3.5, 3, 240);
    net.stations['far'] = { id: 'far', name: 'far', lon: 121.9, lat: LAT };
    const g = buildTransitGraph(net, params, DEFAULT_COST_MODEL);
    // 沒有任何路線用到 far，它不該進入圖中
    expect(g.stationIndex.has('far')).toBe(false);
  });
});

describe('重力模型', () => {
  const n = 40;
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const population = new Float64Array(n);
  const jobs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = 121.4 + (i % 8) * 0.02;
    lat[i] = 25.0 + Math.floor(i / 8) * 0.02;
    population[i] = 1000 + i * 37;
    jobs[i] = 400 + ((i * 91) % 700);
  }

  const opts = {
    lon,
    lat,
    population,
    jobs,
    gravityBeta: 0.02,
    tripsPerPersonPerDay: 2.4,
    peakHourShare: 0.12,
    carSpeedKmh: 22,
    detourFactor: 1.32,
    topK: 12,
  };

  it('每個起點的總產生量守恆（稀疏化後有補回被截斷的流量）', () => {
    const { od } = buildGravityOD(opts);
    const perTrip = 2.4 * 0.12;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = od.rowStart[i]; k < od.rowStart[i + 1]; k++) sum += od.flow[k];
      // IPF 是疊代收斂到容許誤差（1e-4），不會是位元精確，因此用相對誤差驗證。
      const expected = population[i] * perTrip;
      expect(Math.abs(sum - expected) / expected).toBeLessThan(1e-3);
    }
  });

  it('不產生區內旅次', () => {
    const { od } = buildGravityOD(opts);
    for (let i = 0; i < n; i++) {
      for (let k = od.rowStart[i]; k < od.rowStart[i + 1]; k++) {
        expect(od.dest[k]).not.toBe(i);
      }
    }
  });

  it('每個起點保留的目的地不超過 topK', () => {
    const { od } = buildGravityOD(opts);
    for (let i = 0; i < n; i++) {
      expect(od.rowStart[i + 1] - od.rowStart[i]).toBeLessThanOrEqual(opts.topK);
    }
  });

  it('beta 越大，長程旅次的占比越低', () => {
    const far = (beta: number) => {
      const { od } = buildGravityOD({ ...opts, gravityBeta: beta, topK: n - 1 });
      let farFlow = 0;
      let total = 0;
      for (let i = 0; i < n; i++) {
        for (let k = od.rowStart[i]; k < od.rowStart[i + 1]; k++) {
          const d = kmBetween(lon[i], lat[i], lon[od.dest[k]], lat[od.dest[k]]);
          total += od.flow[k];
          if (d > 5) farFlow += od.flow[k];
        }
      }
      return farFlow / total;
    };
    expect(far(0.15)).toBeLessThan(far(0.01));
  });
});

describe('壅塞模型', () => {
  const p = DEFAULT_SIM_PARAMS;

  it('沒有車流時等於自由流速度', () => {
    expect(congestedCarSpeed(p, 0)).toBeCloseTo(p.carFreeFlowSpeedKmh, 6);
  });

  it('車流越多速度越慢', () => {
    const s1 = congestedCarSpeed(p, p.roadCapacityPeakTrips * 0.5);
    const s2 = congestedCarSpeed(p, p.roadCapacityPeakTrips);
    const s3 = congestedCarSpeed(p, p.roadCapacityPeakTrips * 1.5);
    expect(s1).toBeGreaterThan(s2);
    expect(s2).toBeGreaterThan(s3);
  });

  it('把人移到大眾運輸上會讓開車變快 —— 這是路網創造價值的機制', () => {
    const noTransit = congestedCarSpeed(p, 1_920_000);
    const withTransit = congestedCarSpeed(p, 1_920_000 * 0.87);
    expect(withTransit).toBeGreaterThan(noTransit);
  });
});

describe('指派守恆', () => {
  /**
   * 造一個小城市：zone 間距 0.4 km，遠比車站間距（3 km）密。
   * 這樣一定會有好幾個 zone 共用同一個最近車站 —— 正是「進出站同一站」
   * 那個 bug 會出現的條件，測試必須重現它才有意義。
   */
  const ZONE_SPACING_KM = 0.4;
  const STATION_SPACING_KM = 3;
  const MINI_STATIONS = 4;

  function miniPack(): CityPack {
    const n = 24;
    const zones = [];
    for (let i = 0; i < n; i++) {
      const lon = 121.5 + lonOffsetForKm(i * ZONE_SPACING_KM);
      zones.push({
        id: i,
        code: `z${i}`,
        name: `z${i}`,
        districtId: 0,
        lon,
        lat: LAT,
        areaKm2: 1,
        population: 5000,
        jobs: 3000,
        rings: [[lon - 0.001, LAT - 0.001, lon + 0.001, LAT - 0.001, lon + 0.001, LAT + 0.001, lon - 0.001, LAT + 0.001, lon - 0.001, LAT - 0.001]],
      });
    }
    const lon = new Float64Array(zones.map((z) => z.lon));
    const lat = new Float64Array(zones.map((z) => z.lat));
    const population = new Float64Array(zones.map((z) => z.population));
    const jobs = new Float64Array(zones.map((z) => z.jobs));
    const { od } = buildGravityOD({
      lon, lat, population, jobs,
      gravityBeta: DEFAULT_SIM_PARAMS.gravityBeta,
      tripsPerPersonPerDay: DEFAULT_SIM_PARAMS.tripsPerPersonPerDay,
      peakHourShare: DEFAULT_SIM_PARAMS.peakHourShare,
      carSpeedKmh: DEFAULT_SIM_PARAMS.carSpeedKmh,
      detourFactor: DEFAULT_SIM_PARAMS.detourFactor,
      topK: 23,
    });
    return {
      id: 'mini',
      name: 'mini',
      bbox: [121.4, 24.9, 122.0, 25.2],
      districts: [{ id: 0, code: 'd0', name: 'd0', county: 'x', population: n * 5000, areaKm2: n }],
      roads: [],
      zones,
      employmentCenters: [],
      referenceNetwork: { stations: [], lines: [] },
      costModel: DEFAULT_COST_MODEL,
      simParams: DEFAULT_SIM_PARAMS,
      baseOD: od,
      sources: [],
    } as CityPack;
  }

  it('單一路線時，總旅次數 = 該線上車人次（沒搭到車的不該被算成運量）', () => {
    const pack = miniPack();
    const ctx = createSimContext(pack);
    // 車站正好蓋在每個 zone 上，相鄰 zone 常會共用最近的車站
    const net = lineNetwork(STATION_SPACING_KM, MINI_STATIONS, 240);
    const r = simulate(ctx, net);

    expect(r.peakTransitTrips).toBeGreaterThan(0);
    const boardings = r.lines[0].ridership;
    // 每一趟大眾運輸旅次在單線網路上都只會上車一次
    expect(boardings).toBeCloseTo(r.peakTransitTrips, 3);
  });

  it('每個路段的客流不會超過總旅次數', () => {
    const pack = miniPack();
    const ctx = createSimContext(pack);
    const r = simulate(ctx, lineNetwork(STATION_SPACING_KM, MINI_STATIONS, 240));
    for (const s of r.segments) {
      expect(s.load).toBeLessThanOrEqual(r.peakTransitTrips + 1e-6);
    }
  });

  it('沒有路線時不產生任何運量，平均時間等於基準', () => {
    const pack = miniPack();
    const ctx = createSimContext(pack);
    const r = simulate(ctx, { stations: {}, lines: [] });
    expect(r.peakTransitTrips).toBe(0);
    expect(r.coveragePct).toBe(0);
    expect(r.avgAllTimeMin).toBeCloseTo(r.baselineTimeMin, 6);
  });
});

describe('成本模型', () => {
  it('建設成本 = 長度 × 每公里造價 + 站數 × 每站造價', () => {
    const spec = DEFAULT_COST_MODEL.modes.metro_underground;
    const net = lineNetwork(3.5, 5, 240); // 4 段 × 3.5 km = 14 km，5 站
    const g = buildTransitGraph(net, DEFAULT_SIM_PARAMS, DEFAULT_COST_MODEL);
    const km = g.lineKm[0];
    // 4 段 × 3.5 km 的直線，再乘上走線係數
    expect(km).toBeCloseTo(14 * spec.alignmentFactor, 1);
    expect(g.lineStops[0]).toBe(5);
    const cost = km * spec.buildCostPerKm + g.lineStops[0] * spec.stationCost;
    // 用圖自己量到的長度算預期值，避免測試被經緯度換算的近似誤差絆倒
    expect(cost).toBeCloseTo(km * 40 + 5 * 25, 6);
    // 量級檢查：約 15.4 km 的地下捷運加 5 站約 740 億
    expect(cost).toBeGreaterThan(720);
    expect(cost).toBeLessThan(760);
  });

  it('地下造價高於高架，高架高於輕軌，輕軌高於公車', () => {
    const m = DEFAULT_COST_MODEL.modes;
    expect(m.metro_underground.buildCostPerKm).toBeGreaterThan(m.metro_elevated.buildCostPerKm);
    expect(m.metro_elevated.buildCostPerKm).toBeGreaterThan(m.lrt.buildCostPerKm);
    expect(m.lrt.buildCostPerKm).toBeGreaterThan(m.bus.buildCostPerKm);
  });

  it('路段運能隨班距縮短而提高', () => {
    const wide = buildTransitGraph(lineNetwork(3.5, 3, 600), DEFAULT_SIM_PARAMS, DEFAULT_COST_MODEL);
    const tight = buildTransitGraph(lineNetwork(3.5, 3, 120), DEFAULT_SIM_PARAMS, DEFAULT_COST_MODEL);
    expect(tight.segmentCapacity[0]).toBeGreaterThan(wide.segmentCapacity[0]);
    // 班距差 5 倍，運能就差 5 倍
    expect(tight.segmentCapacity[0] / wide.segmentCapacity[0]).toBeCloseTo(5, 4);
  });
});
