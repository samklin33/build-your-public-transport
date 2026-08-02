import { useEffect, useRef } from 'react';
import { kmBetween } from '../model/geo';
import { useStore } from '../state/store';
import {
  createCamera,
  fitWorldBounds,
  panBy,
  pixelsToKm,
  screenToLonLat,
  screenToWorld,
  zoomAt,
  type Camera,
} from './camera';
import { draw } from './draw';

const MIN_SCALE = 60_000;
const MAX_SCALE = 6_000_000;
/** 點擊時距離多少像素以內就吸附到既有車站（形成轉乘）。 */
const SNAP_PX = 14;
/** 按下與放開之間超過這個像素數就算拖曳，不算點擊。 */
const DRAG_THRESHOLD_PX = 4;

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<Camera | null>(null);
  const cursorRef = useRef<[number, number] | null>(null);
  const dirtyRef = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const cam = createCamera(parent.clientWidth, parent.clientHeight);
    camRef.current = cam;

    const resize = () => {
      cam.width = parent.clientWidth;
      cam.height = parent.clientHeight;
      canvas.width = cam.width * dpr;
      canvas.height = cam.height * dpr;
      canvas.style.width = `${cam.width}px`;
      canvas.style.height = `${cam.height}px`;
      const c = canvas.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    let fitted = false;
    let raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const state = useStore.getState();
      const city = state.prepared;
      const pack = state.pack;
      if (!city || !pack) return;

      if (!fitted) {
        // 開場對準都市化範圍，而不是含大片山區的完整縣市界。
        fitWorldBounds(
          cam,
          city.urbanMinX,
          city.urbanMinY,
          city.urbanMaxX,
          city.urbanMaxY,
          0.04,
        );
        fitted = true;
        dirtyRef.current = true;
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const c = canvas.getContext('2d')!;
      draw(c, {
        cam,
        city,
        network: state.network,
        result: state.result,
        overlay: state.overlay,
        showRidership: state.showRidership,
        showRoads: state.showRoads,
        draft: state.draft,
        draftColor: pack.costModel.modes[state.drawMode].color,
        selectedLineId: state.selectedLineId,
        hoverStationId: state.hoverStationId,
        costModel: pack.costModel,
        cursor: state.tool === 'draw' && state.draft.length > 0 ? cursorRef.current : null,
      });
    };
    raf = requestAnimationFrame(frame);

    // 任何會影響畫面的狀態改變都標記需要重畫
    const unsub = useStore.subscribe(() => {
      dirtyRef.current = true;
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const localPos = (e: MouseEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const onDown = (e: MouseEvent) => {
      dragging = true;
      moved = 0;
      const [x, y] = localPos(e);
      lastX = x;
      lastY = y;
    };

    const onMove = (e: MouseEvent) => {
      const cam = camRef.current;
      if (!cam) return;
      const [x, y] = localPos(e);

      if (dragging) {
        const dx = x - lastX;
        const dy = y - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        panBy(cam, dx, dy);
        lastX = x;
        lastY = y;
        dirtyRef.current = true;
        return;
      }

      cursorRef.current = screenToWorld(cam, x, y);
      dirtyRef.current = true;

      // 找出游標附近的車站以便顯示站名
      const state = useStore.getState();
      const [lon, lat] = screenToLonLat(cam, x, y);
      const snapKm = pixelsToKm(cam, SNAP_PX, lat);
      let hit: string | null = null;
      let bestKm = snapKm;
      for (const s of Object.values(state.network.stations)) {
        const km = kmBetween(lon, lat, s.lon, s.lat);
        if (km <= bestKm) {
          bestKm = km;
          hit = s.id;
        }
      }
      state.setHoverStation(hit);
      canvas.style.cursor =
        state.tool === 'draw' ? 'crosshair' : hit ? 'pointer' : 'grab';
    };

    const onUp = (e: MouseEvent) => {
      const cam = camRef.current;
      if (!cam) return;
      const wasDragging = dragging;
      dragging = false;
      if (!wasDragging || moved > DRAG_THRESHOLD_PX) return;

      const [x, y] = localPos(e);
      const [lon, lat] = screenToLonLat(cam, x, y);
      const state = useStore.getState();

      if (state.tool === 'draw') {
        state.addDraftPoint(lon, lat, pixelsToKm(cam, SNAP_PX, lat));
      } else {
        // 選取模式：點到車站就選中它所屬的第一條線
        const snapKm = pixelsToKm(cam, SNAP_PX, lat);
        let hit: string | null = null;
        let bestKm = snapKm;
        for (const s of Object.values(state.network.stations)) {
          const km = kmBetween(lon, lat, s.lon, s.lat);
          if (km <= bestKm) {
            bestKm = km;
            hit = s.id;
          }
        }
        state.selectStation(hit);
        const line = hit
          ? state.network.lines.find((l) => l.stationIds.includes(hit!))
          : null;
        state.selectLine(line?.id ?? null);
      }
      dirtyRef.current = true;
    };

    const onDblClick = () => {
      const state = useStore.getState();
      if (state.tool === 'draw' && state.draft.length >= 2) state.finishDraft();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      if (!cam) return;
      const r = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(cam, e.clientX - r.left, e.clientY - r.top, factor, MIN_SCALE, MAX_SCALE);
      dirtyRef.current = true;
    };

    const onLeave = () => {
      dragging = false;
      cursorRef.current = null;
      dirtyRef.current = true;
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mouseleave', onLeave);

    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const state = useStore.getState();
      if (e.key === 'Enter') state.finishDraft();
      else if (e.key === 'Escape') state.cancelDraft();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        state.undoDraftPoint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <canvas ref={canvasRef} className="map-canvas" />;
}
