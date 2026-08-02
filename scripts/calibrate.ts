/**
 * 校準：把「真實的台北捷運路網」餵進模擬器，看輸出跟現實差多少。
 *
 * 這是整個專案最重要的一道驗證 —— 模擬器如果連現實中已經存在的路網
 * 都算不出接近現實的運量，玩家自己畫的路網得到的數字就沒有意義。
 *
 * 對照標的（公開資料的量級）：
 *   - 台北捷運全系統平日運量約 200–220 萬人次／日
 *   - 最繁忙路線為板南線與淡水信義線
 *   - 運量最高的車站集中在台北車站與主要轉乘站
 *
 * 執行：npm run calibrate
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packNetworkToNetwork } from '../src/model/network';
import type { CityPack } from '../src/model/types';
import { createSimContext, simulate } from '../src/sim/simulate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TARGET_DAILY_MIN = 2_000_000;
const TARGET_DAILY_MAX = 2_200_000;

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

async function main() {
  const pack = JSON.parse(
    await readFile(resolve(ROOT, 'public/city-packs/taipei.json'), 'utf8'),
  ) as CityPack;

  console.log(`城市：${pack.name}`);
  console.log(
    `參數：gravityBeta=${pack.simParams.gravityBeta} ` +
      `logitConstant=${pack.simParams.logitConstant} ` +
      `logitTimeCoef=${pack.simParams.logitTimeCoef} ` +
      `carSpeed=${pack.simParams.carSpeedKmh}km/h\n`,
  );

  const ctx = createSimContext(pack);
  const network = packNetworkToNetwork(pack.referenceNetwork);

  console.log(
    `真實路網：${Object.keys(network.stations).length} 站 / ${network.lines.length} 條路線分支`,
  );

  const r = simulate(ctx, network);

  console.log(`模擬耗時 ${r.computeMs.toFixed(0)} ms\n`);
  console.log('── 整體 ──');
  console.log(`  全日大眾運輸旅次      ${fmt(r.dailyTransitTrips)}`);
  console.log(`  尖峰小時旅次          ${fmt(r.peakTransitTrips)}`);
  console.log(`  運具分擔率            ${(r.modeShare * 100).toFixed(1)}%`);
  console.log(`  人口涵蓋率(800m)      ${(r.coveragePct * 100).toFixed(1)}%  (${fmt(r.coveredPopulation)} 人)`);
  console.log(`  平均旅行時間          ${r.avgAllTimeMin.toFixed(1)} 分（無路網基準 ${r.baselineTimeMin.toFixed(1)} 分）`);
  console.log(`  搭乘者平均旅行時間    ${r.avgTransitTimeMin.toFixed(1)} 分`);

  console.log('\n── 各線運量（全日）──');
  const byLine = [...r.lines].sort((a, b) => b.dailyRidership - a.dailyRidership);
  const nameOf = (id: string) => network.lines.find((l) => l.id === id)?.name ?? id;
  for (const l of byLine) {
    console.log(
      `  ${nameOf(l.lineId).padEnd(22)} ${fmt(l.dailyRidership).padStart(9)} 人次   ` +
        `${l.lengthKm.toFixed(1).padStart(5)} km   ` +
        `最大斷面 ${fmt(l.maxLoad).padStart(6)} 人/時 (負載率 ${(l.maxLoadFactor * 100).toFixed(0)}%)`,
    );
  }

  console.log('\n── 運量前 15 大車站（全日進出站人次）──');
  // 模擬的是早尖峰單一方向：通勤者在住家端上車、在工作端下車。
  // 一整天下來還有回程，回程正好是反過來 —— 因此車站的全日進出站人次
  // 要用「上車 + 下車」來估，只看上車會讓住宅區被高估、商業區被低估。
  const dailyFactor = 1 / pack.simParams.peakHourShare;
  const stationEntries = Object.entries(r.stations)
    .map(([id, s]) => ({
      name: network.stations[id]?.name ?? id,
      daily: (s.boardings + s.alightings) * dailyFactor,
      transfers: s.transfers * dailyFactor,
    }))
    .sort((a, b) => b.daily - a.daily);
  stationEntries.slice(0, 15).forEach((s, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}. ${s.name.padEnd(10)} ${fmt(s.daily).padStart(8)} 人次` +
        `   轉乘 ${fmt(s.transfers).padStart(8)}`,
    );
  });

  const taipeiMainRank =
    stationEntries.findIndex((s) => s.name === '台北車站') + 1;

  console.log('\n── 財務 ──');
  const f = r.finance;
  console.log(`  建設成本   ${f.totalBuildCost.toFixed(0)} 億元`);
  console.log(`  年營運成本 ${f.annualOpCost.toFixed(1)} 億元`);
  console.log(`  年票箱收入 ${f.annualFareRevenue.toFixed(1)} 億元`);
  console.log(`  年損益     ${f.annualBalance.toFixed(1)} 億元   票箱回收率 ${(f.fareboxRecovery * 100).toFixed(0)}%`);

  console.log('\n── 校準檢查 ──');
  const checks: [string, boolean, string][] = [
    [
      `全日運量落在 ${fmt(TARGET_DAILY_MIN)}–${fmt(TARGET_DAILY_MAX)}`,
      r.dailyTransitTrips >= TARGET_DAILY_MIN && r.dailyTransitTrips <= TARGET_DAILY_MAX,
      fmt(r.dailyTransitTrips),
    ],
    [
      '最繁忙路線為板南線或淡水信義線',
      ['板南線', '淡水信義線'].includes(nameOf(byLine[0]?.lineId ?? '')),
      nameOf(byLine[0]?.lineId ?? '（無）'),
    ],
    [
      // 現實中台北車站是運量第一，但本模擬沒有台鐵、高鐵與國道客運，
      // 台北車站作為城際轉運節點的那一大塊集散量完全缺席，因此不要求它排第一。
      '台北車站進入運量前 5 名',
      taipeiMainRank > 0 && taipeiMainRank <= 5,
      taipeiMainRank > 0 ? `第 ${taipeiMainRank} 名` : '未進榜',
    ],
    [
      '人口涵蓋率介於 40%–75%',
      r.coveragePct >= 0.4 && r.coveragePct <= 0.75,
      `${(r.coveragePct * 100).toFixed(1)}%`,
    ],
    ['模擬在 1 秒內完成', r.computeMs < 1000, `${r.computeMs.toFixed(0)} ms`],
  ];

  let failed = 0;
  for (const [label, ok, actual] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label} — ${actual}`);
    if (!ok) failed++;
  }

  if (failed) {
    console.log(
      `\n${failed} 項未通過。請調整 src/model/defaults.ts 的 DEFAULT_SIM_PARAMS 後` +
        ` 重跑 npm run build:pack && npm run calibrate。`,
    );
    process.exitCode = 1;
  } else {
    console.log('\n全部通過。');
  }
}

main().catch((err) => {
  console.error('\n✗ calibrate 失敗:', err);
  process.exit(1);
});
