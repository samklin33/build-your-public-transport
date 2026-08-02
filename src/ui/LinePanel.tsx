import { useState } from 'react';
import { useStore } from '../state/store';

export function LinePanel() {
  const network = useStore((s) => s.network);
  const pack = useStore((s) => s.pack);
  const selectedLineId = useStore((s) => s.selectedLineId);
  const result = useStore((s) => s.result);
  const [open, setOpen] = useState(true);

  if (!pack || network.lines.length === 0) return null;
  const s = useStore.getState();

  return (
    <div className={open ? 'panel panel-lines' : 'panel panel-lines collapsed'}>
      <button className="lines-toggle" onClick={() => setOpen(!open)}>
        <span>路線 ({network.lines.length})</span>
        <span className="caret">{open ? '▾' : '▸'}</span>
      </button>
      <div className="line-list" hidden={!open}>
        {network.lines.map((line) => {
          const spec = pack.costModel.modes[line.mode];
          const res = result?.lines.find((l) => l.lineId === line.id);
          const selected = selectedLineId === line.id;
          return (
            <div
              key={line.id}
              className={selected ? 'line-row selected' : 'line-row'}
              onClick={() => s.selectLine(selected ? null : line.id)}
            >
              <div className="line-head">
                <span className="swatch" style={{ background: line.color }} />
                <input
                  className="line-name"
                  value={line.name}
                  onChange={(e) => s.renameLine(line.id, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  className="icon-btn"
                  title="刪除路線"
                  onClick={(e) => {
                    e.stopPropagation();
                    s.deleteLine(line.id);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="line-meta">
                {spec.name} · {line.stationIds.length} 站
                {res && ` · ${res.lengthKm.toFixed(1)} km · ${Math.round(res.buildCost)} 億`}
              </div>
              {selected && (
                <div className="line-controls" onClick={(e) => e.stopPropagation()}>
                  <label>
                    班距 {Math.round(line.headwaySec / 60 * 10) / 10} 分
                    <input
                      type="range"
                      min={spec.minHeadwaySec}
                      max={spec.maxHeadwaySec}
                      step={15}
                      value={line.headwaySec}
                      onChange={(e) => s.setLineHeadway(line.id, Number(e.target.value))}
                    />
                  </label>
                  {res && (
                    <div className="line-stats">
                      <span>全日 {Math.round(res.dailyRidership).toLocaleString()} 人次</span>
                      <span className={res.maxLoadFactor > 1 ? 'warn' : ''}>
                        負載 {(res.maxLoadFactor * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
