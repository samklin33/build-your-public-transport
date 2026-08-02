import { useRef } from 'react';
import { MODE_ORDER } from '../model/types';
import { useStore, type Overlay, type Scenario } from '../state/store';

const OVERLAYS: { id: Overlay; label: string; hint: string }[] = [
  { id: 'density', label: '人口密度', hint: '每平方公里居住人口' },
  { id: 'coverage', label: '涵蓋率', hint: '是否在車站 800 公尺步行範圍內' },
  { id: 'access', label: '可及性', hint: '搭乘大眾運輸的平均旅行時間' },
  { id: 'none', label: '純底圖', hint: '不著色' },
];

const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'blank', label: '白紙重畫', hint: '雙北完全沒有軌道運輸，從零開始規劃' },
  { id: 'extend', label: '現況延伸', hint: '載入現實的台北捷運，規劃下一階段擴建' },
];

export function Toolbar() {
  const pack = useStore((s) => s.pack);
  const tool = useStore((s) => s.tool);
  const drawMode = useStore((s) => s.drawMode);
  const overlay = useStore((s) => s.overlay);
  const scenario = useStore((s) => s.scenario);
  const showRidership = useStore((s) => s.showRidership);
  const showRoads = useStore((s) => s.showRoads);
  const draft = useStore((s) => s.draft);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!pack) return null;
  const s = useStore.getState();

  const download = () => {
    const blob = new Blob([s.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-transit-plan.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <aside className="panel panel-left">
      <div className="brand">
        <h1>雙北運輸規劃</h1>
        <p>用真實資料規劃你自己的路網</p>
      </div>

      <section>
        <h2>情境</h2>
        <div className="seg">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              className={scenario === sc.id ? 'seg-btn active' : 'seg-btn'}
              title={sc.hint}
              onClick={() => {
                if (
                  s.network.lines.length > 0 &&
                  !confirm('切換情境會清掉目前的規劃，確定嗎？')
                )
                  return;
                s.setScenario(sc.id);
              }}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>工具</h2>
        <div className="seg">
          <button
            className={tool === 'draw' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => s.setTool('draw')}
          >
            畫線
          </button>
          <button
            className={tool === 'select' ? 'seg-btn active' : 'seg-btn'}
            onClick={() => s.setTool('select')}
          >
            選取
          </button>
        </div>

        {tool === 'draw' && (
          <>
            <div className="mode-list">
              {MODE_ORDER.map((m) => {
                const spec = pack.costModel.modes[m];
                return (
                  <button
                    key={m}
                    className={drawMode === m ? 'mode-btn active' : 'mode-btn'}
                    onClick={() => s.setDrawMode(m)}
                  >
                    <span className="swatch" style={{ background: spec.color }} />
                    <span className="mode-name">{spec.name}</span>
                    <span className="mode-cost">{spec.buildCostPerKm} 億/km</span>
                  </button>
                );
              })}
            </div>

            <div className="draw-help">
              {draft.length === 0 ? (
                <>在地圖上點擊放置車站</>
              ) : (
                <>
                  已放 <b>{draft.length}</b> 站 ·{' '}
                  <button className="link" onClick={() => s.finishDraft()}>
                    完成 (Enter)
                  </button>{' '}
                  ·{' '}
                  <button className="link" onClick={() => s.undoDraftPoint()}>
                    退一步
                  </button>{' '}
                  ·{' '}
                  <button className="link" onClick={() => s.cancelDraft()}>
                    取消 (Esc)
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section>
        <h2>地圖著色</h2>
        <div className="overlay-list">
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              className={overlay === o.id ? 'chip active' : 'chip'}
              title={o.hint}
              onClick={() => s.setOverlay(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={showRidership} onChange={() => s.toggleRidership()} />
          路線粗細代表運量
        </label>
        <label className="check">
          <input type="checkbox" checked={showRoads} onChange={() => s.toggleRoads()} />
          顯示道路（拉近後顯示次要道路）
        </label>
      </section>

      <section>
        <h2>檔案</h2>
        <div className="btn-row">
          <button className="btn" onClick={() => s.loadRealNetwork()}>
            疊上真實捷運
          </button>
          <button className="btn" onClick={download}>
            匯出
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            匯入
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) s.importJson(await f.text());
            e.target.value = '';
          }}
        />
      </section>
    </aside>
  );
}
