import type { EmploymentCenter, SourceRef } from '../src/model/types';

/**
 * 雙北的就業中心。
 *
 * ⚠️ 這是模型假設，不是實測資料。
 * 台灣的村里級就業人口沒有開放資料可用（工商普查只到鄉鎮市區且非開放格式），
 * 因此改以「具名的就業中心 + 距離衰減」來合成就業分布。
 * 位置取自各商圈／園區的實際中心點，就業數為公開報導與園區規模的量級估計。
 *
 * 這些數字直接影響模擬出來的通勤流向，是最該被檢視與調整的參數。
 * 調整後請重跑 npm run build:pack 與 npm run calibrate。
 */
export const TAIPEI_EMPLOYMENT_CENTERS: EmploymentCenter[] = [
  // 台北車站一帶除了城中商圈與政府機關，還是台鐵、高鐵與國道客運的轉運節點。
  // 本模擬沒有城際運具，那部分的集散完全缺席，因此這裡的就業數刻意訂得高一些，
  // 讓它在路網中的樞紐地位接近現實。
  // 站前／城中商圈的就業密度極高且集中在很小的範圍內，衰減半徑要跟著壓小 ——
  // 半徑放大反而會把工作攤散到走不到的地方，讓這個全台最大的轉運節點被低估。
  { name: '台北車站／中正商圈', lon: 121.5170, lat: 25.0478, jobs: 240_000, radiusKm: 1.0 },
  { name: '信義計畫區', lon: 121.5654, lat: 25.0330, jobs: 150_000, radiusKm: 1.1 },
  { name: '大安／忠孝東路', lon: 121.5436, lat: 25.0418, jobs: 120_000, radiusKm: 1.3 },
  { name: '內湖科技園區', lon: 121.5750, lat: 25.0790, jobs: 160_000, radiusKm: 1.6 },
  { name: '南港經貿園區', lon: 121.6070, lat: 25.0530, jobs: 60_000, radiusKm: 1.3 },
  { name: '松山／民生社區', lon: 121.5560, lat: 25.0570, jobs: 70_000, radiusKm: 1.2 },
  { name: '士林／天母', lon: 121.5250, lat: 25.0930, jobs: 40_000, radiusKm: 1.5 },
  { name: '板橋新板特區', lon: 121.4640, lat: 25.0130, jobs: 80_000, radiusKm: 1.5 },
  { name: '新莊副都心', lon: 121.4530, lat: 25.0600, jobs: 50_000, radiusKm: 1.5 },
  { name: '三重／蘆洲', lon: 121.4880, lat: 25.0620, jobs: 50_000, radiusKm: 1.6 },
  { name: '中和／永和', lon: 121.4990, lat: 25.0000, jobs: 70_000, radiusKm: 1.7 },
  { name: '新店市區', lon: 121.5420, lat: 24.9670, jobs: 40_000, radiusKm: 1.5 },
  { name: '汐止', lon: 121.6580, lat: 25.0630, jobs: 40_000, radiusKm: 1.6 },
  { name: '土城／樹林', lon: 121.4430, lat: 24.9720, jobs: 45_000, radiusKm: 1.8 },
  { name: '五股／泰山', lon: 121.4380, lat: 25.0830, jobs: 35_000, radiusKm: 1.6 },
  { name: '淡水', lon: 121.4450, lat: 25.1670, jobs: 20_000, radiusKm: 1.4 },
];

/**
 * 除了就業中心之外，每個 zone 還會依人口配得一部分「地方性就業」
 * （零售、餐飲、學校、診所等隨人口分布的工作）。
 */
export const LOCAL_JOB_RATE = 0.25;

/**
 * 就業中心把工作分配到各 zone 時，除了距離衰減之外還會乘上 population^JOB_POP_EXPONENT，
 * 用意是避免把辦公室灌到山區或河灘地這種沒有開發的地方。
 *
 * 但指數不能太大：中正區、信義計畫區這類商業區的「居住」人口本來就低，
 * 指數一大就會反過來懲罰真正的商業中心。0.25 是弱耦合，
 * 足以擋掉未開發地，又不至於讓商業區被住宅區蓋過去。
 */
export const JOB_POP_EXPONENT = 0.25;

export const TAIPEI_SOURCES: SourceRef[] = [
  {
    name: '村里界圖與行政區界',
    provider: '內政部（經 npm 套件 taiwan-atlas 重新封裝）',
    year: '2021',
    url: 'https://www.npmjs.com/package/taiwan-atlas',
    note: '已簡化至 10t 精度，面積誤差約 5%，對遊戲無影響。',
  },
  {
    name: '各鄉鎮市區人口密度',
    provider: '內政部戶政司',
    year: '民國 106 年（2017）',
    url: 'https://github.com/roberthsu2003/python',
    note: '雙北 41 區全部成功對應，總人口 6,669,946。村里層級人口為本專案由區級推估。',
  },
  {
    name: '台北捷運路網與站點座標',
    provider: 'OpenStreetMap（經 siriushsu/taiwan-rail-live 擷取）',
    year: '2026',
    url: 'https://github.com/siriushsu/taiwan-rail-live',
    note: '站序取自 route relation，共 116 站、7 條路線分支，含官方線色與尖離峰班距。',
  },
  {
    name: '就業人口分布',
    provider: '本專案模型推估',
    year: '—',
    url: '',
    note: '⚠️ 非真實資料。以具名就業中心加距離衰減合成，詳見 docs/simulation.md。',
  },
];
