import type { VercelRequest, VercelResponse } from '@vercel/node';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 3600000; // 1 hour

// Helper to generate monthly dates from 13 months ago up to current date (2026-05)
function generateFallbackHistory(startVal: number, endVal: number, noiseFactor: number) {
  const history: Array<{ date: string; value: number }> = [];
  const startYear = 2025;
  const startMonth = 5; // May 2025
  const endYear = 2026;
  const endMonth = 5; // May 2026

  let currentYear = startYear;
  let currentMonth = startMonth;
  const steps = 13;

  for (let i = 0; i < steps; i++) {
    const ratio = i / (steps - 1);
    const trend = startVal + (endVal - startVal) * ratio;
    // Add deterministic noise based on month/index for consistency across refreshes
    const noise = Math.sin(i * 1.5) * noiseFactor;
    const value = Math.max(0, Number((trend + noise).toFixed(2)));
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    history.push({ date: dateStr, value });

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }
  return history;
}

// Fallback values in case FRED API key is missing or calls fail.
const fallbackData = {
  aiCapex: {
    hyOas: 310, // bps
    hyOasHistory: generateFallbackHistory(275, 305, 8),
    prevMonthAvg: 302,
    signal: 'yellow' as const,
    signalLabel: '利差擴大警戒',
    isLive: false,
  },
  geopolitical: {
    wtiPrice: 78.5,
    wtiWeeklyChangePct: 1.25,
    wtiHistory: generateFallbackHistory(72.0, 78.0, 3.5),
    importPriceYoY: 2.1,
    importPriceIsLive: false,
    signal: 'green' as const,
    signalLabel: '地緣震盪輕微',
    isLive: false,
  },
  nbfi: {
    finStressIndex: 0.15,
    finStressHistory: generateFallbackHistory(-0.25, 0.12, 0.08),
    creditCardDelinquency: 3.20,
    signal: 'yellow' as const,
    signalLabel: '影子槓桿上揚',
    isLive: false,
  },
  kEconomy: {
    creditCardDelinquency: 3.20,
    autoDelinquency: 2.40,
    consumerSentiment: 67.4,
    consumerSentimentHistory: generateFallbackHistory(71.2, 68.0, 1.8),
    signal: 'yellow' as const,
    signalLabel: '消費雙軌撕裂',
    isLive: false,
  },
  overallRisk: 'yellow' as const,
  updatedAt: new Date().toISOString(),
  dataSource: 'fallback' as const,
};

async function fetchFredSeries(seriesId: string, limit = 100): Promise<Array<{ date: string; value: number }> | null> {
  if (!FRED_API_KEY) return null;
  try {
    const start = new Date();
    start.setMonth(start.getMonth() - 14); // Fetch 14 months of data
    const startStr = start.toISOString().split('T')[0];
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${startStr}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    
    const obs = data.observations || [];
    const validObs = obs
      .filter((o: any) => o.value !== '.' && o.value !== undefined && o.value !== null)
      .map((o: any) => ({
        date: o.date as string,
        value: Number(o.value),
      }));

    if (validObs.length === 0) return null;
    return validObs;
  } catch (e) {
    console.error(`[structural] FRED fetch error for ${seriesId}:`, e);
    return null;
  }
}

