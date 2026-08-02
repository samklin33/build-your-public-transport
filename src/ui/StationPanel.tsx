import { useStore } from '../state/store';

/**
 * 選取模式下點到車站時出現，可以改站名。
 * 新站預設用所在的里命名（民安里、江翠里…），但那只是個起點，
 * 玩家本來就該能取自己的名字。
 */
export function StationPanel() {
  const network = useStore((s) => s.network);
  const selectedStationId = useStore((s) => s.selectedStationId);
  const result = useStore((s) => s.result);
  const pack = useStore((s) => s.pack);

  if (!selectedStationId || !pack) return null;
  const station = network.stations[selectedStationId];
  if (!station) return null;

  const s = useStore.getState();
  const serving = network.lines.filter((l) => l.stationIds.includes(station.id));
  const stat = result?.stations[station.id];
  const dailyFactor = 1 / pack.simParams.peakHourShare;

  return (
    <div className="panel panel-station">
      <div className="station-head">
        <h2>車站</h2>
        <button
          className="icon-btn"
          title="關閉"
          onClick={() => s.selectStation(null)}
        >
          ×
        </button>
      </div>

      <label className="field">
        <span>站名</span>
        <input
          className="station-name"
          value={station.name}
          autoFocus
          onChange={(e) => s.renameStation(station.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
        />
      </label>

      <div className="station-lines">
        {serving.length === 0 ? (
          <span className="dim">尚未有路線經過</span>
        ) : (
          serving.map((l) => (
            <button
              key={l.id}
              className="station-line"
              onClick={() => s.selectLine(l.id)}
            >
              <span className="swatch" style={{ background: l.color }} />
              {l.name}
            </button>
          ))
        )}
      </div>

      {stat && (
        <div className="station-stats">
          <div>
            <span className="dim">全日進出站</span>
            <b>
              {Math.round((stat.boardings + stat.alightings) * dailyFactor).toLocaleString()}
            </b>
          </div>
          {stat.transfers > 0 && (
            <div>
              <span className="dim">轉乘</span>
              <b>{Math.round(stat.transfers * dailyFactor).toLocaleString()}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
