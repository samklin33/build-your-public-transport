import { describe, expect, it } from 'vitest';
import { parseOverpassWater } from '../scripts/water-parse';

/** 造一個以 (lon,lat) 為中心、邊長 sizeDeg 的方形環（Overpass 的 {lat,lon} 格式）。 */
function square(lon: number, lat: number, sizeDeg: number) {
  const h = sizeDeg / 2;
  return [
    { lat: lat - h, lon: lon - h },
    { lat: lat - h, lon: lon + h },
    { lat: lat + h, lon: lon + h },
    { lat: lat + h, lon: lon - h },
    { lat: lat - h, lon: lon - h },
  ];
}

describe('Overpass 水域解析', () => {
  it('way 直接成為一個水域', () => {
    const w = parseOverpassWater({
      elements: [
        { type: 'way', tags: { natural: 'water', name: '基隆河' }, geometry: square(121.55, 25.08, 0.02) },
      ],
    });
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('基隆河');
    // 座標是 [lon, lat]
    expect(w[0].ring[0]).toBeCloseTo(121.54, 2);
    expect(w[0].ring[1]).toBeCloseTo(25.07, 2);
  });

  it('環是閉合的', () => {
    const w = parseOverpassWater({
      elements: [{ type: 'way', tags: { natural: 'water' }, geometry: square(121.5, 25.05, 0.02) }],
    });
    const r = w[0].ring;
    expect(r[0]).toBe(r[r.length - 2]);
    expect(r[1]).toBe(r[r.length - 1]);
  });

  it('relation 取 outer 成員，忽略 inner（沙洲、島）', () => {
    const w = parseOverpassWater({
      elements: [
        {
          type: 'relation',
          tags: { natural: 'water', name: '淡水河' },
          members: [
            { type: 'way', role: 'outer', geometry: square(121.47, 25.10, 0.03) },
            { type: 'way', role: 'inner', geometry: square(121.47, 25.10, 0.01) },
          ],
        },
      ],
    });
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('淡水河');
  });

  it('濾掉太小的水池', () => {
    const w = parseOverpassWater({
      elements: [
        // 0.0005 度見方 ≈ 55m × 55m，遠小於門檻
        { type: 'way', tags: { natural: 'water' }, geometry: square(121.5, 25.05, 0.0005) },
      ],
    });
    expect(w).toHaveLength(0);
  });

  it('略過壞資料而不是整個炸掉', () => {
    const w = parseOverpassWater({
      elements: [
        { type: 'way', tags: { natural: 'water' } }, // 沒有 geometry
        { type: 'way', tags: { natural: 'water' }, geometry: [{ lat: 25, lon: 121 }] }, // 點太少
        { type: 'node', tags: { natural: 'water' } }, // 不是面
        { type: 'relation', tags: { natural: 'water' } }, // 沒有 members
        { type: 'way', tags: { natural: 'water' }, geometry: square(121.5, 25.05, 0.02) }, // 好的
      ],
    });
    expect(w).toHaveLength(1);
  });

  it('沒有 elements 就明確報錯', () => {
    expect(() => parseOverpassWater({})).toThrow();
  });

  it('多個水域都會被保留', () => {
    const w = parseOverpassWater({
      elements: [
        { type: 'way', tags: { natural: 'water', name: '基隆河' }, geometry: square(121.55, 25.08, 0.02) },
        { type: 'way', tags: { natural: 'water', name: '新店溪' }, geometry: square(121.51, 25.00, 0.02) },
        { type: 'way', tags: { waterway: 'riverbank' }, geometry: square(121.47, 25.12, 0.02) },
      ],
    });
    expect(w).toHaveLength(3);
    expect(w.map((x) => x.name)).toContain('新店溪');
  });
});