// Convert daily/weekly series to monthly history (13 points)
function aggregateMonthly(obs: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const monthsMap = new Map<string, number>();
  for (const o of obs) {
    const monthKey = o.date.substring(0, 7); // e.g. "2025-05"
    monthsMap.set(monthKey, o.value); // keep latest value for each month
  }
  const result = Array.from(monthsMap.entries()).map(([date, value]) => ({ date, value }));
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result.slice(-13); // return last 13 months
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try cache
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  // If no FRED Key, return fallback immediately
  if (!FRED_API_KEY) {
    return res.json(fallbackData);
  }

  try {
    // Parallel fetch
    const [
      oasRaw,
      wtiRaw,
      stressRaw,
      ccDelinqRaw,
      autoDelinqRaw,
      sentimentRaw,
      importPriceRaw
    ] = await Promise.all([
      fetchFredSeries('BAMLH0A0HYM2'), // ICE BofA US High Yield OAS
      fetchFredSeries('DCOILWTICO'),   // WTI Price
      fetchFredSeries('STLFSI2'),      // St. Louis Fed Financial Stress Index (STLFSI2 replaces STLFSI4)
      fetchFredSeries('DRCCLACBS'),    // Credit Card Delinquency
      fetchFredSeries('DRCCLOBS'),     // Consumer Loans Delinquency (replaces DRSFRMACBS)
      fetchFredSeries('UMCSENT'),      // University of Michigan Consumer Sentiment
      fetchFredSeries('IR')            // U.S. Import Price Index
    ]);

    // Parse Card 1: AI Capex
    let aiCapex: any = fallbackData.aiCapex;
    if (oasRaw && oasRaw.length > 0) {
      const hyOas = oasRaw[oasRaw.length - 1].value; // Fix Bug 1: directly use the value, no multiplier
      const hyOasHistory = aggregateMonthly(oasRaw).map(o => ({ date: o.date, value: o.value }));
      const signal = hyOas < 300 ? 'green' : hyOas <= 500 ? 'yellow' : 'red';
      const signalLabel = signal === 'green' ? '信用利差正常' : signal === 'yellow' ? '利差擴大警戒' : '信用危險爆發';

      // Fix Bug 4: dynamically calculate previous month average
      const monthlyHistory = aggregateMonthly(oasRaw);
      const prevMonthAvg = monthlyHistory.length >= 2
        ? Number(monthlyHistory[monthlyHistory.length - 2].value.toFixed(0))
        : null;

      aiCapex = { hyOas, hyOasHistory, prevMonthAvg, signal, signalLabel, isLive: true };
    }

    // Parse Card 2: Geopolitical
    let geopolitical: any = fallbackData.geopolitical;
    if (wtiRaw && wtiRaw.length > 0) {
      const latestWti = wtiRaw[wtiRaw.length - 1].value;
      const wtiHistory = aggregateMonthly(wtiRaw);
      
      // Calculate weekly change (approx 7 days ago)
      let wtiWeeklyChangePct = 0;
      if (wtiRaw.length >= 6) {
        const prevWti = wtiRaw[wtiRaw.length - 6].value;
        if (prevWti > 0) {
          wtiWeeklyChangePct = ((latestWti - prevWti) / prevWti) * 100;
        }
      }
      
      const absWeeklyChange = Math.abs(wtiWeeklyChangePct);
      const signal = (absWeeklyChange > 7 || latestWti > 90) ? 'red' : (absWeeklyChange >= 3 || latestWti >= 82) ? 'yellow' : 'green';
      const signalLabel = signal === 'green' ? '油價與通膨穩定' : signal === 'yellow' ? '地緣溢價波動' : '地緣衝突斷鏈';

      // Fix Bug 3 & 7: Dynamically calculate Import Price Index YoY % if available
      let importPriceYoY = 2.1;
      let importPriceIsLive = false;
      if (importPriceRaw && importPriceRaw.length >= 13) {
        const latest = importPriceRaw[importPriceRaw.length - 1].value;
        const yearAgo = importPriceRaw[importPriceRaw.length - 13].value;
        if (yearAgo > 0) {
          importPriceYoY = Number(((latest - yearAgo) / yearAgo * 100).toFixed(1));
          importPriceIsLive = true;
        }
      }

      geopolitical = { wtiPrice: latestWti, wtiWeeklyChangePct, wtiHistory, importPriceYoY, importPriceIsLive, signal, signalLabel, isLive: true };
    }

    // Parse Card 3: NBFI
    let nbfi: any = fallbackData.nbfi;
    if (stressRaw && stressRaw.length > 0) {
      const finStressIndex = stressRaw[stressRaw.length - 1].value;
      const finStressHistory = aggregateMonthly(stressRaw);
      const creditCardDelinquency = ccDelinqRaw && ccDelinqRaw.length > 0 ? ccDelinqRaw[ccDelinqRaw.length - 1].value : 3.20;
      
      const signal = finStressIndex > 1.0 ? 'red' : finStressIndex >= 0 ? 'yellow' : 'green';
      const signalLabel = signal === 'green' ? '流動性充沛' : signal === 'yellow' ? '影子融資壓力' : '信用流動性乾涸';
      nbfi = { finStressIndex, finStressHistory, creditCardDelinquency, signal, signalLabel, isLive: true };
    }

    // Parse Card 4: K-Economy
    let kEconomy: any = fallbackData.kEconomy;
    if (sentimentRaw && sentimentRaw.length > 0) {
      const creditCardDelinquency = ccDelinqRaw && ccDelinqRaw.length > 0 ? ccDelinqRaw[ccDelinqRaw.length - 1].value : 3.20;
      const autoDelinquency = autoDelinqRaw && autoDelinqRaw.length > 0 ? autoDelinqRaw[autoDelinqRaw.length - 1].value : 2.40; // Proxy of consumer loan delinquency via DRCCLOBS
      const consumerSentiment = sentimentRaw[sentimentRaw.length - 1].value;
      const consumerSentimentHistory = aggregateMonthly(sentimentRaw);
      
      const signal = creditCardDelinquency > 3.5 ? 'red' : creditCardDelinquency >= 2.5 ? 'yellow' : 'green';
      const signalLabel = signal === 'green' ? '消費基本面健全' : signal === 'yellow' ? 'K型中下階層透支' : '逾期率飆，消費斷崖';
      kEconomy = { creditCardDelinquency, autoDelinquency, consumerSentiment, consumerSentimentHistory, signal, signalLabel, isLive: true };
    }

    // Determine overallRisk (most severe)
    const signals = [aiCapex.signal, geopolitical.signal, nbfi.signal, kEconomy.signal];
    const overallRisk = signals.includes('red') ? 'red' : signals.includes('yellow') ? 'yellow' : 'green';

    const liveData = {
      aiCapex,
      geopolitical,
      nbfi,
      kEconomy,
      overallRisk,
      updatedAt: new Date().toISOString(),
      dataSource: 'fred' as const,
    };

    cache = { data: liveData, ts: Date.now() };
    return res.json(liveData);

  } catch (error) {
    console.error('[structural] Failed to assemble live FRED data:', error);
    return res.json(fallbackData);
  }
}
