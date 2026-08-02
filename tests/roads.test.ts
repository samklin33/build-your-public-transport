import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANES,
  estimateWidthM,
  parseOverpassGeoJson,
  parseOverpassRoads,
  ROAD_CLASSES,
} from '../scripts/roads-parse';

/**
 * 這份 fixture 是真的 overpass-turbo 輸出（台北公館一帶），
 * 從 yd-tw/taipei-codefest-2025 取得。抓道路的查詢本身在開發環境
 * 連不到 Overpass 而無法實測，但解析與推估的邏輯可以靠它驗證。
 */
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures-overpass.geojson'), 'utf8'),
);

describe('Overpass GeoJSON 解析', () => {
  it('解析出道路，且每條都有 highway 等級與至少兩個座標', () => {
    const fc = parseOverpassGeoJson(fixture);
    expect(fc.features.length).toBeGreaterThan(30);
    for (const f of fc.features) {
      expect(typeof f.properties.highway).toBe('string');
      expect(f.geometry.type).toBe('LineString');
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('座標是 [經度, 緯度] 且落在台灣範圍內', () => {
    const fc = parseOverpassGeoJson(fixture);
    for (const f of fc.features) {
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(lon).toBeGreaterThan(119);
        expect(lon).toBeLessThan(123);
        expect(lat).toBeGreaterThan(21);
        expect(lat).toBeLessThan(26);
      }
    }
  });

  it('保留車道數，並解析出道路名稱', () => {
    const fc = parseOverpassGeoJson(fixture);
    const withLanes = fc.features.filter((f) => f.properties.lanes !== undefined);
    expect(withLanes.length).toBeGreaterThan(10);
    for (const f of withLanes) {
      expect(f.properties.lanes).toBeGreaterThan(0);
    }
    const named = fc.features.filter((f) => f.properties.name);
    expect(named.length).toBeGreaterThan(10);
  });

  it('不吐出空的或多餘的欄位', () => {
    const fc = parseOverpassGeoJson(fixture);
    for (const f of fc.features) {
      for (const [k, v] of Object.entries(f.properties)) {
        expect(v).not.toBeUndefined();
        expect(['highway', 'name', 'lanes', 'width', 'oneway']).toContain(k);
      }
    }
  });

  it('座標降精度到 5 位小數', () => {
    const fc = parseOverpassGeoJson(fixture);
    for (const f of fc.features.slice(0, 10)) {
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(Math.round(lon * 1e5)).toBeCloseTo(lon * 1e5, 6);
        expect(Math.round(lat * 1e5)).toBeCloseTo(lat * 1e5, 6);
      }
    }
  });

  it('不是 FeatureCollection 就明確報錯', () => {
    expect(() => parseOverpassGeoJson({ foo: 1 })).toThrow();
  });
});

describe('Overpass JSON（out geom）解析', () => {
  const sample = {
    elements: [
      {
        type: 'way',
        tags: { highway: 'primary', name: '忠孝東路四段', lanes: '4', oneway: 'yes' },
        geometry: [
          { lat: 25.0418, lon: 121.5436 },
          { lat: 25.0419, lon: 121.5455 },
        ],
      },
      // 只有一個點的 way 是壞資料，要略過
      { type: 'way', tags: { highway: 'primary' }, geometry: [{ lat: 25, lon: 121 }] },
      // 節點不是道路
      { type: 'node', tags: { highway: 'traffic_signals' } },
      // 沒有 highway 標籤
      {
        type: 'way',
        tags: { name: '某某' },
        geometry: [
          { lat: 25, lon: 121 },
          { lat: 25.1, lon: 121.1 },
        ],
      },
    ],
  };

  it('只留下有幾何且有 highway 的 way', () => {
    const fc = parseOverpassRoads(sample);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.properties.name).toBe('忠孝東路四段');
    expect(f.properties.lanes).toBe(4);
    expect(f.properties.oneway).toBe(true);
    // Overpass 是 {lat, lon}，GeoJSON 要 [lon, lat]
    expect(f.geometry.coordinates[0][0]).toBeCloseTo(121.5436, 5);
    expect(f.geometry.coordinates[0][1]).toBeCloseTo(25.0418, 5);
  });

  it('沒有 elements 就明確報錯', () => {
    expect(() => parseOverpassRoads({})).toThrow();
  });

  it('容忍 OSM 常見的髒標記格式', () => {
    const fc = parseOverpassRoads({
      elements: [
        {
          type: 'way',
          tags: { highway: 'secondary', lanes: '2;3', width: '12.5 m' },
          geometry: [
            { lat: 25, lon: 121 },
            { lat: 25.01, lon: 121.01 },
          ],
        },
      ],
    });
    expect(fc.features[0].properties.lanes).toBe(2);
    expect(fc.features[0].properties.width).toBe(12.5);
  });
});

describe('路寬推估', () => {
  it('有標 width 就直接用', () => {
    expect(estimateWidthM({ highway: 'primary', width: 30 })).toBe(30);
  });

  it('沒標 width 就用車道數推估', () => {
    expect(estimateWidthM({ highway: 'primary', lanes: 6 })).toBe(6 * 3.5 + 4);
  });

  it('連車道數都沒有就用該等級的預設值', () => {
    expect(estimateWidthM({ highway: 'motorway' })).toBe(DEFAULT_LANES.motorway * 3.5 + 4);
    // 未知等級也要給得出一個數字，不能回傳 NaN
    expect(estimateWidthM({ highway: 'unclassified' })).toBeGreaterThan(0);
  });

  it('道路等級越高，推估的路寬越寬', () => {
    const w = (h: string) => estimateWidthM({ highway: h });
    expect(w('motorway')).toBeGreaterThan(w('primary'));
    expect(w('primary')).toBeGreaterThan(w('tertiary'));
  });

  it('每個要抓的道路等級都有預設車道數', () => {
    for (const c of ROAD_CLASSES) {
      expect(DEFAULT_LANES[c]).toBeGreaterThan(0);
    }
  });
});
