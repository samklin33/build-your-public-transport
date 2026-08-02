import { useEffect, useState } from 'react';
import { MapCanvas } from './render/MapCanvas';
import { useStore } from './state/store';
import { LinePanel } from './ui/LinePanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { StationPanel } from './ui/StationPanel';
import { Toolbar } from './ui/Toolbar';

export function App() {
  const pack = useStore((s) => s.pack);
  const loadError = useStore((s) => s.loadError);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  if (loadError) {
    return (
      <div className="boot boot-error">
        <h1>載入失敗</h1>
        <p>{loadError}</p>
        <p className="note">
          若城市資料尚未產生，請先執行 <code>npm run fetch:sources</code> 與{' '}
          <code>npm run build:pack</code>。
        </p>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="boot">
        <h1>雙北運輸規劃</h1>
        <p>載入城市資料中…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      <main className="map-area">
        <MapCanvas />
        <LinePanel />
        <StationPanel />
        <button className="sources-btn" onClick={() => setShowSources(true)}>
          資料來源
        </button>
      </main>
      <ResultsPanel />

      {showSources && (
        <div className="modal-backdrop" onClick={() => setShowSources(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>資料來源與模型假設</h2>
            <ul className="sources">
              {pack.sources.map((s) => (
                <li key={s.name}>
                  <b>{s.name}</b>
                  <div className="src-meta">
                    {s.provider} · {s.year}
                  </div>
                  {s.note && <div className="src-note">{s.note}</div>}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="note">
              人口是真實的區級統計，村里層級由本專案往下推估；
              就業分布沒有開放資料，是以就業中心模型合成的。
              模擬結果適合用來比較不同規劃方案的優劣，不適合當作工程可行性評估。
            </p>
            <button className="btn" onClick={() => setShowSources(false)}>
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
