
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

// ── 台股融資靜態備援（TWSE 無直接提供整戶維持率 API，每週手動更新）──
const TW_MARGIN_FALLBACK = {
  maintenanceRatio: 153.2,       // 整戶融資維持率（%），每週手動更新
  maintenanceRatioIsLive: false, // 永遠為 false（TWSE 無直接 API）
  marginBalance: 1820.1,         // 融資餘額（億股）
  marginDailyChange: -12.0,      // 單日增減（億股）
  shortBalance: 320.5,           // 融券餘額（億股）
  marginShortRatio: 5.7,         // 融資/融券比（倍）
  date: '2026-07-14',
  isLive: false,
};

async function fetchTwseMarginData() {
  try {
    // TWSE OpenAPI v1：不需日期參數，直接回傳最新一日資料
    const url = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
    if (!res.ok) throw new Error(`TWSE OpenAPI HTTP ${res.status}`);

    const raw: any[] = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('TWSE 回傳空陣列（假日或盤後尚未公布）');
    }

    // 找合計列（StockNo 為空字串或 '合計'）
    const summary =
      raw.find((r: any) => !r.StockNo || r.StockNo === '合計') ??
      raw[raw.length - 1];

    const parseNum = (s: string | number) =>
      typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

    const marginToday = parseNum(summary.MarginPurchaseTodayBalance);    // 千股
    const marginYest  = parseNum(summary.MarginPurchaseYesterdayBalance); // 千股
    const shortToday  = parseNum(summary.ShortSaleTodayBalance);          // 千股

    const marginBalanceBil = parseFloat((marginToday / 100_000).toFixed(1)); // 億股
    const marginChangeBil  = parseFloat(((marginToday - marginYest) / 100_000).toFixed(1));
    const shortBalanceBil  = parseFloat((shortToday / 100_000).toFixed(1));
    const msRatio = shortToday > 0
      ? parseFloat((marginToday / shortToday).toFixed(1))
      : null;

    // 日期：民國年/月/日 → YYYY-MM-DD
    const dateRaw: string = summary.Date || '';
    const parts = dateRaw.split('/');
    const isoDate = parts.length === 3
      ? `${parseInt(parts[0]) + 1911}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
      : TW_MARGIN_FALLBACK.date;

    return {
      maintenanceRatio: TW_MARGIN_FALLBACK.maintenanceRatio, // 靜態備援
      maintenanceRatioIsLive: false,
      marginBalance: marginBalanceBil,
      marginDailyChange: marginChangeBil,
      shortBalance: shortBalanceBil,
      marginShortRatio: msRatio,
      date: isoDate,
      isLive: true,
    };
  } catch (e) {
    console.warn('[sentiment] TWSE margin fetch failed:', (e as Error).message);
    return null;
  }
}

async function fetchSkewFromYahoo(): Promise<{ value: number; change: number } | null> {
  try {
    const skewQuote = await yahooFinance.quote('^SKEW');
    if (!skewQuote) return null;
    const value = skewQuote.regularMarketPrice ?? 141.5;
    const change = skewQuote.regularMarketChangePercent ?? 0;
    return {
      value: parseFloat(value.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
    };
  } catch (e) {
    console.error('[sentiment] Yahoo Finance SKEW fetch failed, using fallback:', (e as Error).message);
    return { value: 141.5, change: 0 };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 5000) {
  let timeoutId: any = null;
  let signal: AbortSignal | undefined = undefined;

  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, { ...init, signal: signal ?? init?.signal });
    if (timeoutId) clearTimeout(timeoutId);
    return response;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
}

async function getCNNData() {
  try {
    const res = await fetchWithTimeout(CNN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://www.cnn.com/markets/fear-and-greed',
        'Accept': 'application/json'
      }
    }, 5000);
    
    if (res.ok) {
      const data: any = await res.json();
      if (data?.fear_and_greed?.score != null) {
        return {
          value: Math.round(data.fear_and_greed.score),
          label: data.fear_and_greed.rating,
          source: 'cnn'
        };
      }
    }
  } catch (e) {
    console.error('[sentiment] CNN API failed:', e);
  }
  return null;
}

async function calculateSyntheticSentiment() {
  try {
    const [vix, spy, spyChart] = await Promise.all([
      yahooFinance.quote('^VIX'),
      yahooFinance.quote('^GSPC'),
      yahooFinance.chart('^GSPC', { 
        period1: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), 
        interval: '1d' 
      })
    ]);

    let score = 50;
    
    // 1. VIX Contribution (0-20 points)
    // VIX < 12 (Very Greed) -> 20pts, VIX > 35 (Extreme Fear) -> 0pts
    const vixVal = (vix as any).regularMarketPrice || 15;
    const vixScore = Math.max(0, Math.min(20, (30 - vixVal) * 1.5 + 5));
    
    // 2. Momentum Contribution (0-40 points) - Price vs 125d MA
    const quotes = spyChart.quotes || [];
    const ma125 = quotes.slice(-125).reduce((acc: number, q: any) => acc + (q.close || 0), 0) / Math.min(quotes.length, 125);
    const price = spy.regularMarketPrice || ma125;
    const distFromMA = (price / ma125 - 1) * 100; // percent
    // dist > 5% -> Greed, dist < -5% -> Fear
    const momScore = Math.max(0, Math.min(40, (distFromMA + 5) * 4));

    // 3. Short term volatility/change (0-40 points)
    const pc = spy.regularMarketChangePercent || 0;
    const changeScore = Math.max(0, Math.min(40, (pc + 2) * 10));

    score = Math.round(vixScore + momScore + changeScore);
    score = Math.max(0, Math.min(100, score));
    
    let label = 'neutral';
    if (score >= 75) label = 'extreme greed';
    else if (score >= 60) label = 'greed';
    else if (score <= 25) label = 'extreme fear';
    else if (score <= 40) label = 'fear';

    return { value: score, label, source: 'synthetic' };
  } catch (e) {
    console.error('[sentiment] Synthetic calculation failed:', e);
    return { value: 50, label: 'neutral', source: 'default' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const vixPromise          = yahooFinance.quote('^VIX').catch(() => null);
    const skewPromise         = fetchSkewFromYahoo().catch(() => null);
    const cnnDataPromise      = getCNNData();
    const twMarginPromise     = fetchTwseMarginData().catch(() => null);

    const [vixQuote, skewResult, cnnData, twMarginResult] = await Promise.all([
      vixPromise, skewPromise, cnnDataPromise, twMarginPromise
    ]);
    
    let fearAndGreed: any = cnnData;
    if (!fearAndGreed) {
      fearAndGreed = await calculateSyntheticSentiment();
    }

    const vixPrice  = (vixQuote as any)?.regularMarketPrice ?? 15;
    const vixChange = (vixQuote as any)?.regularMarketChangePercent ?? 0;
    const skewPrice = skewResult?.value ?? 141.5;
    const skewChange = skewResult?.change ?? 0;

    res.json({
      vix: { 
        value: vixPrice, 
        change: vixChange 
      },
      skew: {
        value: skewPrice,
        change: skewChange,
        isLive: skewResult !== null && skewResult.value !== 141.5,
      },
      fearAndGreed: {
        ...fearAndGreed,
        updated: new Date().toISOString()
      },
      taiwanMargin: twMarginResult ?? TW_MARGIN_FALLBACK,
    });
  } catch (error) {
    console.error('[sentiment] Handler error:', error);
    res.json({ 
      vix: { value: 15, change: 0 }, 
      fearAndGreed: { value: 50, label: 'neutral', source: 'error', updated: new Date().toISOString() },
      taiwanMargin: TW_MARGIN_FALLBACK,
    });
  }
}
