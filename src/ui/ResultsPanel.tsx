import { useMemo, useState } from 'react';
import { useStore } from '../state/store';

const fmt = (n: number) => Math.round(n).toLocaleString('zh-TW');
const fmt1 = (n: number) => n.toFixed(1);

type Tab = 'ridership' | 'coverage' | 'time' | 'finance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ridership', label: '運量' },
  { id: 'coverage', label: '涵蓋率' },
  { id: 'time', label: '通勤時間' },
  { id: 'finance', label: '財務' },
];

export function ResultsPanel() {
  const result = useStore((s) => s.result);
  const network = useStore((s) => s.network);
  const pack = useStore((s) => s.pack);
  const simulating = useStore((s) => s.simulating);
  const selectedLineId = useStore((s) => s.selectedLineId);
  const [tab, setTab] = useState<Tab>('ridership');

  const dailyFactor = pack ? 1 / pack.simParams.peakHourShare : 0;

  const topStations = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.stations)
      .map(([id, v]) => ({
        id,
        name: network.stations[id]?.name ?? id,
        daily: (v.boardings + v.alightings) * dailyFactor,
        transfers: v.transfers * dailyFactor,
      }))
      .sort((a, b) => b.daily - a.daily)
      .slice(0, 12);
  }, [result, network, dailyFactor]);

  if (!pack) return null;

  const hasNetwork = network.lines.length > 0;

  return (
    <aside className="panel panel-right">
      <div className="results-head">
        <h2>模擬結果</h2>
        {simulating && <span className="pill">計算中…</span>}
        {result && !simulating && (
          <span className="pill dim">{result.computeMs.toFixed(0)} ms</span>
        )}
      </div>

      {!hasNetwork && (
        <p className="empty">
          還沒有任何路線。選好運具後在地圖上點幾個站，按 Enter 完成，
          模擬就會立刻跑出來。
        </p>
      )}

      {hasNetwork && result && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="全日運量"
              value={fmt(result.dailyTransitTrips)}
              unit="人次"
            />
            <Kpi
              label="運具分擔率"
              value={fmt1(result.modeShare * 100)}
              unit="%"
            />
            <Kpi
              label="人口涵蓋率"
              value={fmt1(result.coveragePct * 100)}
              unit="%"
            />
            <Kpi
              label="平均通勤"
              value={fmt1(result.avgAllTimeMin)}
              unit="分"
              delta={result.avgAllTimeMin - result.baselineTimeMin}
            />
          </div>

          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="tab-body">
            {tab === 'ridership' && (
              <>
                <h3>各線運量（全日）</h3>
                <table className="tbl">
                  <tbody>
                    {[...result.lines]
                      .sort((a, b) => b.dailyRidership - a.dailyRidership)
                      .map((l) => {
                        const line = network.lines.find((x) => x.id === l.lineId);
                        if (!line) return null;
                        const over = l.maxLoadFactor > 1;
                        return (
                          <tr
                            key={l.lineId}
                            className={selectedLineId === l.lineId ? 'sel' : ''}
                            onClick={() => useStore.getState().selectLine(l.lineId)}
                          >
                            <td className="c-swatch">
                              <span className="swatch" style={{ background: line.color }} />
                            </td>
                            <td className="c-name" title={line.name}>
                              {line.name}
                            </td>
                            <td className="c-num">{fmt(l.dailyRidership)}</td>
                            <td className={over ? 'c-load warn' : 'c-load dim'}>
                              {Math.round(l.maxLoadFactor * 100)}%
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <p className="note">
                  第三欄是全日搭乘人次，第四欄是最大斷面負載率。
                  超過 100% 代表尖峰時段會擠不上車，要縮短班距或分流。
                </p>

                <h3>運量前 12 大車站（全日進出站）</h3>
                <table className="tbl">
                  <tbody>
                    {topStations.map((s, i) => (
                      <tr key={s.id}>
                        <td className="c-rank">{i + 1}</td>
                        <td className="c-name" title={s.name}>
                          {s.name}
                        </td>
                        <td className="c-num">{fmt(s.daily)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {tab === 'coverage' && (
              <>
                <h3>人口涵蓋率</h3>
                <BigStat
                  value={`${fmt1(result.coveragePct * 100)}%`}
                  sub={`${fmt(result.coveredPopulation)} 人住在車站 800 公尺步行範圍內`}
                />
                <p className="note">
                  把左邊的地圖著色切到「涵蓋率」，綠色是有服務、灰色是沒服務的里，
                  可以直接看出還有哪些人口稠密卻沒被照顧到的區塊。
                </p>
                <h3>未涵蓋人口</h3>
                <BigStat
                  value={fmt(
                    (pack.districts.reduce((a, d) => a + d.population, 0) || 0) -
                      result.coveredPopulation,
                  )}
                  sub="人"
                />
              </>
            )}

            {tab === 'time' && (
              <>
                <h3>平均通勤時間</h3>
                <div className="compare">
                  <div>
                    <span className="cmp-label">完全沒有大眾運輸</span>
                    <span className="cmp-value">{fmt1(result.baselineTimeMin)} 分</span>
                  </div>
                  <div className="cmp-arrow">→</div>
                  <div>
                    <span className="cmp-label">你的規劃</span>
                    <span className="cmp-value good">{fmt1(result.avgAllTimeMin)} 分</span>
                  </div>
                </div>
                <BigStat
                  value={`${result.avgAllTimeMin <= result.baselineTimeMin ? '−' : '+'}${fmt1(
                    Math.abs(result.baselineTimeMin - result.avgAllTimeMin),
                  )} 分`}
                  sub="全體平均每趟旅行時間的變化"
                />
                <p className="note">
                  路網不只讓搭車的人受益。把車流從道路移到軌道上，
                  留在路上開車的人也會因為比較不塞而變快 —— 這才是大眾運輸真正的價值。
                  搭乘者本身的平均旅行時間是 {fmt1(result.avgTransitTimeMin)} 分。
                </p>
              </>
            )}

            {tab === 'finance' && (
              <>
                <h3>建設</h3>
                <BigStat value={`${fmt(result.finance.totalBuildCost)} 億元`} sub="總建設成本" />
                <h3>每年營運</h3>
                <table className="tbl">
                  <tbody>
                    <tr>
                      <td className="c-name">票箱收入</td>
                      <td className="c-num">{fmt1(result.finance.annualFareRevenue)} 億</td>
                    </tr>
                    <tr>
                      <td className="c-name">營運成本</td>
                      <td className="c-num">−{fmt1(result.finance.annualOpCost)} 億</td>
                    </tr>
                    <tr className="total">
                      <td className="c-name">年損益</td>
                      <td
                        className={
                          result.finance.annualBalance >= 0 ? 'c-num good' : 'c-num warn'
                        }
                      >
                        {result.finance.annualBalance >= 0 ? '+' : '−'}
                        {fmt1(Math.abs(result.finance.annualBalance))} 億
                      </td>
                    </tr>
                  </tbody>
                </table>
                <BigStat
                  value={`${fmt1(result.finance.fareboxRecovery * 100)}%`}
                  sub="票箱回收率（收入 ÷ 營運成本）"
                />
                <p className="note">
                  回收率超過 100% 代表營運本身賺得回來，建設成本則另計。
                  台北捷運實際的票箱回收率大約在 100% 上下，是全球少數做得到的系統。
                </p>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Kpi({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}
        <span className="kpi-unit">{unit}</span>
      </div>
      {delta !== undefined && Math.abs(delta) > 0.05 && (
        <div className={delta < 0 ? 'kpi-delta good' : 'kpi-delta warn'}>
          {delta < 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(1)} 分
        </div>
      )}
    </div>
  );
}

function BigStat({ value, sub }: { value: string; sub: string }) {
  return (
    <div className="bigstat">
      <div className="bigstat-value">{value}</div>
      <div className="bigstat-sub">{sub}</div>
    </div>
  );
}
