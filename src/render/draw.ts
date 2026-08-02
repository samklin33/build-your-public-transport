import type { Network, SimResult, CostModel } from '../model/types';
import { projectMercator } from '../model/geo';
import { worldToScreen, type Camera } from './camera';
import type { PreparedCity, PreparedZone } from './prepare';
import type { Overlay } from '../state/store';

export const COLORS = {
  sea: '#0b131d',
  land: '#1b2735',
  zoneStroke: 'rgba(255,255,255,0.045)',
  districtStroke: 'rgba(255,255,255,0.16)',
  label: 'rgba(226,238,255,0.55)',
  stationFill: '#ffffff',
  stationStroke: '#0b131d',
  draft: '#ffd54a',
  noService: '#2a3542',
};

/** 人口密度色階：深藍 → 青 → 黃，低到高。 */
function densityColor(t: number): string {
  const c = clamp01(t);
  const stops: [number, number, number][] = [
    [26, 42, 62],
    [28, 78, 112],
    [26, 130, 140],
    [104, 176, 106],
    [214, 200, 80],
    [246, 220, 140],
  ];
  return rampColor(stops, c);
}

/** 可及性色階：綠（快）→ 黃 → 紅（慢）。 */
function accessColor(t: number): string {
  const stops: [number, number, number][] = [
    [46, 160, 92],
    [140, 180, 70],
    [222, 190, 66],
    [214, 122, 52],
    [190, 62, 62],
  ];
  return rampColor(stops, clamp01(t));
}

function rampColor(stops: [number, number, number][], t: number): string {
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(
    a[1] + (b[1] - a[1]) * f,
  )},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function zoneFill(
  zone: PreparedZone,
  city: PreparedCity,
  overlay: Overlay,
  result: SimResult | null,
): string {
  if (overlay === 'none') return COLORS.land;

  if (overlay === 'density') {
    // 用開方壓縮動態範圍，否則少數超高密度的里會把其他地方全部壓成同一個暗色。
    const t = Math.sqrt(clamp01(zone.densityPerKm2 / city.densityP95));
    return densityColor(t);
  }

  if (overlay === 'coverage') {
    if (!result) return COLORS.land;
    return result.zoneCovered[zone.id] ? '#2f7d54' : '#33404f';
  }

  // access：以搭乘大眾運輸的平均旅行時間著色
  if (!result) return COLORS.land;
  const v = result.zoneAccessMin[zone.id];
  if (!Number.isFinite(v)) return COLORS.noService;
  // 15 分鐘以下算好，60 分鐘以上算差
  return accessColor((v - 15) / 45);
}

export interface DrawOptions {
  cam: Camera;
  city: PreparedCity;
  network: Network;
  result: SimResult | null;
  overlay: Overlay;
  showRidership: boolean;
  draft: string[];
  draftColor: string;
  selectedLineId: string | null;
  hoverStationId: string | null;
  costModel: CostModel;
  /** 滑鼠目前的世界座標，用來畫繪製中的橡皮筋線。 */
  cursor: [number, number] | null;
}

