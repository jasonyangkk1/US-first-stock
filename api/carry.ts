import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * BOJ 機率設定：
 * 在 Vercel Dashboard > Settings > Environment Variables 中設定以下變數可即時更新（無需重新部署）：
 *   BOJ_HIKE_PROB     = 62   (6月升息隱含機率 %)
 *   BOJ_QT_PROB       = 32   (升息+QT同步機率 %)
 *   BOJ_PROB_UPDATED  = 2026-05-25 (數據更新日期)
 * 來源參考：Bloomberg OIS、Reuters 市場共識、日銀官員講話
 */
const BOJ_HIKE_PROB = Number(process.env.BOJ_HIKE_PROB ?? '62');
const BOJ_QT_PROB = Number(process.env.BOJ_QT_PROB ?? '32');
const BOJ_PROB_UPDATED = process.env.BOJ_PROB_UPDATED ?? '2026-05-25';

/**
 * 韓國市場人工更新指標：
 * 在 Vercel Dashboard > Settings > Environment Variables 設定，無需重新部署：
 *   KR_KOFIA_MARGIN       = 32.8   （KOFIA 全市場信用融資餘額，兆韓元，KOSPI+KOSDAQ 合計）
 *   KR_MARGIN_CALL_RISK   = LOW    （追繳風險：LOW / MODERATE / HIGH）
 *   KR_FOREIGN_NET_FLOW   = -1200  （外資期現貨合計買賣超，億韓元，負=賣超）
 *   KR_LEVERAGED_ETF_SIGNAL = 中性  （韓國散戶海外槓桿ETF買超訊號，文字描述）
 *   KR_DRAM_SPOT_TREND    = 持穩   （DRAM現貨價趨勢：走揚/持穩/走跌）
 *   KR_EXPORT_SEMI_10D    = 270.1  （前10日半導體出口年增率，%，來源：韓國關稅廳）
 *   KR_MANUAL_UPDATED     = 2026-09-30 （以上人工數據的更新日期，⚠️ 每次更新務必同步改這行）
 *
 * 【重要】KR_MANUAL_UPDATED 是新鮮度偵測的唯一依據，忘記更新這行 = 系統無法知道資料過期。
 * 更新頻率建議：KOFIA/外資買賣超 → 每週；半導體出口/DRAM → 每 10 天（配合關稅廳發布節奏）。
 *
 * 來源參考：
 *   KOFIA 全市場融資餘額 → KOFIA 官網信用交易統計（KOSPI+KOSDAQ 合計，非僅 KOSPI）
 *   外資期現貨買賣超 → KRX 每日結算報告
 *   半導體出口 YoY → 韓國關稅廳「수출입 현황」每旬（1-10日/1-20日/全月）公告，通常於旬結束後隔天公布
 *   DRAM趨勢 → DRAMeXchange / TrendForce 新聞稿
 */
const KR_KOFIA_MARGIN       = Number(process.env.KR_KOFIA_MARGIN ?? '32.8');
const KR_MARGIN_CALL_RISK   = process.env.KR_MARGIN_CALL_RISK ?? 'LOW';
const KR_FOREIGN_NET_FLOW   = Number(process.env.KR_FOREIGN_NET_FLOW ?? '-1200');
const KR_LEVERAGED_ETF_SIGNAL = process.env.KR_LEVERAGED_ETF_SIGNAL ?? '中性';
const KR_DRAM_SPOT_TREND    = process.env.KR_DRAM_SPOT_TREND ?? '持穩';
const KR_EXPORT_SEMI_10D    = Number(process.env.KR_EXPORT_SEMI_10D ?? '270.1');
const KR_MANUAL_UPDATED     = process.env.KR_MANUAL_UPDATED ?? '2026-09-30';

// ── 資料新鮮度計算：距離人工更新已過幾天 ──
// > 21 天 = stale（紅），8-21 天 = aging（黃），≤ 7 天 = fresh（綠）
function computeStaleness(updatedDateStr: string): { daysSince: number; level: 'fresh' | 'aging' | 'stale' } {
  const updated = new Date(updatedDateStr + 'T00:00:00Z').getTime();
  const now = Date.now();
  const daysSince = Math.max(0, Math.floor((now - updated) / 86_400_000));
  const level = daysSince > 21 ? 'stale' : daysSince > 7 ? 'aging' : 'fresh';
  return { daysSince, level };
}

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 300_000; // 5 minutes cache

