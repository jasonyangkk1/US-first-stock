
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

// FRED API 設定（與 api/macro.ts 共用同一個 env key）
const FRED_API_KEY_SENT = process.env.FRED_API_KEY
  ? process.env.FRED_API_KEY.trim().replace(/^['"]|['"]$/g, '')
  : undefined;

async function fetchSkewFromFred(): Promise<{ value: number; change: number } | null> {
  if (!FRED_API_KEY_SENT) {
    console.warn('[sentiment] FRED_API_KEY not set, cannot fetch SKEW');
    return null;
  }
  try {
    // FRED series SKEW = CBOE SKEW Index，每日更新
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=SKEW&api_key=${FRED_API_KEY_SENT}&file_type=json&sort_order=desc&limit=3`;
    const res = await fetchWithTimeout(url, {}, 7000);
    if (!res.ok) throw new Error(`FRED SKEW HTTP ${res.status}`);
    const data: any = await res.json();
    const obs = (data?.observations ?? []).filter((o: any) => o.value !== '.');
    if (obs.length < 1) return null;
    const latest  = parseFloat(obs[0].value);
    const prev    = obs.length >= 2 ? parseFloat(obs[1].value) : latest;
    // 計算日變化（百分比）
    const changePct = prev !== 0 ? ((latest - prev) / prev) * 100 : 0;
    return {
      value:  parseFloat(latest.toFixed(2)),
      change: parseFloat(changePct.toFixed(2)),
    };
  } catch (e) {
    console.error('[sentiment] FRED SKEW fetch failed:', (e as Error).message);
    return null;
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
    const vixPromise  = yahooFinance.quote('^VIX').catch(() => null);
    const skewPromise = fetchSkewFromFred().catch(() => null);
    const cnnDataPromise = getCNNData();

    const [vixQuote, skewResult, cnnData] = await Promise.all([vixPromise, skewPromise, cnnDataPromise]);
    
    let fearAndGreed: any = cnnData;
    if (!fearAndGreed) {
      fearAndGreed = await calculateSyntheticSentiment();
    }

    const vixPrice  = (vixQuote as any)?.regularMarketPrice ?? 15;
    const vixChange = (vixQuote as any)?.regularMarketChangePercent ?? 0;
    const skewPrice = skewResult?.value ?? null;
    const skewChange = skewResult?.change ?? 0;

    res.json({
      vix: { 
        value: vixPrice, 
        change: vixChange 
      },
      skew: {
        value: skewPrice,
        change: skewChange,
        isLive: skewPrice !== null,
      },
      fearAndGreed: {
        ...fearAndGreed,
        updated: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[sentiment] Handler error:', error);
    res.json({ 
      vix: { value: 15, change: 0 }, 
      fearAndGreed: { value: 50, label: 'neutral', source: 'error', updated: new Date().toISOString() } 
    });
  }
}
