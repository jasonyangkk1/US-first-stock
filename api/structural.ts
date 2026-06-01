import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

let cache: { data: any; ts: number; ttl: number } | null = null;
const CACHE_TTL_SUCCESS = 4 * 60 * 60 * 1000;  // 4 hours (FCF is stable)
const CACHE_TTL_PARTIAL = 30 * 60 * 1000;       // 30 minutes (OAS ok but FCF failed)
const CACHE_TTL_FAIL    = 5 * 60 * 1000;        // 5 minutes (totally failed, quick retry)

const HYPERSCALERS = [
  { symbol: 'MSFT', name: '微軟' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: '亞馬遜' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'ORCL', name: 'Oracle' },
  { symbol: 'AAPL', name: 'Apple' },
];

interface HyperscalerFCFData {
  symbol: string;
  name: string;
  fcfYield: number | null;       // FCF / 市值 (%)
  capexRatio: number | null;     // Capex / 營業現金流 (%)
  fcfGrowthYoY: number | null;   // FCF YoY 成長率 (%)
  fcfMargin: number | null;      // FCF / 營收 (%)
  fcfTTM: number | null;         // 近12個月自由現金流（億美元）
  capexTTM: number | null;       // 近12個月資本支出（億美元）
  marketCap: number | null;      // 市值（億美元）
  signal: 'green' | 'yellow' | 'red';
}

function getFloatValue(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && 'raw' in val) return typeof val.raw === 'number' ? val.raw : null;
  return null;
}

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

const fallbackFcf = {
  stocks: HYPERSCALERS.map(h => ({
    symbol: h.symbol,
    name: h.name,
    fcfYield: null,
    capexRatio: null,
    fcfGrowthYoY: null,
    fcfMargin: null,
    fcfTTM: null,
    capexTTM: null,
    marketCap: null,
    signal: 'yellow' as const,
  })),
  compositeSignal: 'yellow' as const,
  avgFcfYield: null,
  avgCapexRatio: null,
  redCount: 0,
  yellowCount: 5,
  isLive: false,
};

