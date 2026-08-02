import { LINE_PALETTE } from './defaults';
import { kmBetween } from './geo';
import type { Line, Network, PackNetwork, Station, TransitMode } from './types';

export function emptyNetwork(): Network {
  return { stations: {}, lines: [] };
}

export function packNetworkToNetwork(pn: PackNetwork): Network {
  const stations: Record<string, Station> = {};
  for (const s of pn.stations) {
    stations[s.id] = { id: s.id, name: s.name, lon: s.lon, lat: s.lat };
  }
  return {
    stations,
    lines: pn.lines.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      mode: l.mode,
      stationIds: [...l.stationIds],
      headwaySec: l.headwaySec,
    })),
  };
}

export function cloneNetwork(n: Network): Network {
  const stations: Record<string, Station> = {};
  for (const [k, v] of Object.entries(n.stations)) stations[k] = { ...v };
  return { stations, lines: n.lines.map((l) => ({ ...l, stationIds: [...l.stationIds] })) };
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** 找出離指定座標最近、且在 snapKm 之內的車站 —— 用來讓玩家點擊時自動接上既有車站形成轉乘。 */
export function findNearestStation(
  network: Network,
  lon: number,
  lat: number,
  snapKm: number,
): Station | null {
  let best: Station | null = null;
  let bestKm = snapKm;
  for (const s of Object.values(network.stations)) {
    const km = kmBetween(lon, lat, s.lon, s.lat);
    if (km <= bestKm) {
      bestKm = km;
      best = s;
    }
  }
  return best;
}

export function lineLengthKm(network: Network, line: Line): number {
  let km = 0;
  for (let i = 0; i < line.stationIds.length - 1; i++) {
    const a = network.stations[line.stationIds[i]];
    const b = network.stations[line.stationIds[i + 1]];
    if (a && b) km += kmBetween(a.lon, a.lat, b.lon, b.lat);
  }
  return km;
}

export function nextLineColor(network: Network): string {
  const used = new Set(network.lines.map((l) => l.color));
  return LINE_PALETTE.find((c) => !used.has(c)) ?? LINE_PALETTE[network.lines.length % LINE_PALETTE.length];
}

export function nextLineName(network: Network, mode: TransitMode): string {
  const prefix =
    mode === 'bus' ? '公車' : mode === 'lrt' ? '輕軌' : '捷運';
  const n = network.lines.filter((l) => l.name.startsWith(prefix)).length + 1;
  return `${prefix}${n}號線`;
}

/** 移除沒有被任何路線使用到的車站。 */
export function pruneOrphanStations(network: Network): void {
  const used = new Set<string>();
  for (const l of network.lines) for (const id of l.stationIds) used.add(id);
  for (const id of Object.keys(network.stations)) {
    if (!used.has(id)) delete network.stations[id];
  }
}