async function fetchFromFred(seriesId: string): Promise<number | null> {
  if (!FRED_API_KEY) return null;
  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const latest = data.observations?.[0];
    if (latest && latest.value !== '.') {
      return Number(latest.value);
    }
  } catch (e) {
    console.error(`[carry] FRED fetch error for ${seriesId}:`, e);
  }
  return null;
}

async function fetchFromFredMultiple(seriesId: string, limit: number): Promise<number[]> {
  if (!FRED_API_KEY) return [];
  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data.observations || [])
      .filter((o: any) => o.value !== '.')
      .map((o: any) => Number(o.value));
  } catch (e) {
    console.error(`[carry] FRED multiple fetch error for ${seriesId}:`, e);
    return [];
  }
}

/**
 * 估算美日實質通膨差
 * 美國 CPI YoY - 日本 CPI YoY（以 FRED 公開數據）
 * CPIAUCSL = 美國 CPI（月資料）
 * JPNCPIALLMINMEI = 日本 CPI（月資料）
 * Fallback: 1.5%（歷史平均差值）
 */
async function fetchInflationDiff(): Promise<number> {
  const FALLBACK = 1.5;
  if (!FRED_API_KEY) return FALLBACK;
  try {
    // 抓13筆：最新 + 12個月前，計算年增率
    const [usData, jpData] = await Promise.all([
      fetchFromFredMultiple('CPIAUCSL', 13),
      fetchFromFredMultiple('JPNCPIALLMINMEI', 13)
    ]);
    if (usData.length < 13 || jpData.length < 13) return FALLBACK;
    
    // YoY = (Current - 12mAgo) / 12mAgo * 100
    const usCpiYoY = ((usData[0] - usData[12]) / usData[12]) * 100;
    const jpCpiYoY = ((jpData[0] - jpData[12]) / jpData[12]) * 100;
    const diff = Number((usCpiYoY - jpCpiYoY).toFixed(2));
    
    // 合理範圍保護：差值應在 0% ~ 5% 之間
    return (diff > 0 && diff < 5) ? diff : FALLBACK;
  } catch (e) {
    console.error('[carry] fetchInflationDiff error:', e);
    return FALLBACK;
  }
}

/**
 * 韓國 T-0 即時前哨層：
 * - KOSPI 指數（^KS11）：大盤走勢
 * - EWY（美股掛牌韓國 ETF）：用成交量對比 30 日均量，代理外資資金流向訊號
 *   （EWY 在美股交易時段先行反映隔夜消息，是 KOSPI 開盤前最重要的領先指標）
 * - 三星電子（005930.KS）、SK 海力士（000660.KS）：半導體權值股情緒代理
 */