// Fallback values in case FRED API key is missing or calls fail.
const fallbackData = {
  aiCapex: {
    hyOas: 310, // bps
    hyOasHistory: generateFallbackHistory(275, 305, 8),
    prevMonthAvg: 302,
    signal: 'yellow' as const,
    signalLabel: '利差擴大警戒',
    isLive: false,
    fcf: fallbackFcf,
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

function nullStock(symbol: string, name: string): HyperscalerFCFData {
  return {
    symbol, name,
    fcfYield: null, capexRatio: null, fcfGrowthYoY: null, fcfMargin: null,
    fcfTTM: null, capexTTM: null, marketCap: null,
    signal: 'yellow' as const,
  };
}

function getFallbackFCF(reason: string) {
  console.warn(`[structural] FCF fallback due to: ${reason}`);
  return {
    stocks: HYPERSCALERS.map(h => nullStock(h.symbol, h.name)),
    compositeSignal: 'yellow' as const,
    avgFcfYield: null,
    avgCapexRatio: null,
    redCount: 0,
    yellowCount: 3,
    isLive: false,
  };
}

async function fetchHyperscalerFCF(): Promise<{
  stocks: HyperscalerFCFData[];
  compositeSignal: 'green' | 'yellow' | 'red';
  avgFcfYield: number | null;
  avgCapexRatio: number | null;
  redCount: number;
  yellowCount: number;
  isLive: boolean;
}> {
  try {
    const results = await Promise.all(
      HYPERSCALERS.map(async ({ symbol, name }) => {
        try {
          let summary: any = null;
          try {
            summary = await yahooFinance.quoteSummary(symbol, {
              modules: ['financialData', 'defaultKeyStatistics']
            }, {
              validateResult: false
            } as any);
          } catch (err: any) {
            if (err?.result) {
              summary = err.result;
              console.warn(`[structural] ${symbol} quoteSummary schema error, using partial result`);
            } else {
              console.error(`[structural] ${symbol} quoteSummary failed:`, err?.message?.substring(0, 100));
              return nullStock(symbol, name);
            }
          }

          if (!summary) return nullStock(symbol, name);

          const fd = summary.financialData;
          const ks = summary.defaultKeyStatistics;

          console.log(`[structural] ${symbol} raw:`, {
            freeCashflow: fd?.freeCashflow,
            operatingCashflow: fd?.operatingCashflow,
            totalRevenue: fd?.totalRevenue,
            marketCap: ks?.marketCap,
          });

          const fcfTTM = getFloatValue(fd?.freeCashflow);
          const operatingCashflow = getFloatValue(fd?.operatingCashflow);
          const revenueTTM = getFloatValue(fd?.totalRevenue);
          const marketCapRaw = getFloatValue(ks?.marketCap);

          // Capex TTM = OCF - FCF
          let capexTTM: number | null = null;
          if (operatingCashflow !== null && fcfTTM !== null) {
            capexTTM = operatingCashflow - fcfTTM;
            if (capexTTM < 0) capexTTM = null;
          }

          const fcfGrowthYoY: number | null = null;

          const fcfYield = (fcfTTM !== null && marketCapRaw !== null && marketCapRaw > 0)
            ? (fcfTTM / marketCapRaw) * 100
            : null;

          const capexRatio = (capexTTM !== null && operatingCashflow !== null && operatingCashflow > 0)
            ? (capexTTM / operatingCashflow) * 100
            : null;

          const fcfMargin = (fcfTTM !== null && revenueTTM !== null && revenueTTM > 0)
            ? (fcfTTM / revenueTTM) * 100
            : null;

          // 燈號判斷
          let redFlags = 0;
          let yellowFlags = 0;

          if (fcfYield !== null) {
            if (fcfYield < 1.5) redFlags++;
            else if (fcfYield < 3.5) yellowFlags++;
          }
          if (capexRatio !== null) {
            if (capexRatio > 65) redFlags++;
            else if (capexRatio > 40) yellowFlags++;
          }
          if (fcfMargin !== null) {
            if (fcfMargin < 10) redFlags++;
            else if (fcfMargin < 20) yellowFlags++;
          }

          const hasData = fcfYield !== null || capexRatio !== null;
          const signal: 'green' | 'yellow' | 'red' = !hasData ? 'yellow' :
            redFlags >= 2 ? 'red' :
            redFlags >= 1 || yellowFlags >= 2 ? 'yellow' :
            'green';

          return {
            symbol,
            name,
            fcfYield: fcfYield !== null ? Number(fcfYield.toFixed(2)) : null,
            capexRatio: capexRatio !== null ? Number(capexRatio.toFixed(1)) : null,
            fcfGrowthYoY,
            fcfMargin: fcfMargin !== null ? Number(fcfMargin.toFixed(1)) : null,
            fcfTTM: fcfTTM !== null ? Number((fcfTTM / 1e9).toFixed(1)) : null,
            capexTTM: capexTTM !== null ? Number((capexTTM / 1e9).toFixed(1)) : null,
            marketCap: marketCapRaw !== null ? Number((marketCapRaw / 1e9).toFixed(0)) : null,
            signal,
          } as HyperscalerFCFData;

        } catch (err) {
          console.error(`[structural] FCF fetch error for ${symbol}:`, err);
          return nullStock(symbol, name);
        }
      })
    );

    const validStocks = results.filter(s => s.fcfYield !== null);
    const avgFcfYield = validStocks.length > 0
      ? Number((validStocks.reduce((sum, r) => sum + (r.fcfYield ?? 0), 0) / validStocks.length).toFixed(2))
      : null;
    const avgCapexRatio = results.filter(s => s.capexRatio !== null).length > 0
      ? Number((results.filter(s => s.capexRatio !== null).reduce((sum, r) => sum + (r.capexRatio ?? 0), 0) / results.filter(s => s.capexRatio !== null).length).toFixed(1))
      : null;
    const redCount = results.filter(r => r.signal === 'red').length;
    const yellowCount = results.filter(r => r.signal === 'yellow').length;

    const compositeSignal: 'green' | 'yellow' | 'red' =
      redCount >= 2 ? 'red' :
      redCount >= 1 || yellowCount >= 3 ? 'yellow' :
      'green';

    console.log('[structural] Hyperscaler FCF results:', {
      success: validStocks.length,
      total: HYPERSCALERS.length,
      redCount,
      yellowCount
    });

    return {
      stocks: results,
      compositeSignal,
      avgFcfYield,
      avgCapexRatio,
      redCount,
      yellowCount,
      isLive: validStocks.length > 0,
    };

  } catch (err) {
    console.error('[structural] fetchHyperscalerFCF error:', err);
    return getFallbackFCF('outer-error');
  }
}

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

  // GET /api/structural?debug=1 → 回傳診斷資訊，不受 cache 影響
  if (req.query?.debug === '1') {
    const testSymbol = 'MSFT';
    let debugInfo: any = { symbol: testSymbol, timestamp: new Date().toISOString() };
    try {
      const testSummary = await yahooFinance.quoteSummary(testSymbol, {
        modules: ['financialData', 'defaultKeyStatistics']
      }, {
        validateResult: false
      } as any);
      debugInfo.quoteSummarySuccess = true;
      debugInfo.freeCashflow = testSummary.financialData?.freeCashflow;
      debugInfo.operatingCashflow = testSummary.financialData?.operatingCashflow;
      debugInfo.marketCap = testSummary.defaultKeyStatistics?.marketCap;
    } catch (e: any) {
      debugInfo.quoteSummarySuccess = false;
      debugInfo.error = e.message?.substring(0, 200);
      debugInfo.hasResult = !!e.result;
      if (e.result) {
        debugInfo.resultKeys = Object.keys(e.result);
        debugInfo.freeCashflow = e.result.financialData?.freeCashflow;
      }
    }
    return res.json(debugInfo);
  }

  // Try cache with dynamic TTL
  if (cache && Date.now() - cache.ts < (cache.ttl ?? CACHE_TTL_SUCCESS)) {
    return res.json(cache.data);
  }

  // If no FRED Key, try to at least return fallbackData enriched with live Yahoo Finance FCF data
  if (!FRED_API_KEY) {
    try {
      const fcfData = await fetchHyperscalerFCF();
      const oasSignal = fallbackData.aiCapex.signal;
      const compositeSignal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                              [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
      const signalLabel = compositeSignal === 'green' ? '信用利差與巨頭造血健全' : compositeSignal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';
      
      const copyFallback = JSON.parse(JSON.stringify(fallbackData));
      copyFallback.aiCapex.fcf = fcfData;
      copyFallback.aiCapex.signal = compositeSignal;
      copyFallback.aiCapex.signalLabel = signalLabel;
      copyFallback.updatedAt = new Date().toISOString();
      copyFallback.dataSource = 'mix' as any;

      const fcfSuccess = fcfData.isLive && fcfData.stocks.some(s => s.fcfYield !== null);
      const ttl = fcfSuccess ? CACHE_TTL_SUCCESS : CACHE_TTL_FAIL;
      cache = { data: copyFallback, ts: Date.now(), ttl };

      return res.json(copyFallback);
    } catch (err) {
      console.error('[structural] Failed FCF fetch in no FRED Key fallback:', err);
      return res.json(fallbackData);
    }
  }

  try {
    // 階段 1：FRED 數據（快，約 1-2 秒）
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
      fetchFredSeries('IR'),           // U.S. Import Price Index
    ]);

    // 階段 2：Yahoo Finance FCF（獨立執行，不受 FRED timeout 影響）
    // 給 FCF 獨立的 8 秒 deadline
    const fcfData = await Promise.race([
      fetchHyperscalerFCF(),
      new Promise<ReturnType<typeof getFallbackFCF>>(resolve =>
        setTimeout(() => resolve(getFallbackFCF('timeout')), 8000)
      )
    ]);

    // Parse Card 1: AI Capex
    let aiCapex: any = fallbackData.aiCapex;
    if (oasRaw && oasRaw.length > 0) {
      const hyOas = oasRaw[oasRaw.length - 1].value;
      const hyOasHistory = aggregateMonthly(oasRaw).map(o => ({ date: o.date, value: o.value }));
      const oasSignal = hyOas < 300 ? 'green' : hyOas <= 500 ? 'yellow' : 'red';
      const signal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                     [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
      const signalLabel = signal === 'green' ? '信用利差與巨頭造血健全' : signal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';

      // Dynamically calculate previous month average
      const monthlyHistory = aggregateMonthly(oasRaw);
      const prevMonthAvg = monthlyHistory.length >= 2
        ? Number(monthlyHistory[monthlyHistory.length - 2].value.toFixed(0))
        : null;

      aiCapex = { hyOas, hyOasHistory, prevMonthAvg, signal, signalLabel, isLive: true, fcf: fcfData };
    } else {
      const oasSignal = fallbackData.aiCapex.signal;
      const signal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                     [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
      const signalLabel = signal === 'green' ? '信用利差與巨頭造血健全' : signal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';
      aiCapex = {
        ...fallbackData.aiCapex,
        signal,
        signalLabel,
        isLive: true,
        fcf: fcfData
      };
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

    const fcfSuccess = fcfData.isLive && fcfData.stocks.some(s => s.fcfYield !== null);
    const fredSuccess = !!(oasRaw && oasRaw.length > 0);

    const ttl = fcfSuccess && fredSuccess ? CACHE_TTL_SUCCESS :
                fredSuccess ? CACHE_TTL_PARTIAL :
                CACHE_TTL_FAIL;

    cache = { data: liveData, ts: Date.now(), ttl };
    return res.json(liveData);

  } catch (error) {
    console.error('[structural] Failed to assemble live FRED data:', error);
    return res.json(fallbackData);
  }
}
