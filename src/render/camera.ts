import { projectMercator, unprojectMercator } from '../model/geo';

/**
 * 世界座標是 Web Mercator 正規化到 0..1 的值，畫面座標是畫布像素。
 * 相機只做平移與等比縮放，不做旋轉。
 */
export interface Camera {
  /** 畫面中心對應的世界座標。 */
  cx: number;
  cy: number;
  /** 每一單位世界座標對應多少像素。 */
  scale: number;
  width: number;
  height: number;
}

export function createCamera(width: number, height: number): Camera {
  return { cx: 0.5, cy: 0.5, scale: 1, width, height };
}

export function fitBounds(
  cam: Camera,
  bbox: [number, number, number, number],
  padding = 0.06,
): void {
  const [w, s, e, n] = bbox;
  const [x0, y0] = projectMercator(w, n); // 北邊在 Mercator 是較小的 y
  const [x1, y1] = projectMercator(e, s);
  fitWorldBounds(cam, x0, y0, x1, y1, padding);
}

/** 直接以世界座標指定範圍，給已經投影過的幾何用。 */
export function fitWorldBounds(
  cam: Camera,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  padding = 0.06,
): void {
  const dx = Math.abs(x1 - x0) || 1e-6;
  const dy = Math.abs(y1 - y0) || 1e-6;
  cam.cx = (x0 + x1) / 2;
  cam.cy = (y0 + y1) / 2;
  const sx = (cam.width * (1 - padding * 2)) / dx;
  const sy = (cam.height * (1 - padding * 2)) / dy;
  cam.scale = Math.min(sx, sy);
}

export function worldToScreen(cam: Camera, x: number, y: number): [number, number] {
  return [
    (x - cam.cx) * cam.scale + cam.width / 2,
    (y - cam.cy) * cam.scale + cam.height / 2,
  ];
}

export function screenToWorld(cam: Camera, px: number, py: number): [number, number] {
  return [
    (px - cam.width / 2) / cam.scale + cam.cx,
    (py - cam.height / 2) / cam.scale + cam.cy,
  ];
}

export function screenToLonLat(cam: Camera, px: number, py: number): [number, number] {
  const [x, y] = screenToWorld(cam, px, py);
  return unprojectMercator(x, y);
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): void {
  cam.cx -= dxPx / cam.scale;
  cam.cy -= dyPx / cam.scale;
}

/** 以畫面上某個點為錨點縮放，讓滑鼠底下的地理位置維持不動。 */
export function zoomAt(cam: Camera, px: number, py: number, factor: number, minScale: number, maxScale: number): void {
  const [wx, wy] = screenToWorld(cam, px, py);
  const next = Math.max(minScale, Math.min(maxScale, cam.scale * factor));
  if (next === cam.scale) return;
  cam.scale = next;
  const [nx, ny] = screenToWorld(cam, px, py);
  cam.cx += wx - nx;
  cam.cy += wy - ny;
}

/** 世界單位換算成公里，用於在螢幕上判斷點擊容差。 */
export function pixelsToKm(cam: Camera, px: number, atLat: number): number {
  const worldPerPx = 1 / cam.scale;
  // Mercator 在緯度 lat 的比例尺：一單位世界座標 = 40075km * cos(lat)
  return px * worldPerPx * 40075 * Math.cos((atLat * Math.PI) / 180);
}