async function fetchKoreaTier1() {
  const tickers = ['^KS11', 'EWY', '005930.KS', '000660.KS'];

  const results = await Promise.allSettled(
    tickers.map(t => yahooFinance.quote(t).catch(() => null))
  );

  const [kospiQ, ewyQ, samsungQ, hynixQ] = results.map(r =>
    r.status === 'fulfilled' ? (r.value as any) : null
  );

  // EWY 成交量比：用來代理資金流出入強度（>1.5 = 異常放量，需留意方向）
  let ewyVolumeRatio: number | null = null;
  try {
    if (ewyQ) {
      const avgVol = ewyQ.averageDailyVolume10Day ?? ewyQ.averageDailyVolume3Month ?? null;
      if (avgVol && ewyQ.regularMarketVolume) {
        ewyVolumeRatio = Number((ewyQ.regularMarketVolume / avgVol).toFixed(2));
      }
    }
  } catch {}

  const kospi = kospiQ ? {
    value: kospiQ.regularMarketPrice ?? null,
    changePercent: kospiQ.regularMarketChangePercent ?? null,
    isLive: true,
  } : { value: null, changePercent: null, isLive: false };

  const ewy = ewyQ ? {
    price: ewyQ.regularMarketPrice ?? null,
    changePercent: ewyQ.regularMarketChangePercent ?? null,
    volume: ewyQ.regularMarketVolume ?? null,
    volumeRatio: ewyVolumeRatio,
    // 量比 > 1.8 且下跌 = 資金加速流出訊號；量比 > 1.8 且上漲 = 資金加速流入
    flowSignal: (ewyVolumeRatio != null && ewyVolumeRatio > 1.8)
      ? ((ewyQ.regularMarketChangePercent ?? 0) < 0 ? 'outflow_alert' : 'inflow_alert')
      : 'normal',
    isLive: true,
  } : { price: null, changePercent: null, volume: null, volumeRatio: null, flowSignal: 'normal', isLive: false };

  const samsung = samsungQ ? {
    price: samsungQ.regularMarketPrice ?? null,
    changePercent: samsungQ.regularMarketChangePercent ?? null,
    isLive: true,
  } : { price: null, changePercent: null, isLive: false };

  const skHynix = hynixQ ? {
    price: hynixQ.regularMarketPrice ?? null,
    changePercent: hynixQ.regularMarketChangePercent ?? null,
    isLive: true,
  } : { price: null, changePercent: null, isLive: false };

  // 半導體雙雄平均情緒（作為 KOSPI200 期現貨壓力的簡易代理，因無免費期貨基差數據）
  const semiAvgChange = (samsung.changePercent != null && skHynix.changePercent != null)
    ? Number(((samsung.changePercent + skHynix.changePercent) / 2).toFixed(2))
    : null;

  return { kospi, ewy, samsung, skHynix, semiAvgChange };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try to return from cache
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  // Setup default values
  let fedRate = 3.33; // Default FED funds effective rate ~2026年5月估算
  let fedRateRange = "3.25% - 3.50%";
  let bojRate = 0.50; // BOJ 升息後
  let usdJpy = 145.0; // 近期匯率區間
  let usdJpyWeeklyChange = 0.0;

  let fedIsLive = false;
  let bojIsLive = false;
  let usdJpyIsLive = false;

  // 1. Fetch FRED data & Inflation differential
  let inflationDiff = 1.5;
  if (FRED_API_KEY) {
    const [fedFetch, bojFetch, calculatedInflationDiff] = await Promise.all([
      fetchFromFred('FEDFUNDS'),
      fetchFromFred('IRSTCI01JPM156N'),
      fetchInflationDiff()
    ]);

    if (fedFetch !== null) {
      fedRate = fedFetch;
      fedIsLive = true;
      const lower = Math.floor(fedRate * 4) / 4;
      const upper = lower + 0.25;
      fedRateRange = `${lower.toFixed(2)}% - ${upper.toFixed(2)}%`;
    }

    if (bojFetch !== null) {
      bojRate = bojFetch;
      bojIsLive = true;
    }

    inflationDiff = calculatedInflationDiff;
  }

  // 2. Fetch Yahoo Finance data for USD/JPY
  try {
    const usdJpyQuote = await yahooFinance.quote('JPY=X');
    if (usdJpyQuote && usdJpyQuote.regularMarketPrice) {
      usdJpy = usdJpyQuote.regularMarketPrice;
      usdJpyIsLive = true;
    }

    // Measure weekly change via a 7-day chart
    const chartData = await yahooFinance.chart('JPY=X', {
      period1: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      interval: '1d'
    });
    const quotes = chartData.quotes || [];
    if (quotes.length >= 2) {
      const lastClose = quotes[quotes.length - 1].close;
      const firstClose = quotes[0].close;
      if (lastClose && firstClose) {
        const rawChange = ((lastClose - firstClose) / firstClose) * 100;
        usdJpyWeeklyChange = Number(rawChange.toFixed(2));
      }
    } else if (usdJpyQuote.regularMarketChangePercent !== undefined) {
      // Fallback: estimate weekly from daily change or daily absolute (direction preserved)
      usdJpyWeeklyChange = Number((usdJpyQuote.regularMarketChangePercent ?? 0.0).toFixed(2));
    }
  } catch (e) {
    console.error('[carry] Yahoo Finance fetch error:', e);
  }

  // 3. Perform calculations
  const nominalSpread = Number((fedRate - bojRate).toFixed(2));
  // Real spread estimation: nominalSpread - inflationDiff% inflation premium difference
  const realSpread = Number((nominalSpread - inflationDiff).toFixed(2));

  // Threshold 1: realSpreadProgress. When realSpread falls to 3.5% or less, progress is 100%. At 5.0% or above, progress is 0%.
  let realSpreadProgress: number;
  if (realSpread <= 3.5) {
    realSpreadProgress = 100;
  } else if (realSpread >= 5.0) {
    realSpreadProgress = 0;
  } else {
    realSpreadProgress = Number((((5.0 - realSpread) / (5.0 - 3.5)) * 100).toFixed(1));
  }

  // Determine BOJ Risk Level
  const riskLevel = BOJ_HIKE_PROB >= 60 ? 'HIGH' : BOJ_HIKE_PROB >= 40 ? 'MODERATE' : 'LOW';

  // ⚠️ 每年1月需更新此陣列，來源：https://www.boj.or.jp/en/mopo/mpmsche_mpi/
  const BOJ_MEETING_SCHEDULE_2026 = [
    { name: '6月會議', start: '2026-06-15', end: '2026-06-16' },
    { name: '7月會議', start: '2026-07-30', end: '2026-07-31' },
    { name: '9月會議', start: '2026-09-18', end: '2026-09-19' },
    { name: '10月會議', start: '2026-10-28', end: '2026-10-29' },
    { name: '12月會議', start: '2026-12-18', end: '2026-12-19' },
  ];

  const now = new Date();
  const nextMeeting = BOJ_MEETING_SCHEDULE_2026.find(m => new Date(m.end + 'T18:00:00+09:00') > now) ?? null;

  const daysUntilMeeting = nextMeeting
    ? Math.ceil((new Date(nextMeeting.start + 'T00:00:00+09:00').getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const startParts = nextMeeting ? nextMeeting.start.split('-') : [];
  const endParts = nextMeeting ? nextMeeting.end.split('-') : [];

  // 4. 韓國市場 Tier-1（即時）
  const koreaTier1 = await fetchKoreaTier1().catch(() => null);

  const results = {
    fedRate,
    fedRateRange,
    bojRate,
    nominalSpread,
    realSpread,
    realSpreadProgress,
    usdJpy,
    usdJpyWeeklyChange,
    bojHikeProb: BOJ_HIKE_PROB,
    bojQtProb: BOJ_QT_PROB,
    bojProbUpdated: BOJ_PROB_UPDATED,
    bojProbIsEnvOverride: !!(process.env.BOJ_HIKE_PROB),
    inflationDiff,
    riskLevel,
    fedIsLive,
    bojIsLive,
    usdJpyIsLive,
    dataQuality: (fedIsLive && bojIsLive && usdJpyIsLive) ? 'full' : (fedIsLive || usdJpyIsLive) ? 'partial' : 'fallback',
    bojScheduleLastUpdated: '2026-05-26', // 排程陣列最後人工確認日期
    nextBojMeeting: nextMeeting ? {
      name: nextMeeting.name,
      start: nextMeeting.start,   // "2026-06-15"
      end: nextMeeting.end,       // "2026-06-16"
      label: `${startParts[0]}年${Number(startParts[1])}月${Number(startParts[2])}日 ~ ${Number(endParts[2])}日`,
      shortLabel: `${Number(startParts[1])}月${Number(startParts[2])}日~${Number(endParts[2])}日舉行`,
      daysUntil: daysUntilMeeting,
    } : null,
    korea: {
      // T-0 即時前哨層
      tier1: {
        kospi: koreaTier1?.kospi ?? { value: null, changePercent: null, isLive: false },
        ewy: koreaTier1?.ewy ?? { price: null, changePercent: null, volume: null, volumeRatio: null, flowSignal: 'normal', isLive: false },
        samsung: koreaTier1?.samsung ?? { price: null, changePercent: null, isLive: false },
        skHynix: koreaTier1?.skHynix ?? { price: null, changePercent: null, isLive: false },
        semiAvgChange: koreaTier1?.semiAvgChange ?? null,
      },
      // T+1 籌碼與清算層（人工更新）
      tier2: {
        kofiaMargin: KR_KOFIA_MARGIN,          // 兆韓元
        marginCallRisk: KR_MARGIN_CALL_RISK,   // LOW/MODERATE/HIGH
        foreignNetFlow: KR_FOREIGN_NET_FLOW,   // 億韓元
        leveragedEtfSignal: KR_LEVERAGED_ETF_SIGNAL,
        isLive: false,
      },
      // T+10 基本面驗證層（人工更新）
      tier3: {
        dramSpotTrend: KR_DRAM_SPOT_TREND,
        exportSemi10Day: KR_EXPORT_SEMI_10D,   // %YoY
        isLive: false,
      },
      manualDataUpdated: KR_MANUAL_UPDATED,
      manualDataStaleness: computeStaleness(KR_MANUAL_UPDATED),
    },
    updatedAt: new Date().toISOString()
  };

  cache = { data: results, ts: Date.now() };
  res.json(results);
}