export function draw(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { cam } = o;
  ctx.save();
  ctx.fillStyle = COLORS.sea;
  ctx.fillRect(0, 0, cam.width, cam.height);

  // 視窗範圍（世界座標），用來剔除看不到的圖形
  const halfW = cam.width / 2 / cam.scale;
  const halfH = cam.height / 2 / cam.scale;
  const vMinX = cam.cx - halfW;
  const vMaxX = cam.cx + halfW;
  const vMinY = cam.cy - halfH;
  const vMaxY = cam.cy + halfH;

  drawZones(ctx, o, vMinX, vMinY, vMaxX, vMaxY);
  drawNetwork(ctx, o);
  drawDraft(ctx, o);
  drawStations(ctx, o);
  drawDistrictLabels(ctx, o);

  ctx.restore();
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  o: DrawOptions,
  vMinX: number,
  vMinY: number,
  vMaxX: number,
  vMaxY: number,
): void {
  const { cam, city, overlay, result } = o;
  const showStroke = cam.scale > 200_000;

  ctx.lineWidth = 0.6;
  ctx.strokeStyle = COLORS.zoneStroke;

  for (const z of city.zones) {
    if (z.maxX < vMinX || z.minX > vMaxX || z.maxY < vMinY || z.minY > vMaxY) continue;

    ctx.beginPath();
    for (const ring of z.rings) {
      const [sx, sy] = worldToScreen(cam, ring[0], ring[1]);
      ctx.moveTo(sx, sy);
      for (let i = 2; i < ring.length; i += 2) {
        const [px, py] = worldToScreen(cam, ring[i], ring[i + 1]);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fillStyle = zoneFill(z, city, overlay, result);
    ctx.fill();
    if (showStroke) ctx.stroke();
  }
}

function drawNetwork(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { cam, network, result, showRidership, selectedLineId } = o;

  const loadByKey = new Map<string, number>();
  let maxLoad = 0;
  if (result && showRidership) {
    for (const s of result.segments) {
      // 同一路段的兩個方向取較大者當作視覺粗細
      const key = segKey(s.lineId, s.fromStationId, s.toStationId);
      const prev = loadByKey.get(key) ?? 0;
      const v = Math.max(prev, s.load);
      loadByKey.set(key, v);
      if (v > maxLoad) maxLoad = v;
    }
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const line of network.lines) {
    const selected = selectedLineId === line.id;
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const a = network.stations[line.stationIds[i]];
      const b = network.stations[line.stationIds[i + 1]];
      if (!a || !b) continue;

      let width = selected ? 5 : 3.5;
      if (maxLoad > 0) {
        const key = segKey(line.id, a.id, b.id);
        const load = loadByKey.get(key) ?? loadByKey.get(segKey(line.id, b.id, a.id)) ?? 0;
        width = 1.5 + Math.sqrt(load / maxLoad) * 11;
      }

      // 有實際走線就照著畫，路線才會是真實的彎曲形狀而不是站對站的直線。
      const shape = line.segmentShapes?.[i];
      const trace = () => {
        ctx.beginPath();
        if (shape && shape.length >= 4) {
          const [sx, sy] = lonLatToScreen(cam, shape[0], shape[1]);
          ctx.moveTo(sx, sy);
          for (let k = 2; k < shape.length; k += 2) {
            const [px, py] = lonLatToScreen(cam, shape[k], shape[k + 1]);
            ctx.lineTo(px, py);
          }
        } else {
          const [ax, ay] = lonLatToScreen(cam, a.lon, a.lat);
          const [bx, by] = lonLatToScreen(cam, b.lon, b.lat);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
      };

      if (selected) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = width + 4;
        trace();
        ctx.stroke();
      }

      ctx.strokeStyle = line.color;
      ctx.lineWidth = width;
      trace();
      ctx.stroke();
    }
  }
}

function drawDraft(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { cam, network, draft, cursor, draftColor } = o;
  if (draft.length === 0) return;

  ctx.strokeStyle = draftColor;
  ctx.lineWidth = 3.5;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  let started = false;
  for (const id of draft) {
    const s = network.stations[id];
    if (!s) continue;
    const [x, y] = lonLatToScreen(cam, s.lon, s.lat);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  if (cursor && started) {
    const [cx, cy] = worldToScreen(cam, cursor[0], cursor[1]);
    ctx.lineTo(cx, cy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 草稿站點
  for (const id of draft) {
    const s = network.stations[id];
    if (!s) continue;
    const [x, y] = lonLatToScreen(cam, s.lon, s.lat);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = draftColor;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.stationStroke;
    ctx.stroke();
  }
}

function drawStations(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { cam, network, result, hoverStationId } = o;
  const showNames = cam.scale > 900_000;

  // 車站大小反映進出站人次，一眼看出哪些是大站
  let maxThroughput = 0;
  if (result) {
    for (const v of Object.values(result.stations)) {
      const t = v.boardings + v.alightings;
      if (t > maxThroughput) maxThroughput = t;
    }
  }

  // 站點大小要跟著縮放調整：拉遠時如果還是同樣大小，市中心會糊成一團白斑。
  const zoomFactor = Math.max(0.5, Math.min(1.25, cam.scale / 700_000));

  const entries = Object.values(network.stations);
  for (const s of entries) {
    const [x, y] = lonLatToScreen(cam, s.lon, s.lat);
    if (x < -40 || y < -40 || x > cam.width + 40 || y > cam.height + 40) continue;

    let r = 3 * zoomFactor;
    if (maxThroughput > 0) {
      const st = result!.stations[s.id];
      const t = st ? st.boardings + st.alightings : 0;
      r = (2.4 + Math.sqrt(t / maxThroughput) * 6.5) * zoomFactor;
    }
    const hovered = hoverStationId === s.id;
    if (hovered) r += 2;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.stationFill;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = COLORS.stationStroke;
    ctx.stroke();

    if (showNames || hovered) {
      ctx.font = '11px system-ui, "Noto Sans TC", sans-serif';
      ctx.fillStyle = hovered ? '#ffffff' : COLORS.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeText(s.name, x + r + 4, y);
      ctx.fillText(s.name, x + r + 4, y);
    }
  }
}

function drawDistrictLabels(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { cam, city } = o;
  if (cam.scale < 120_000) return;
  ctx.font = '600 12px system-ui, "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of city.districts) {
    const [x, y] = worldToScreen(cam, d.cx, d.cy);
    if (x < 0 || y < 0 || x > cam.width || y > cam.height) continue;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(d.name, x, y);
    ctx.fillStyle = COLORS.label;
    ctx.fillText(d.name, x, y);
  }
}

function lonLatToScreen(cam: Camera, lon: number, lat: number): [number, number] {
  const [wx, wy] = projectMercator(lon, lat);
  return worldToScreen(cam, wx, wy);
}

function segKey(lineId: string, a: string, b: string): string {
  return `${lineId}|${a}|${b}`;
}
