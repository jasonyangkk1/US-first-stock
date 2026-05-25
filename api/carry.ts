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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try to return from cache
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  // Setup default values
  let fedRate = 5.33; // Default FED funds effective rate
  let fedRateRange = "5.25% - 5.50%";
  let bojRate = 0.75;
  let usdJpy = 144.2;
  let usdJpyWeeklyChange = 1.2;

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
      // Derive range dynamically. E.g., if fedRate is ~5.33%, range is "5.25% - 5.50%"
      if (fedRate >= 5.0 && fedRate <= 5.5) {
        fedRateRange = "5.25% - 5.50%";
      } else {
        const lower = Math.floor(fedRate * 4) / 4;
        const upper = lower + 0.25;
        fedRateRange = `${lower.toFixed(2)}% - ${upper.toFixed(2)}%`;
      }
    }

    if (bojFetch !== null) {
      bojRate = bojFetch;
    }

    inflationDiff = calculatedInflationDiff;
  }

  // 2. Fetch Yahoo Finance data for USD/JPY
  try {
    const usdJpyQuote = await yahooFinance.quote('JPY=X');
    if (usdJpyQuote && usdJpyQuote.regularMarketPrice) {
      usdJpy = usdJpyQuote.regularMarketPrice;
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
      usdJpyWeeklyChange = Number((usdJpyQuote.regularMarketChangePercent ?? 1.2).toFixed(2));
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
    updatedAt: new Date().toISOString()
  };

  cache = { data: results, ts: Date.now() };
  res.json(results);
}
