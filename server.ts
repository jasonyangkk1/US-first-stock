import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cache = new NodeCache({ stdTTL: 600 }); // 10 minute cache

async function startServer() {
  console.log("=== DIAGNOSTIC START ===");
  console.log("Node version:", process.version);
  console.log("AbortSignal exists:", typeof AbortSignal !== 'undefined');
  if (typeof AbortSignal !== 'undefined') {
    console.log("AbortSignal.timeout exists:", typeof (AbortSignal as any).timeout !== 'undefined');
  }
  console.log("FRED_API_KEY set:", !!process.env.FRED_API_KEY);
  if (process.env.FRED_API_KEY) {
    console.log("FRED_API_KEY length:", process.env.FRED_API_KEY.length);
  }
  console.log("=== DIAGNOSTIC END ===");

  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json());

  // API Routes
  
  // Helper to standardize dates from Yahoo Finance
  const formatYFDate = (d: any) => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString();
    if (typeof d === 'number') {
      // Logic: If > 10^12, it's milliseconds; otherwise, it's seconds
      const isMs = d > 100000000000; 
      return new Date(isMs ? d : d * 1000).toISOString();
    }
    // If it's already a string, ensure it's ISO or just return it
    try {
      const parsed = new Date(d);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    } catch { /* ignore */ }
    return String(d);
  };

  // 1. Earnings Tracker for Mag 7
  app.get('/api/earnings', async (req, res) => {
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA'];
    const cacheKey = 'mag7_earnings_v2';
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const isValidFutureDate = (dateStr: string | null): boolean => {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      const now = new Date();
      return date.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
    };

    try {
      const results = await Promise.all(symbols.map(async (symbol) => {
        try {
          const quote: any = await yahooFinance.quoteSummary(symbol, { 
            modules: ['calendarEvents', 'price', 'earnings', 'financialData', 'defaultKeyStatistics'] 
          });
          
          const quarterlyEarnings = quote.earnings?.earningsChart?.quarterly || [];
          const quarterlyFinancials = quote.earnings?.financialsChart?.quarterly || [];
          
          const lastEarnings = quarterlyEarnings[quarterlyEarnings.length - 1] || null;
          const lastFinancials = quarterlyFinancials[quarterlyFinancials.length - 1] || null;
          
          const prevEarnings = quarterlyEarnings[quarterlyEarnings.length - 2] || null;
          const prevFinancials = quarterlyFinancials[quarterlyFinancials.length - 2] || null;

          const rawEarningsDate = quote.calendarEvents?.earnings?.earningsDate?.[0];
          const formattedDate = formatYFDate(rawEarningsDate);

          let earningsDate = formattedDate;
          if (!isValidFutureDate(earningsDate)) {
            const altDate = quote.calendarEvents?.earnings?.earningsDate?.[1];
            const altFormatted = altDate ? formatYFDate(altDate) : null;
            if (altFormatted && isValidFutureDate(altFormatted)) {
              earningsDate = altFormatted;
            } else {
              earningsDate = null;
            }
          }
          const earningsDateStatus = earningsDate ? 'confirmed' : 'unknown';

          return {
            symbol,
            name: quote.price?.shortName || symbol,
            earningsDate,
            earningsDateStatus,
            exDividendDate: formatYFDate(quote.calendarEvents?.exDividendDate),
            summary: {
              epsEstimate: quote.calendarEvents?.earnings?.earningsAverage || null,
              revenueEstimate: quote.calendarEvents?.earnings?.revenueAverage || null,
              epsActual: lastEarnings?.actual || null,
              revenueActual: lastFinancials?.revenue || null,
              lastQuarterLabel: lastEarnings?.date || null,
              lastEpsEstimate: lastEarnings?.estimate !== undefined && lastEarnings?.estimate !== null ? lastEarnings.estimate : null,
              epsBeatMiss: lastEarnings?.actual != null && lastEarnings?.estimate != null
                ? parseFloat((lastEarnings.actual - lastEarnings.estimate).toFixed(2))
                : null,
              epsBeatMissPct: lastEarnings?.actual != null && lastEarnings?.estimate != null && lastEarnings.estimate !== 0
                ? parseFloat(((lastEarnings.actual - lastEarnings.estimate) / Math.abs(lastEarnings.estimate) * 100).toFixed(1))
                : null,
              prevEpsActual: prevEarnings?.actual || null,
              prevRevenueActual: prevFinancials?.revenue || null,
              margin: quote.financialData?.profitMargins || null,
              growth: quote.financialData?.revenueGrowth || null,
              epsTTM: quote.defaultKeyStatistics?.trailingEps || null,
            }
          };
        } catch (e) {
          console.warn(`Failed to fetch ${symbol}:`, e);
          return { symbol, name: symbol, earningsDate: null, earningsDateStatus: 'unknown', exDividendDate: null, summary: null };
        }
      }));
      
      cache.set(cacheKey, results);
      res.json(results);
    } catch (error) {
      console.error('Earnings Fetch Error:', error);
      res.json([]); 
    }
  });

  // 1b. Single Stock Earnings Search
  app.get('/api/earnings/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const cacheKey = `earnings_v2_${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      const quote: any = await yahooFinance.quoteSummary(symbol, { 
        modules: ['calendarEvents', 'price', 'earnings', 'financialData', 'defaultKeyStatistics'] 
      });
      
      const quarterlyEarnings = quote.earnings?.earningsChart?.quarterly || [];
      const quarterlyFinancials = quote.earnings?.financialsChart?.quarterly || [];
      
      const lastEarnings = quarterlyEarnings[quarterlyEarnings.length - 1] || null;
      const lastFinancials = quarterlyFinancials[quarterlyFinancials.length - 1] || null;
      
      const prevEarnings = quarterlyEarnings[quarterlyEarnings.length - 2] || null;
      const prevFinancials = quarterlyFinancials[quarterlyFinancials.length - 2] || null;

      const rawEarningsDate = quote.calendarEvents?.earnings?.earningsDate?.[0];
      const formattedDate = formatYFDate(rawEarningsDate);

      const isValidFutureDate = (dateStr: string | null): boolean => {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        const now = new Date();
        return date.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
      };

      let earningsDate = formattedDate;
      if (!isValidFutureDate(earningsDate)) {
        const altDate = quote.calendarEvents?.earnings?.earningsDate?.[1];
        const altFormatted = altDate ? formatYFDate(altDate) : null;
        if (altFormatted && isValidFutureDate(altFormatted)) {
          earningsDate = altFormatted;
        } else {
          earningsDate = null;
        }
      }
      const earningsDateStatus = earningsDate ? 'confirmed' : 'unknown';

      const result = {
        symbol: symbol.toUpperCase(),
        name: quote.price?.shortName || symbol.toUpperCase(),
        earningsDate,
        earningsDateStatus,
        exDividendDate: formatYFDate(quote.calendarEvents?.exDividendDate),
        summary: {
          epsEstimate: quote.calendarEvents?.earnings?.earningsAverage || null,
          revenueEstimate: quote.calendarEvents?.earnings?.revenueAverage || null,
          epsActual: lastEarnings?.actual || null,
          revenueActual: lastFinancials?.revenue || null,
          lastQuarterLabel: lastEarnings?.date || null,
          lastEpsEstimate: lastEarnings?.estimate !== undefined && lastEarnings?.estimate !== null ? lastEarnings.estimate : null,
          epsBeatMiss: lastEarnings?.actual != null && lastEarnings?.estimate != null
            ? parseFloat((lastEarnings.actual - lastEarnings.estimate).toFixed(2))
            : null,
          epsBeatMissPct: lastEarnings?.actual != null && lastEarnings?.estimate != null && lastEarnings.estimate !== 0
            ? parseFloat(((lastEarnings.actual - lastEarnings.estimate) / Math.abs(lastEarnings.estimate) * 100).toFixed(1))
            : null,
          prevEpsActual: prevEarnings?.actual || null,
          prevRevenueActual: prevFinancials?.revenue || null,
          margin: quote.financialData?.profitMargins || null,
          growth: quote.financialData?.revenueGrowth || null,
          epsTTM: quote.defaultKeyStatistics?.trailingEps || null,
        }
      };
      cache.set(cacheKey, result, 3600);
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: 'Symbol not found' });
    }
  });

  // 2. Stock Trend & MAs
  app.get('/api/stock/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const cacheKey = `stock_${symbol}`;
    
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      // Fetch 1 year of data for MA calculations
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - 1);

      const queryOptions = { period1: start, period2: end, interval: '1d' as any };
      const history: any = await yahooFinance.chart(symbol, queryOptions);
      const quotes = history.quotes || [];

      if (!quotes || quotes.length === 0) {
        return res.json({ symbol, currentPrice: 0, data: [] });
      }

      // Calculate 50MA and 200MA
      const data = quotes.map((q: any, i: number) => {
        const slice50 = quotes.slice(Math.max(0, i - 49), i + 1);
        const slice200 = quotes.slice(Math.max(0, i - 199), i + 1);
        
        const ma50 = slice50.length >= 50 
          ? slice50.reduce((acc: number, curr: any) => acc + (curr.close || 0), 0) / slice50.length 
          : null;
        const ma200 = slice200.length >= 200 
          ? slice200.reduce((acc: number, curr: any) => acc + (curr.close || 0), 0) / slice200.length 
          : null;

        return {
          date: q.date,
          close: q.close,
          ma50,
          ma200
        };
      });

      // Find the most recent valid close price
      const lastQuoteWithClose = [...quotes].reverse().find((q: any) => q.close != null);
      
      const result = {
        symbol,
        currentPrice: lastQuoteWithClose?.close ?? 0,
        data: data.slice(-250) 
      };

      cache.set(cacheKey, result);
      res.json(result);
    } catch (error) {
      console.error('Stock Data Error:', error);
      res.json({ symbol, currentPrice: 0, data: [] });
    }
  });

  // 3. Sentiment: VIX and CNN Fear & Greed
  app.get('/api/quote/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const quote: any = await yahooFinance.quote(symbol);
      res.json({
        symbol: symbol.toUpperCase(),
        currentPrice: quote.regularMarketPrice ?? 0,
        change: quote.regularMarketChange ?? 0,
        changePercent: quote.regularMarketChangePercent ?? 0,
      });
    } catch (e) {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // 3. Sentiment: VIX and CNN Fear & Greed
  async function fetchSkewFromYahooServer(): Promise<{ value: number; change: number } | null> {
    try {
      const skewQuote = await yahooFinance.quote('^SKEW');
      if (!skewQuote) return null;
      const value = skewQuote.regularMarketPrice ?? 141.5;
      const change = skewQuote.regularMarketChangePercent ?? 0;
      return {
        value: parseFloat(value.toFixed(2)),
        change: parseFloat(change.toFixed(2)),
      };
    } catch (e: any) {
      console.error('[sentiment server] Yahoo Finance SKEW fetch failed, using fallback:', e.message);
      return { value: 141.5, change: 0 };
    }
  }

  // ── 台股融資靜態備援（TWSE 無直接提供整戶維持率 API，每週手動更新）──
  const FALLBACK_MAINTENANCE_RATIO = 153.2; // %
  const FALLBACK_DATE = '2026-07-14';

  const TWM_FALLBACK = {
    maintenanceRatio: FALLBACK_MAINTENANCE_RATIO,
    maintenanceRatioIsLive: false,         // 維持率永遠來自靜態備援
    marginBalance: 1820.1,                 // 億元
    marginDailyChange: -12.0,              // 億元（正=增加，負=減少）
    shortBalance: 320.5,                   // 融券餘額（億元）
    marginShortRatio: 5.7,                 // 融資/融券比（倍）
    date: FALLBACK_DATE,
    isLive: false,
  };

  async function fetchTwseMarginDataServer(): Promise<any> {
    const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
      let timeoutId: any = null;
      let signal: AbortSignal | undefined = undefined;
      if (typeof AbortController !== 'undefined') {
        const controller = new AbortController();
        signal = controller.signal;
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      }
      try {
        const response = await fetch(url, { signal, headers: { 'Accept': 'application/json' } });
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    };

    try {
      const url = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
      const response = await fetchWithTimeout(url, 8000);
      if (!response.ok) throw new Error(`TWSE OpenAPI HTTP ${response.status}`);

      const raw: any[] = await response.json();
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('TWSE OpenAPI 回傳空陣列');
      }

      const summary = raw.find((r: any) =>
        r.StockNo === '' || r.StockNo === '合計' || !r.StockNo
      ) ?? raw[raw.length - 1];

      const parseNum = (s: string | number) =>
        typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

      const marginToday = parseNum(summary.MarginPurchaseTodayBalance);
      const marginYest  = parseNum(summary.MarginPurchaseYesterdayBalance);
      const marginDiff  = marginToday - marginYest;
      const shortToday  = parseNum(summary.ShortSaleTodayBalance);

      const marginBalanceBil = parseFloat((marginToday / 100_000).toFixed(1));
      const marginChangeBil  = parseFloat((marginDiff  / 100_000).toFixed(1));
      const shortBalanceBil  = parseFloat((shortToday  / 100_000).toFixed(1));

      const msRatio = shortToday > 0
        ? parseFloat((marginToday / shortToday).toFixed(1))
        : null;

      const dateRaw: string = summary.Date || '';
      let isoDate = FALLBACK_DATE;
      const parts = dateRaw.split('/');
      if (parts.length === 3) {
        const rocYear = parseInt(parts[0]);
        isoDate = `${rocYear + 1911}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      }

      return {
        maintenanceRatio: FALLBACK_MAINTENANCE_RATIO,
        maintenanceRatioIsLive: false,
        marginBalance: marginBalanceBil,
        marginDailyChange: marginChangeBil,
        shortBalance: shortBalanceBil,
        marginShortRatio: msRatio,
        date: isoDate,
        isLive: true,
      };
    } catch (e: any) {
      console.warn('[taiwan-margin server] TWSE fetch failed:', e.message);
      return TWM_FALLBACK;
    }
  }

  app.get('/api/sentiment', async (req, res) => {
    const cacheKey = 'market_sentiment';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
      // 1. Fetch CNN Fear & Greed Index from the discovered dataviz API
      let fearAndGreed = {
        value: 50,
        rating: 'neutral',
        previousClose: 50,
        updated: new Date().toISOString()
      };
      
      try {
        const cnnRes = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.cnn.com/markets/fear-and-greed'
          }
        });
        
        if (cnnRes.ok) {
          const cnnData: any = await cnnRes.json();
          if (cnnData && cnnData.fear_and_greed) {
            fearAndGreed = {
              value: Math.round(cnnData.fear_and_greed.score),
              rating: cnnData.fear_and_greed.rating,
              previousClose: Math.round(cnnData.fear_and_greed.previous_close || 0),
              updated: cnnData.fear_and_greed.timestamp || new Date().toISOString()
            };
          }
        }
      } catch (cnnErr) {
        console.error('CNN Fetch Error (falling back to proxy):', cnnErr);
        // We'll proceed with default or previous proxy logic if needed, 
        // but let's prioritize the real data.
      }

      // 2. Fetch VIX, SKEW, and Taiwan Margin parallelly
      const [vixQuote, skewResult, twMarginResult]: any = await Promise.all([
        yahooFinance.quote('^VIX').catch(() => null),
        fetchSkewFromYahooServer().catch(() => null),
        fetchTwseMarginDataServer().catch(() => null)
      ]);
      
      const currentVix = vixQuote?.regularMarketPrice ?? 15;
      const currentSkew = skewResult?.value ?? 141.5;
      
      const resSentiment = {
        vix: {
          value: currentVix,
          change: vixQuote?.regularMarketChangePercent ?? 0,
        },
        skew: {
          value: currentSkew,
          change: skewResult?.change ?? 0,
          isLive: skewResult !== null && skewResult.value !== 141.5,
        },
        fearAndGreed: {
          value: fearAndGreed.value,
          label: fearAndGreed.rating, // for frontend label field
          updated: fearAndGreed.updated
        },
        taiwanMargin: twMarginResult ?? TWM_FALLBACK,
      };

      cache.set(cacheKey, resSentiment, 1800); // Cache for 30 mins
      res.json(resSentiment);
    } catch (error) {
      console.error('Sentiment Error:', error);
      res.json({ 
        vix: { value: 15, change: 0 },
        fearAndGreed: { value: 50, label: 'neutral', updated: new Date().toISOString() },
        taiwanMargin: TWM_FALLBACK,
      });
    }
  });

  // 4. Macro Indicators (NFP, ADP, CPI, PPI, Core PPI)
  app.get('/api/macro', async (req, res) => {
    const cacheKey = 'macro_indicators';
    
    // If debug=1, bypass cache!
    if (req.query?.debug !== '1') {
      const cached = cache.get(cacheKey);
      if (cached) return res.json(cached);
    }

    const FRED_API_KEY = process.env.FRED_API_KEY ? process.env.FRED_API_KEY.trim().replace(/^['"]|['"]$/g, '') : undefined;
    const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

    if (!FRED_API_KEY) {
      return res.json({ 
        error: 'FRED_API_KEY not configured',
        instruction: 'Please set FRED_API_KEY in your environment variables.'
      });
    }

    const SERIES = {
      NFP: 'PAYEMS',
      ADP: 'ADPWNUSNERSA',
      CPI: 'CPIAUCSL',
      PPI: 'WPSFD49207',
      CORE_PPI: 'WPSFD4111',
    };

    const PPI_FALLBACK = 'PPIFGS';
    const CORE_PPI_FALLBACK = 'PPIFES';

    const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
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
        const response = await fetch(url, { signal });
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    };

    const fetchFred = async (seriesId: string, limit = 16, retries = 2) => {
      const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetchWithTimeout(url, 6000);
          if (response.status === 429) {
            console.warn(`[macro-server] Rate limited for ${seriesId}, attempt ${attempt + 1}/${retries + 1}`);
            const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          if (!response.ok) {
            let errorText = '';
            try { errorText = await response.text(); } catch {}
            console.warn(`[macro-server] FRED ${seriesId} HTTP ${response.status}: ${errorText.slice(0, 150)}`);
            if (response.status >= 500) {
              const delayMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            }
            return null;
          }
          const data: any = await response.json();
          const filtered = (data.observations || [])
            .filter((o: any) => o.value !== '.')
            .map((o: any) => ({ ...o, value: Number(o.value) }));
          return filtered.length > 0 ? filtered : null;
        } catch (e: any) {
          const isTimeout = e?.name === 'AbortError';
          console.warn(`[macro-server] FRED ${seriesId} try ${attempt + 1} failed:`, isTimeout ? 'timeout' : e?.message?.slice(0, 120));
          if (attempt < retries) {
            const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          return null;
        }
      }
      return null;
    };

    // GET /api/macro?debug=1 → 回傳原始 FRED 數據與計算過程，不受 cache 影響
    if (req.query?.debug === '1') {
      try {
        const debugResults: any = { timestamp: new Date().toISOString(), series: {} };
        const entries = Object.entries(SERIES);
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const allResults = await Promise.allSettled(
          entries.map(([, seriesId], index) => delay(index * 200).then(() => fetchFred(seriesId, 20)))
        );

        const fallbackResultsList = await Promise.allSettled([
          delay(entries.length * 200).then(() => fetchFred(PPI_FALLBACK, 20)),
          delay((entries.length + 1) * 200).then(() => fetchFred(CORE_PPI_FALLBACK, 20))
        ]);

        const safeGet = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : null;

        for (let i = 0; i < entries.length; i++) {
          const [key, seriesId] = entries[i];
          let data = safeGet(allResults[i]);
          if (key === 'PPI' && (!data || data.length < 14)) {
            data = safeGet(fallbackResultsList[0]);
          }
          if (key === 'CORE_PPI' && (!data || data.length < 14)) {
            data = safeGet(fallbackResultsList[1]);
          }
          debugResults.series[key] = {
            seriesId,
            count: data?.length ?? 0,
            latest3: data?.slice(0, 3).map(d => ({ date: d.date, value: d.value })) ?? [],
            oldest3: data?.slice(-3).map(d => ({ date: d.date, value: d.value })) ?? [],
            calcResult: data ? (() => {
              if (data.length < 1) return { error: 'insufficient data' };
              const current = data[0];
              const targetDate = new Date(current.date);
              targetDate.setFullYear(targetDate.getFullYear() - 1);
              const bestMatches = data.slice(1).map(d => ({
                date: d.date,
                diffDays: Math.abs(new Date(d.date).getTime() - targetDate.getTime()) / 86400000,
                value: d.value
              })).filter(d => d.diffDays <= 60).sort((a, b) => a.diffDays - b.diffDays);
              return {
                current: { date: current.date, value: current.value },
                targetDate: targetDate.toISOString().slice(0, 10),
                bestMatchFound: bestMatches[0] ?? null,
                candidatesCount: bestMatches.length,
                yoy: bestMatches[0] ? ((current.value / bestMatches[0].value - 1) * 100).toFixed(2) + '%' : null
              };
            })() : { error: 'no data' }
          };
        }
        
        return res.json(debugResults);
      } catch (err: any) {
        return res.status(500).json({ error: 'Debug fetch failed', details: err.message });
      }
    }

    const CPI_2026 = [
      "2026-01-13", "2026-02-11", "2026-03-11", "2026-04-14", "2026-05-13", "2026-06-12",
      "2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-13", "2026-12-11"
    ];

    const PPI_2026 = [
      "2026-01-14", "2026-02-12", "2026-03-12", "2026-04-15", "2026-05-14", "2026-06-15",
      "2026-07-15", "2026-08-13", "2026-09-15", "2026-10-15", "2026-11-16", "2026-12-15"
    ];

    const getNthDayOfMonth = (year: number, month: number, nth: number, dayOfWeek: number) => {
      const date = new Date(Date.UTC(year, month, 1));
      let count = 0;
      while (date.getUTCMonth() === month) {
        if (date.getUTCDay() === dayOfWeek) {
          count++;
          if (count === nth) return new Date(date);
        }
        date.setUTCDate(date.getUTCDate() + 1);
      }
      return null;
    };

    const getNextReleaseDates = () => {
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth();
      const checkPassed = (d: Date, hourUTC: number, minUTC = 0) => {
        const releaseTime = d.getTime() + hourUTC * 3600000 + minUTC * 60000;
        return releaseTime < now.getTime();
      };

      let adp = getNthDayOfMonth(year, month, 1, 3);
      if (adp && checkPassed(adp, 13, 15)) adp = getNthDayOfMonth(year, month + 1, 1, 3);
      
      let nfp = getNthDayOfMonth(year, month, 1, 5);
      if (nfp && checkPassed(nfp, 13, 30)) nfp = getNthDayOfMonth(year, month + 1, 1, 5);

      let cpi: Date | null = null;
      if (year === 2026 && month < 12) {
        const scheduledStr = CPI_2026[month];
        const candidate = new Date(scheduledStr + "T13:30:00Z");
        if (checkPassed(candidate, 0, 0)) {
          if (month + 1 < 12) {
            cpi = new Date(CPI_2026[month + 1] + "T13:30:00Z");
          } else {
            cpi = getNthDayOfMonth(year + 1, 0, 2, 3);
          }
        } else {
          cpi = candidate;
        }
      } else {
        cpi = getNthDayOfMonth(year, month, 2, 3);
        if (cpi && checkPassed(cpi, 13, 30)) cpi = getNthDayOfMonth(year, month + 1, 2, 3);
      }

      let ppi: Date | null = null;
      if (year === 2026 && month < 12) {
        const scheduledStr = PPI_2026[month];
        const candidate = new Date(scheduledStr + "T13:30:00Z");
        if (checkPassed(candidate, 0, 0)) {
          if (month + 1 < 12) {
            ppi = new Date(PPI_2026[month + 1] + "T13:30:00Z");
          } else {
            ppi = getNthDayOfMonth(year + 1, 0, 2, 4);
          }
        } else {
          ppi = candidate;
        }
      } else {
        ppi = getNthDayOfMonth(year, month, 2, 4);
        if (ppi && checkPassed(ppi, 13, 30)) ppi = getNthDayOfMonth(year, month + 1, 2, 4);
      }

      const format = (d: Date | null, time: string) => {
        if (!d) return 'TBD';
        const tpeOffset = 8 * 60;
        const tpeTime = new Date(d.getTime() + tpeOffset * 60 * 1000);
        const yr = tpeTime.getUTCFullYear();
        const mo = String(tpeTime.getUTCMonth() + 1).padStart(2, '0');
        const dy = String(tpeTime.getUTCDate()).padStart(2, '0');
        return `${yr}-${mo}-${dy} ${time} (TPE)`;
      };

      return { 
        adp: format(adp, '20:15'), 
        nfp: format(nfp, '20:30'), 
        cpi: format(cpi, '20:30'),
        ppi: format(ppi, '20:30')
      };
    };

    try {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const [nfpResult, adpResult, cpiResult, ppiResult, corePpiResult, ppiFallbackResult, corePpiFallbackResult] = await Promise.allSettled([
        fetchFred(SERIES.NFP, 6),
        delay(200).then(() => fetchFred(SERIES.ADP, 6)),
        delay(400).then(() => fetchFred(SERIES.CPI, 20)),
        delay(600).then(() => fetchFred(SERIES.PPI, 20)),
        delay(800).then(() => fetchFred(SERIES.CORE_PPI, 20)),
        delay(1000).then(() => fetchFred(PPI_FALLBACK, 20)),
        delay(1200).then(() => fetchFred(CORE_PPI_FALLBACK, 20)),
      ]);

      const safeGet = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : null;

      const nfpData = safeGet(nfpResult);
      const adpData = safeGet(adpResult);
      const cpiData = safeGet(cpiResult);

      const ppiMain = safeGet(ppiResult);
      const ppiFallback = safeGet(ppiFallbackResult);
      const ppiIsMain = !!(ppiMain && ppiMain.length >= 14);
      const ppiData = ppiIsMain ? ppiMain : ppiFallback;

      const corePpiMain = safeGet(corePpiResult);
      const corePpiFallback = safeGet(corePpiFallbackResult);
      const corePpiIsMain = !!(corePpiMain && corePpiMain.length >= 14);
      const corePpiData = corePpiIsMain ? corePpiMain : corePpiFallback;

      console.log('[macro-server] Series used:', {
        ppi: ppiIsMain ? SERIES.PPI : PPI_FALLBACK,
        corePpi: corePpiIsMain ? SERIES.CORE_PPI : CORE_PPI_FALLBACK,
      });

      const dates = getNextReleaseDates();
      const validateRange = (val: number, min: number, max: number) => !isNaN(val) && val >= min && val <= max;

      // 判斷 ADP 是否為「今天發布但尚未公布」
      const tpeTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const yr = tpeTime.getUTCFullYear();
      const mo = String(tpeTime.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(tpeTime.getUTCDate()).padStart(2, '0');
      const tpeTodayStr = `${yr}-${mo}-${dy}`;
      const adpReleaseToday = dates.adp.startsWith(tpeTodayStr);
      const tpeNowHour = tpeTime.getUTCHours();
      const tpeNowMin = tpeTime.getUTCMinutes();
      const isBeforeRelease = (tpeNowHour < 20) || (tpeNowHour === 20 && tpeNowMin < 15);
      const adpReleasePending = adpReleaseToday && isBeforeRelease;

      const calcYoY = (data: Array<{value: number, date: string}> | null, currentIdx = 0, minVal = -15, maxVal = 35): string | null => {
        if (!data || data.length < currentIdx + 1) return null;
        
        const current = data[currentIdx];
        const currentDate = new Date(current.date);
        const targetDate = new Date(currentDate);
        targetDate.setFullYear(targetDate.getFullYear() - 1); // Exact 1 year ago
        
        // Find the closest observation to 1 year ago (up to 60 days difference)
        let bestMatch: {value: number; date: string} | null = null;
        let bestDiff = Infinity;
        
        for (let i = currentIdx + 1; i < data.length; i++) {
          const d = new Date(data[i].date);
          const diff = Math.abs(d.getTime() - targetDate.getTime());
          const diffDays = diff / (1000 * 60 * 60 * 24);
          if (diffDays <= 60 && diffDays < bestDiff) {
            bestDiff = diffDays;
            bestMatch = data[i];
          }
        }
        
        if (!bestMatch) {
          console.warn(`[macro-server] calcYoY: no match found for ${current.date}, searched ${data.length - currentIdx - 1} observations`);
          return null;
        }

        if (bestDiff > 35) {
          console.warn(`[macro-server] calcYoY: best match is ${bestDiff.toFixed(0)} days off for ${current.date}`);
        }
        
        const yoy = (current.value / bestMatch.value - 1) * 100;
        return validateRange(yoy, minVal, maxVal) ? `${yoy.toFixed(1)}%` : null;
      };

      const results = {
        nfp: {
          actual: (nfpData && nfpData.length >= 2) ? (
            validateRange(nfpData[0].value - nfpData[1].value, -500, 1500) 
              ? `${Math.round(nfpData[0].value - nfpData[1].value)}K` : null
          ) : null,
          previous: (nfpData && nfpData.length >= 3) ? (
            validateRange(nfpData[1].value - nfpData[2].value, -500, 1500) 
              ? `${Math.round(nfpData[1].value - nfpData[2].value)}K` : null
          ) : null,
          forecast: "130K",
          forecastSource: "市場共識",
          forecastAsOf: "2026-06",
          nextRelease: dates.nfp,
          dataDate: nfpData?.[0]?.date ?? null,
          dataSource: SERIES.NFP,
          lastUpdated: new Date().toISOString()
        },
        adp: {
          actual: (adpData && adpData.length >= 1) ? (
            validateRange(adpData[0].value, -500, 1000) 
              ? `${Math.round(adpData[0].value)}K` : null
          ) : null,
          previous: (adpData && adpData.length >= 2) ? (
            validateRange(adpData[1].value, -500, 1000) 
              ? `${Math.round(adpData[1].value)}K` : null
          ) : null,
          forecast: "130K",
          forecastSource: "市場共識",
          forecastAsOf: "2026-06",
          nextRelease: dates.adp,
          pendingRelease: adpReleasePending,
          pendingReleaseTime: adpReleasePending ? dates.adp : null,
          dataDate: adpData?.[0]?.date ?? null,
          dataSource: SERIES.ADP,
          lastUpdated: new Date().toISOString()
        },
        cpi: {
          actual: calcYoY(cpiData, 0, -5, 20),
          previous: calcYoY(cpiData, 1, -5, 20),
          forecast: "2.4%",
          forecastSource: "市場共識",
          forecastAsOf: "2026-06",
          nextRelease: dates.cpi,
          dataDate: cpiData?.[0]?.date ?? null,
          dataSource: SERIES.CPI,
          lastUpdated: new Date().toISOString()
        },
        ppi: {
          actual: calcYoY(ppiData, 0, -10, 30),
          previous: calcYoY(ppiData, 1, -10, 30),
          forecast: "3.2%",
          forecastSource: "市場共識",
          forecastAsOf: "2026-06",
          nextRelease: dates.ppi,
          dataDate: ppiData?.[0]?.date ?? null,
          dataSource: ppiIsMain ? SERIES.PPI : PPI_FALLBACK,
          lastUpdated: new Date().toISOString()
        },
        core_ppi: {
          actual: calcYoY(corePpiData, 0, -5, 20),
          previous: calcYoY(corePpiData, 1, -5, 20),
          forecast: "3.0%",
          forecastSource: "市場共識",
          forecastAsOf: "2026-06",
          nextRelease: dates.ppi,
          dataDate: corePpiData?.[0]?.date ?? null,
          dataSource: corePpiIsMain ? SERIES.CORE_PPI : CORE_PPI_FALLBACK,
          lastUpdated: new Date().toISOString()
        }
      };

      console.log('[macro-server] Data status:', {
        nfp:      { count: nfpData?.length, actual: results.nfp.actual, date: nfpData?.[0]?.date },
        adp:      { count: adpData?.length, actual: results.adp.actual, date: adpData?.[0]?.date },
        cpi:      { count: cpiData?.length, actual: results.cpi.actual, date: cpiData?.[0]?.date },
        ppi:      { count: ppiData?.length, actual: results.ppi.actual, date: ppiData?.[0]?.date },
        core_ppi: { count: corePpiData?.length, actual: results.core_ppi.actual, date: corePpiData?.[0]?.date },
      });

      const successCount = [
        results.nfp.actual,
        results.adp.actual,
        results.cpi.actual,
        results.ppi.actual,
        results.core_ppi.actual,
      ].filter(Boolean).length;

      console.log(`[macro-server] Success: ${successCount}/5 indicators have data`);

      if (successCount >= 3) {
        cache.set(cacheKey, results, 600); // 10 minutes cache (600 seconds)
      } else if (successCount >= 1) {
        cache.set(cacheKey, results, 120); // 2 minutes short cache (120 seconds)
        console.warn('[macro-server] Partial data, using short cache TTL (2min)');
      } else {
        console.warn('[macro-server] All fetches failed, not caching');
      }

      res.json(results);
    } catch (err) {
      console.error('[macro-server] Route handler error:', err);
      res.status(500).json({ error: 'Failed to fetch macro data' });
    }
  });

  // 5. Yields
  app.get('/api/yields', async (req, res) => {
    const cacheKey = 'yields_indicators';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const FRED_API_KEY = process.env.FRED_API_KEY;
    const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

    const FALLBACK_DATA = {
      yield2y: 3.85,
      yield10y: 4.28,
      yield30y: 4.65,
      spread_2_10: 0.43,
      spread_2_30: 0.8,
      curveSignal: 'normal',
      stockOutlook: '（使用備援數據，請稍後重試）',
      outlookType: 'neutral',
      date: new Date().toISOString().split('T')[0],
      lastUpdated: new Date().toISOString(),
      absoluteLevel: 'high',
      absoluteLevelNote: '10年期殖利率偏高，壓縮股票本益比，成長股面臨估值修正壓力',
      pressureOnEquity: 'high',
      pressureNote: '高殖利率環境壓縮股票風險溢價，特別對高本益比科技股不利',
      keyRisks: ['⚠️ 數據暫時無法由美聯儲取得', '10年期殖利率處於偏高水位，本益比面臨潛在折價風險'],
      keyOpportunities: ['配置長期債券鎖定收益'],
      analystTake: '當前 FRED API 因網路或請求限制暫時無法取得最新數據。顯示為上次已知或合理市場預估。此時 2-10 債券利差大約維持在小幅走平至正常水位，債券對股市利差優勢仍強。',
      warningFlags: ['⚠️ 數據載入中，顯示為估算值'],
      percentile20y: 50,
      percentileNote: '當前 10Y 殖利率處於前 20 年的歷史中位水位附近。',
      historicalContexts: [],
      chartData: { dates: [], yield2y: [], yield10y: [], yield30y: [] },
      isFallback: true
    };

    if (!FRED_API_KEY) {
      return res.json({ error: 'FRED_API_KEY_MISSING' });
    }

    const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
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
        const response = await fetch(url, { signal });
        if (timeoutId) clearTimeout(timeoutId);
        return response;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      }
    };

    const fetchFredSeries = async (seriesId: string, retries = 2): Promise<{ value: number; date: string } | null> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
          const response = await fetchWithTimeout(url, 6000);
          
          if (response.status === 429) {
            console.warn(`[yields (server)] Rate limited for ${seriesId}, attempt ${attempt + 1}`);
            if (attempt < retries) {
              await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
              continue;
            }
            return null;
          }
          
          if (!response.ok) return null;
          
          const data: any = await response.json();
          const valid = (data.observations || [])
            .filter((o: any) => o.value !== '.')
            .map((o: any) => ({ value: Number(o.value), date: o.date }));
          return valid.length > 0 ? valid[0] : null;
        } catch (e) {
          console.error(`[yields (server)] Fetch failed for ${seriesId} (attempt ${attempt + 1}):`, e);
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          return null;
        }
      }
      return null;
    };

    async function fetchFredHistory(seriesId: string, monthsBack: number, frequency: 'm' | 'd' = 'm', retries = 2) {
      if (!FRED_API_KEY) return [];
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      const observationStart = startDate.toISOString().split('T')[0];
      const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${observationStart}&frequency=${frequency}&aggregation_method=eop`;
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await fetchWithTimeout(url, 6000);
          if (response.status === 429) {
            console.warn(`[yields-history (server)] Rate limited for ${seriesId}, attempt ${attempt + 1}/${retries + 1}`);
            const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          if (!response.ok) return [];
          const data: any = await response.json();
          const monthly = (data.observations || [])
            .filter((o: any) => o.value !== '.')
            .map((o: any) => ({ value: Number(o.value), date: o.date }));
          return monthly;
        } catch (e) {
          console.error(`[yields (server)] History fetch failed for ${seriesId} on try ${attempt + 1}:`, e);
          if (attempt < retries) {
            const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          return [];
        }
      }
      return [];
    }

    function calculatePercentile(history: Array<{ value: number }>, currentValue: number) {
      if (history.length === 0) return 50;
      const below = history.filter(h => h.value <= currentValue).length;
      return Math.round((below / history.length) * 100);
    }

    function mergeChartData(
      data2y: Array<{ value: number; date: string }>,
      data10y: Array<{ value: number; date: string }>,
      data30y: Array<{ value: number; date: string }>
    ) {
      // 建立各自的 YYYY-MM → value lookup
      const lookup2y  = new Map(data2y.map(d  => [d.date.slice(0, 7), d.value]));
      const lookup10y = new Map(data10y.map(d => [d.date.slice(0, 7), d.value]));
      const lookup30y = new Map(data30y.map(d => [d.date.slice(0, 7), d.value]));

      // 取三方月份聯集，排序
      const allMonths = Array.from(
        new Set([
          ...data2y.map(d  => d.date.slice(0, 7)),
          ...data10y.map(d => d.date.slice(0, 7)),
          ...data30y.map(d => d.date.slice(0, 7)),
        ])
      ).sort();  // "YYYY-MM" 字串排序即正確時間順序

      const result = allMonths.map(month => ({
        date:     month,
        yield2y:  lookup2y.get(month)  ?? null,
        yield10y: lookup10y.get(month) ?? null,
        yield30y: lookup30y.get(month) ?? null,
      }));

      return {
        dates:    result.map(r => r.date),
        yield2y:  result.map(r => r.yield2y),
        yield10y: result.map(r => r.yield10y),
        yield30y: result.map(r => r.yield30y),
      };
    }

    function sampleMonthlyLast(
      daily: Array<{ value: number; date: string }>
    ): Array<{ value: number; date: string }> {
      if (daily.length === 0) return [];
      
      const byMonth: Record<string, { value: number; date: string }> = {};
      
      for (const point of daily) {
        const monthKey = point.date.slice(0, 7); // "YYYY-MM"
        byMonth[monthKey] = point; // Keep latest in the month
      }
      
      return Object.values(byMonth).sort((a, b) => a.date.localeCompare(b.date));
    }

    function getHistoricalContext(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number) {
      const contexts: any[] = [];

      // Special Check: 30Y > 5%
      if (yield30y && yield30y >= 5.0) {
        contexts.push({
          period: '長期資本預算轉折點',
          years: '2023.10',
          marketEvent: '30年期美債殖利率突破 5% 心理關卡，為 2007 年以來首次，標誌長期資本成本進入「新高利率時代」。美國赤字融資壓力加劇，殖利率曲線在長端出現劇烈「熊市陡峭化」（Bear Steepening）。',
          outcome: '股市短期兩週內急跌約 5-7%，房地產投資信託（REITs）因折現率攀升而大幅下調。然而隨後因聯準會政策指引轉向，股市在兩個月內報復性反彈近 15%，證明 5% 雖是壓力位但並非牛市終結點。',
          similarity: 'identical'
        });
      }

      // Level Logic: Very High (>4.5%)
      if (yield10y >= 4.5) {
        if (spread_2_10 < 0) {
          contexts.push({
            period: '金融海嘯前夕（倒掛期）',
            years: '2006-2007',
            marketEvent: '10年期殖利率穩定於 4.5-5.3% 區間，聯署會將基準利率維持在 5.25% 達一年之久。2-10年利差最深倒掛達 -15bp，房市泡沫開始出現裂痕，但股市仍在慣性上漲。',
            outcome: '標普 500 在倒掛後仍持續上漲約 12 個月並創新高，直到 2007 年 10 月才見頂。隨後進入長達 17 個月、最大跌幅 57% 的全球金融危機。倒掛至股市崩跌存在顯著的時間滯後。',
            similarity: 'similar'
          });
        }
        contexts.push({
          period: '聯準會暴力升息循環',
          years: '2022-2024',
          marketEvent: 'CPI 峰值達 9.1%，Fed 在 12 個月內升息 525bp。10年期殖利率從 1.5% 飆升至 5%，2年期一度達 5.3%，2-10利差嚴重倒掛達 -108bp（自 1980 年代以來最深）。',
          outcome: '錄得百年最差股債組合表現：標普 500 跌 25%，納斯達克跌 34%。隨後 AI 浪潮爆發引發估值重構，股市在殖利率維持 4% 以上的高位時仍大幅反彈並創歷史新高（2023-2024）。',
          similarity: 'identical'
        });
      } 
      // Level Logic: High (4.0% - 4.5%)
      else if (yield10y >= 4.0) {
        if (spread_2_10 < 0.2) {
          contexts.push({
            period: '網路泡沫頂峰前奏',
            years: '1998-1999',
            marketEvent: '10年期殖利率由 4.2% 回升至 6% 區間。當時經濟成長強勁，技術進步推升生產力預期，Fed 啟動防禦性升息。曲線近乎平坦，市場極度樂觀。',
            outcome: '儘管利率走高，納斯達克指數在 1999 年仍翻倍成長，最終在 2000 年 3 月殖利率達到 6.8% 時崩潰。說明在「生產力爆發」期，股市對 4% 以上利率有極強耐受力。',
            similarity: 'similar'
          });
        }
        contexts.push({
          period: '後疫情緊縮恢復期',
          years: '2022.Q3',
          marketEvent: '10年期首次站上 4% 關卡，市場正式告別 10 年來的低利率環境（ZERPI）。市場正在重新學習如何對債券進行風險定價，波動率指數（VIX）長期維持在 20 以上。',
          outcome: '股市呈現極高敏感度，每次通膨數據公布皆引發 2-3% 的單日震盪。隨後價值股與能源股表現顯著優於虧損中的科技股，市場重心由「成長展望」轉向「獲利品質」。',
          similarity: 'similar'
        });
      }
      // Level Logic: Moderate (3.0% - 4.0%)
      else if (yield10y >= 3.0) {
        if (spread_2_10 < 0) {
          contexts.push({
            period: '聯準會貨幣緊縮末期',
            years: '2018-2019',
            marketEvent: 'Fed 縮表（QT）疊加升息，10年期殖利率升至 3.25%。2-10利差一度倒掛，當時中美貿易爭端加劇，市場對經濟成長放緩產生劇烈恐慌。',
            outcome: '2018 年 Q4 標普 500 急跌 20% 觸發空頭市場，迫使 Fed 官員集體「轉鴿」並於 2019 年展開預防性降息。隨後股市報復性反彈，開啟了 2019 年近 30% 的年度漲幅。',
            similarity: 'similar'
          });
        } else {
          contexts.push({
            period: '削減恐慌（Taper Tantrum）',
            years: '2013-2014',
            marketEvent: 'Fed 暗示將減少每月的購債規模，10年期殖利率在 4 個月內從 1.6% 暴力拉升至 3.0%。全球資金由新興市場回流美國，借貸成本預期陡增。',
            outcome: '股市經歷短暫 5-8% 震盪後隨即消化衝擊。當時美股企業獲利強勁，足以抵銷利息成本上升的負面影響，標普 500 全年最終錄得 30% 漲幅。',
            similarity: 'approximate'
          });
        }
      }
      // Level Logic: Low (2.0% - 3.0%)
      else if (yield10y >= 2.0) {
        contexts.push({
          period: '金髮女孩經濟時期',
          years: '2016-2018',
          marketEvent: '10年期在 1.8% 至 2.6% 區間波動，通膨維持在 2% 目標附近。Fed 緩步且透明地提高利率。這是標準的景氣擴張中期，資金環境異常舒適。',
          outcome: '標普 500 呈現穩定的低波動上漲，科技股（FAANG）正式進入權重支配階段。直到 2018 年殖利率突破 3% 且 Fed 發言過於強硬，上漲趨勢才被打破。',
          similarity: 'similar'
        });
      }
      // Level Logic: Very Low (< 2.0%)
      else {
        contexts.push({
          period: '疫情量化寬鬆盛世',
          years: '2020-2021',
          marketEvent: '為應對疫情，Fed 實施無限量 QE 並將利率調降至零（ZLB）。10年期一度跌破 0.6%，真實利率（Real Yield）深度負值，資金無處可去。',
          outcome: '催生了史詩級的資產價格泡沫：納斯達克兩年內翻倍，S&P 500 創下最速從熊市恢復並翻倍的紀錄。加密貨幣與非利潤型科技股出現非理性狂熱。',
          similarity: 'similar'
        });
      }

      return contexts.slice(0, 3);
    }

    function getAbsoluteLevel(yield10y: number) {
      if (yield10y < 2.5) return { level: 'low', note: '10年期殖利率處於低位，對股市估值壓力輕微，有利成長股' };
      if (yield10y < 3.5) return { level: 'moderate', note: '10年期殖利率溫和，對股市估值影響中性' };
      if (yield10y < 4.5) return { level: 'high', note: '10年期殖利率偏高，壓縮股票本益比，成長股面臨估值修正壓力' };
      return { level: 'very_high', note: '10年期殖利率達近年高位（>4.5%），對股市估值形成顯著壓制，無風險報酬率吸引力上升' };
    }

    function getEquityPressure(yield10y: number, yield30y: number | null) {
      const base = yield10y;
      const longEnd = yield30y ?? yield10y + 0.5;
      if (base < 3.0) return { pressure: 'low', note: '殖利率偏低，資金成本低廉，股票相對債券仍具吸引力' };
      if (base < 4.0) return { pressure: 'moderate', note: '殖利率溫和上行，股債競爭加劇，但股市仍可支撐' };
      if (base < 4.5 || longEnd < 5.0) return { pressure: 'high', note: '高殖利率環境壓縮股票風險溢價，特別對高本益比科技股不利' };
      return { 
        pressure: 'very_high', 
        note: `10年期 ${base.toFixed(2)}%${longEnd >= 5.0 ? `、30年期 ${longEnd.toFixed(2)}%` : ''}，殖利率全面高位，債券作為替代資產吸引力顯著提升，股市估值承壓` 
      };
    }

    function getKeyRisks(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number) {
      const risks: string[] = [];
      if (yield10y >= 4.5) risks.push(`10年期殖利率 ${yield10y.toFixed(2)}% 處於近年高位，本益比壓縮風險`);
      if (yield30y && yield30y >= 5.0) risks.push(`30年期殖利率突破 5%，長期資本成本上升，不利基建與房地產`);
      if (spread_2_10 < 0.3 && spread_2_10 >= 0) risks.push(`2-10利差僅 ${(spread_2_10 * 100).toFixed(0)}bp，曲線近乎平坦，銀行業利差收窄`);
      if (spread_2_10 < 0) risks.push(`殖利率曲線倒掛 ${(Math.abs(spread_2_10) * 100).toFixed(0)}bp，歷史上預測衰退準確率達 70%`);
      if (yield2y >= 4.5) risks.push(`2年期殖利率 ${yield2y.toFixed(2)}%，短債具吸引力，資金可能從股市流向貨幣市場基金`);
      return risks.slice(0, 4);
    }

    function getKeyOpportunities(yield10y: number, spread_2_10: number) {
      const opps: string[] = [];
      if (yield10y >= 4.5 && spread_2_10 > 0) opps.push('高殖利率環境有利銀行股與保險股，利差擴大帶動淨利息收入');
      if (yield10y >= 4.0) opps.push('長債殖利率高位鎖定，配置 TLT/TMF 等長債 ETF 具潛在資本利得機會');
      return opps;
    }

    function getAnalystTake(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number) {
      const longEnd = yield30y ?? null;
      if (yield10y >= 4.0 && yield10y < 4.5 && spread_2_10 >= 0 && spread_2_10 < 0.5) {
        return `當前殖利率曲線呈平坦形態，2-10利差僅 ${(spread_2_10 * 100).toFixed(0)}bp，顯示市場對短期利率維持高位的預期。10年期 ${yield10y.toFixed(2)}% 的絕對水位對成長股估值構成壓力，股票風險溢價（ERP）已收窄至歷史低位。建議重點關注現金流穩定的價值股，降低對高本益比科技股的暴露。`;
      }
      if (longEnd && longEnd >= 5.0) {
        return `30年期公債殖利率突破 5% 心理關卡，標誌著長期資本成本全面走高。這對以長期現金流折現定價的資產（房地產、公用事業、成長股）形成系統性壓制。${yield10y >= 4.5 ? `10年期同步達 ${yield10y.toFixed(2)}%，` : ''}市場正在重新評估「Fed put」是否仍然有效，建議提高現金比例，等待殖利率回落再布局風險資產。`;
      }
      if (spread_2_10 < 0) {
        return `殖利率曲線倒掛 ${(Math.abs(spread_2_10) * 100).toFixed(0)}bp，歷史上自 1960 年以來，此形態後的 12-18 個月內美國有 8 次衰退（準確率超過 70%）。然而，倒掛到衰退的時間差長短不一（最短 6 個月，最長 24 個月），股市在倒掛期間仍可能維持上漲。建議關注信用利差走勢，作為衰退即將到來的更即時訊號。`;
      }
      if (spread_2_10 > 0.5 && yield10y < 3.5) {
        return `殖利率曲線陡峭化且絕對水位溫和，為股市最友善的債市環境。銀行業受益於利差擴大，成長股估值壓力輕微。歷史上此組合往往對應經濟早期擴張階段，股市中長期表現通常強勁。`;
      }
      return `當前殖利率格局顯示市場處於政策轉折的關鍵觀察期。2年期 ${yield2y.toFixed(2)}% 反映市場對聯準會維持高利率的預期，而 10年期 ${yield10y.toFixed(2)}% 則顯示長期通膨預期仍偏高。在通膨數據回落至 2% 目標前，高利率環境可能持續，股市的支撐需來自企業獲利的實質增長。`;
    }

    function getWarningFlags(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number) {
      const flags: string[] = [];
      if (yield10y >= 4.5) flags.push('🔴 10Y ≥ 4.5%：估值壓制區');
      else if (yield10y >= 4.0) flags.push('🟡 10Y ≥ 4.0%：高殖利率警戒');
      if (yield30y && yield30y >= 5.0) flags.push('🔴 30Y ≥ 5.0%：長期資本成本高位');
      if (spread_2_10 < 0) flags.push(`🔴 曲線倒掛 ${(Math.abs(spread_2_10)*100).toFixed(0)}bp`);
      else if (spread_2_10 < 0.25) flags.push('🟡 曲線趨平，接近倒掛');
      if (yield2y >= 4.5) flags.push('🟡 2Y高位：貨幣市場基金競爭股市資金');
      return flags;
    }

    try {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      // === Layer 1: Core yields data (DGS2, DGS10, DGS30) - Must succeed, use retrying fetch ===
      const [y2, y10, y30] = await Promise.all([
        fetchFredSeries('DGS2'),
        delay(200).then(() => fetchFredSeries('DGS10')),
        delay(400).then(() => fetchFredSeries('DGS30')),
      ]);

      if (!y2 || !y10) {
        console.warn('[yields (server)] Core FRED yields unavailable, returning fallback data');
        return res.json({
          ...FALLBACK_DATA,
          isFallback: true,
          error: null
        });
      }

      // === Layer 2: Historical datasets - Failsafe fetching with Promise.allSettled ===
      const [histResult, chart2yResult, chart10yResult, chart30yResult] = await Promise.allSettled([
        delay(600).then(() => fetchFredHistory('DGS10', 240, 'm')),
        delay(800).then(() => fetchFredHistory('DGS2', 24, 'm')),
        delay(1000).then(() => fetchFredHistory('DGS10', 24, 'm')),
        delay(1200).then(() => fetchFredHistory('DGS30', 24, 'm'))
      ]);

      const history20y = histResult.status === 'fulfilled' ? histResult.value : [];
      const chart2y    = chart2yResult.status === 'fulfilled' ? chart2yResult.value : [];
      const chart10y   = chart10yResult.status === 'fulfilled' ? chart10yResult.value : [];
      const chart30y   = chart30yResult.status === 'fulfilled' ? chart30yResult.value : [];

      const spread_2_10 = y10.value - y2.value;
      const spread_2_30 = y30 ? y30.value - y2.value : null;

      let curveSignal = 'normal';
      let stockOutlook = '';
      let outlookType = 'bullish';

      if (spread_2_10 > 0.5) {
        curveSignal = 'normal';
        stockOutlook = '殖利率曲線正常，經濟擴張預期，有利股市';
        outlookType = 'bullish';
      } else if (spread_2_10 >= 0) {
        curveSignal = 'flat';
        stockOutlook = '殖利率曲線趨平，經濟放緩跡象，建議謹慎';
        outlookType = 'neutral';
      } else if (spread_2_10 >= -0.5) {
        curveSignal = 'inverted';
        stockOutlook = '殖利率曲線倒掛，歷史上為衰退前兆，留意風險';
        outlookType = 'bearish';
      } else {
        curveSignal = 'deep_inverted';
        stockOutlook = '殖利率曲線深度倒掛，衰退訊號強烈，建議保守';
        outlookType = 'strong_bearish';
      }

      const absLevel = getAbsoluteLevel(y10.value);
      const pressure = getEquityPressure(y10.value, y30 ? y30.value : null);

      const percentile20y = calculatePercentile(history20y, y10.value);
      const percentileNote = `當前 10Y 殖利率高於過去 20 年中 ${percentile20y}% 的時間，處於歷史${percentile20y > 80 ? '極高' : percentile20y > 60 ? '偏高' : percentile20y > 40 ? '中位' : '偏低'}水位`;

       const mergedCharts = mergeChartData(chart2y, chart10y, chart30y);

       // Debug log（生產環境可移除）
       console.log('[yields (server)] Chart data points:', {
         dates:    mergedCharts.dates.length,
         yield2y:  mergedCharts.yield2y.filter(v => v !== null).length,
         yield10y: mergedCharts.yield10y.filter(v => v !== null).length,
         yield30y: mergedCharts.yield30y.filter(v => v !== null).length,
         sample2y:  mergedCharts.yield2y.slice(-3),
         sample30y: mergedCharts.yield30y.slice(-3),
       });

       // Align chart last point with live data
       if (y10 && mergedCharts.dates.length > 0) {
         const todayMonth = y10.date.slice(0, 7);
         const lastChartMonth = mergedCharts.dates[mergedCharts.dates.length - 1];

         if (todayMonth !== lastChartMonth) {
           // 新月份：追加一筆
           mergedCharts.dates.push(todayMonth);
           mergedCharts.yield2y.push(y2?.value  ?? null);
           mergedCharts.yield10y.push(y10.value);
           mergedCharts.yield30y.push(y30?.value ?? null);
         } else {
           // 同月份：更新最後一筆（三條線都更新）
           const lastIdx = mergedCharts.dates.length - 1;
           mergedCharts.yield2y[lastIdx]  = y2?.value  ?? mergedCharts.yield2y[lastIdx];
           mergedCharts.yield10y[lastIdx] = y10.value;
           mergedCharts.yield30y[lastIdx] = y30?.value ?? mergedCharts.yield30y[lastIdx];
         }
       }

      const results = {
        yield2y: y2.value,
        yield10y: y10.value,
        yield30y: y30 ? y30.value : null,
        spread_2_10,
        spread_2_30,
        curveSignal,
        stockOutlook,
        outlookType,
        date: y10.date,
        lastUpdated: new Date().toISOString(),
        absoluteLevel: absLevel.level,
        absoluteLevelNote: absLevel.note,
        pressureOnEquity: pressure.pressure,
        pressureNote: pressure.note,
        keyRisks: getKeyRisks(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
        keyOpportunities: getKeyOpportunities(y10.value, spread_2_10),
        analystTake: getAnalystTake(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
        warningFlags: getWarningFlags(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
        percentile20y,
        percentileNote,
        historicalContexts: getHistoricalContext(
          y2.value,
          y10.value,
          y30 ? y30.value : null,
          spread_2_10
        ),
        chartData: mergedCharts,
        isFallback: false
      };

      cache.set(cacheKey, results, 600);
      res.json(results);
    } catch (err) {
      console.error('[yields (server)] Handler error:', err);
      res.json({
        ...FALLBACK_DATA,
        isFallback: true,
        error: null
      });
    }
  });

  // 7. Market Breadth Analysis
  app.get('/api/breadth', async (req, res) => {
    const cacheKey = 'market_breadth_v1';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const TOP10 = [
      { symbol: 'AAPL', name: 'Apple' },
      { symbol: 'MSFT', name: 'Microsoft' },
      { symbol: 'NVDA', name: 'NVIDIA' },
      { symbol: 'AMZN', name: 'Amazon' },
      { symbol: 'GOOGL', name: 'Alphabet' },
      { symbol: 'META', name: 'Meta' },
      { symbol: 'TSLA', name: 'Tesla' },
      { symbol: 'AVGO', name: 'Broadcom' },
      { symbol: 'BRK-B', name: 'Berkshire' },
      { symbol: 'JPM', name: 'JPMorgan' },
    ];

    const generateBreadthAnalysis = (score: number, premium: number, ma50Pct: number, ma200Pct: number): string => {
      if (score > 70) {
        return `市場寬度健康，Top10 巨頭中 ${ma50Pct}% 站上50日均線、${ma200Pct}% 站上200日均線，漲勢具備廣泛參與基礎。集中度溢價僅 ${premium.toFixed(1)}%，顯示非巨頭股也有貢獻，牛市結構穩健，短期回調風險相對較低。`;
      }
      if (score > 50) {
        return `市場寬度出現收窄跡象，Top10 中有 ${100 - ma50Pct}% 已跌破50日均線。集中度溢價達 ${premium.toFixed(1)}%，指數漲幅開始集中於少數個股驅動。歷史上此形態若持續 2-3 個月，往往先出現板塊輪動，再演變為較大幅度的指數修正，建議開始分批降低高估值持股。`;
      }
      if (score > 30) {
        return `市場寬度明顯惡化，Top10 中僅 ${ma50Pct}% 站上50日均線。集中度溢價高達 ${premium.toFixed(1)}%，漲幅高度集中於 Mag7 等少數股票，整體市場抵抗力下降。一旦領頭股出現利空，缺乏廣泛支撐的指數將快速回落，歷史上類似形態出現在 2021 年底 and 2018 年 Q4 前夕，建議提高防禦性配置。`;
      }
      return `市場寬度極度惡化，Top10 中僅 ${ma50Pct}% 站上50日均線，集中度溢價達 ${premium.toFixed(1)}%，已達歷史性極端水位。2000年科技泡沫頂峰和2021年底均出現類似形態，隨後均發生大規模修正。當前指數若持續依賴少數股票支撐，系統性風險極高，強烈建議降低風險暴露。`;
    };

    try {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Phase 1: 並行抓取所有 quotes 以及 SPY
      const [spyQuote, ...stockQuotes] = await Promise.all([
        yahooFinance.quote('SPY').catch(() => null),
        ...TOP10.map(s => yahooFinance.quote(s.symbol).catch(() => null))
      ]);
      const sp500Quote = await yahooFinance.quote('^GSPC').catch(() => null);

      // Phase 2: 抓 S&P500 chart
      const sp500Chart = await yahooFinance.chart('^GSPC', {
        period1: ninetyDaysAgo,
        interval: '1d' as any
      }).catch(() => null);

      // 計算指標
      const topStocks = stockQuotes
        .map((q: any, i: number) => {
          if (!q) return null;
          const price = q.regularMarketPrice ?? 0;
          const ma50 = q.fiftyDayAverage ?? 0;
          const ma200 = q.twoHundredDayAverage ?? 0;
          const high52w = q.fiftyTwoWeekHigh ?? price;
          
          return {
            symbol: TOP10[i].symbol,
            name: q.shortName || TOP10[i].name,
            changePercent1D: q.regularMarketChangePercent ?? 0,
            changePercent3M: null,
            aboveMa50: ma50 > 0 && price > ma50,
            aboveMa200: ma200 > 0 && price > ma200,
            distanceFromHigh52w: high52w > 0 ? ((price - high52w) / high52w) * 100 : 0,
          };
        })
        .filter(Boolean);

      if (topStocks.length < 5) {
        return res.status(500).json({ error: 'Insufficient stock data' });
      }

      const validCount = topStocks.length;
      const aboveMa50Count = (topStocks as any[]).filter(s => s.aboveMa50).length;
      const aboveMa200Count = (topStocks as any[]).filter(s => s.aboveMa200).length;
      const advancingCount = (topStocks as any[]).filter(s => s.changePercent1D > 0).length;

      const breadthScore = Math.round(
        (aboveMa50Count / validCount) * 40 +
        (aboveMa200Count / validCount) * 30 +
        (advancingCount / validCount) * 30
      );

      let sp500Return3M = 0;
      if (sp500Chart?.quotes?.length > 5) {
        const quotes = (sp500Chart.quotes as any[]).filter((q: any) => q.close != null);
        if (quotes.length > 0) {
          const first = quotes[0].close;
          const last = quotes[quotes.length - 1].close;
          sp500Return3M = first > 0 ? ((last - first) / first) * 100 : 0;
        }
      }

      const avgTop10Change = (topStocks as any[]).reduce((sum: number, s: any) => sum + s.changePercent1D, 0) / validCount;
      const sp500Change = sp500Quote?.regularMarketChangePercent ?? 0;
      const concentrationPremium = avgTop10Change - sp500Change;

      let top10WeightEstimate = 35.0; // 2026年預設估算
      let top10WeightIsLive = false;

      try {
        let spyMarketCap = spyQuote?.regularMarketPrice && spyQuote?.sharesOutstanding
          ? spyQuote.regularMarketPrice * spyQuote.sharesOutstanding
          : null;
        if (!spyMarketCap && spyQuote?.marketCap) {
          spyMarketCap = spyQuote.marketCap;
        }
        
        const top10MarketCap = (stockQuotes || []).reduce((sum, q) => sum + ((q as any)?.marketCap ?? 0), 0);
        
        if (spyMarketCap && top10MarketCap && spyMarketCap > 0) {
          const calculatedWeight = Number(((top10MarketCap / spyMarketCap) * 100).toFixed(1));
          // 合理區間過濾
          if (calculatedWeight >= 20 && calculatedWeight <= 65) {
            top10WeightEstimate = calculatedWeight;
            top10WeightIsLive = true;
          }
        }
      } catch (e) {
        console.error('[breadth] top10Weight fetch error in dev server:', e);
      }

      const sp500Price = sp500Quote?.regularMarketPrice ?? 0;
      const sp500Ma50 = sp500Quote?.fiftyDayAverage ?? 0;
      const sp500AboveMa = sp500Price > sp500Ma50;
      const sp500AboveMa50Estimate = sp500AboveMa
        ? Math.min(75, Math.round((aboveMa50Count / validCount) * 100 * 0.8 + 20))
        : Math.max(35, Math.round((aboveMa50Count / validCount) * 100 * 0.6));

      const breadthSignal = 
        breadthScore > 70 ? 'healthy' :
        breadthScore > 50 ? 'narrowing' :
        breadthScore > 30 ? 'concentrated' : 'extreme_concentration';

      const breadthLabel =
        breadthSignal === 'healthy' ? '健康 (Healthy)' :
        breadthSignal === 'narrowing' ? '收窄 (Narrowing)' :
        breadthSignal === 'concentrated' ? '集中 (Concentrated)' : '極度集中 (Extreme)';

      const riskLevel =
        breadthSignal === 'healthy' ? 'low' :
        breadthSignal === 'narrowing' ? 'medium' :
        breadthSignal === 'concentrated' ? 'high' : 'critical';

      const breadthAnalysis = generateBreadthAnalysis(
        breadthScore, 
        concentrationPremium, 
        Math.round((aboveMa50Count/validCount)*100), 
        Math.round((aboveMa200Count/validCount)*100)
      );

      const result = {
        concentration: {
          breadthScore,
          concentrationPremium: parseFloat(concentrationPremium.toFixed(2)),
          top10WeightEstimate,
          top10WeightIsLive,
          top10Return3M: parseFloat(avgTop10Change.toFixed(2)),
          sp500Return3M: parseFloat(sp500Return3M.toFixed(2)),
        },
        topStocks,
        breadthSignal,
        breadthLabel,
        breadthAnalysis,
        riskLevel,
        sp500AboveMa50Estimate,
        lastUpdated: new Date().toISOString(),
      };
      
      cache.set(cacheKey, result, 600);
      res.json(result);
    } catch (error: any) {
      console.error('[breadth] Handler error:', error?.message);
      res.status(500).json({ error: 'Failed to calculate market breadth' });
    }
  });

  // 8. Yen Carry Trade Risk Monitor
  let carryCache: { data: any; ts: number } | null = null;
  const CARRY_CACHE_TTL = 300_000; // 5 minutes cache

  app.get('/api/carry', async (req, res) => {
    if (carryCache && Date.now() - carryCache.ts < CARRY_CACHE_TTL) {
      return res.json(carryCache.data);
    }

    const FRED_API_KEY = process.env.FRED_API_KEY;
    const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

    const BOJ_HIKE_PROB = Number(process.env.BOJ_HIKE_PROB ?? '62');
    const BOJ_QT_PROB = Number(process.env.BOJ_QT_PROB ?? '32');
    const BOJ_PROB_UPDATED = process.env.BOJ_PROB_UPDATED ?? '2026-05-25';

    const fetchFromFred = async (seriesId: string): Promise<number | null> => {
      if (!FRED_API_KEY) return null;
      try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=1`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data: any = await response.json();
        const latest = data.observations?.[0];
        if (latest && latest.value !== '.') {
          return Number(latest.value);
        }
      } catch (e) {
        console.error(`[carry] FRED fetch error for ${seriesId}:`, e);
      }
      return null;
    };

    const fetchFromFredMultiple = async (seriesId: string, limit: number): Promise<number[]> => {
      if (!FRED_API_KEY) return [];
      try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data: any = await response.json();
        return (data.observations || [])
          .filter((o: any) => o.value !== '.')
          .map((o: any) => Number(o.value));
      } catch (e) {
        console.error(`[carry] FRED multiple fetch error for ${seriesId}:`, e);
        return [];
      }
    };

    const fetchInflationDiff = async (): Promise<number> => {
      const FALLBACK = 1.5;
      if (!FRED_API_KEY) return FALLBACK;
      try {
        const [usData, jpData] = await Promise.all([
          fetchFromFredMultiple('CPIAUCSL', 13),
          fetchFromFredMultiple('JPNCPIALLMINMEI', 13)
        ]);
        if (usData.length < 13 || jpData.length < 13) return FALLBACK;
        
        const usCpiYoY = ((usData[0] - usData[12]) / usData[12]) * 100;
        const jpCpiYoY = ((jpData[0] - jpData[12]) / jpData[12]) * 100;
        const diff = Number((usCpiYoY - jpCpiYoY).toFixed(2));
        
        return (diff > 0 && diff < 5) ? diff : FALLBACK;
      } catch (e) {
        console.error('[carry] fetchInflationDiff error:', e);
        return FALLBACK;
      }
    };

    let fedRate = 3.33; // Default FED funds effective rate ~2026年5月估算
    let fedRateRange = "3.25% - 3.50%";
    let bojRate = 0.50; // BOJ 升息後
    let usdJpy = 145.0; // 近期匯率區間
    let usdJpyWeeklyChange = 0.0;

    let fedIsLive = false;
    let bojIsLive = false;
    let usdJpyIsLive = false;

    let inflationDiff = 1.5;
    if (FRED_API_KEY) {
      try {
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
      } catch (e) {
        console.error('[carry] FRED API call failed:', e);
      }
    }

    try {
      const usdJpyQuote = await yahooFinance.quote('JPY=X');
      if (usdJpyQuote && usdJpyQuote.regularMarketPrice) {
        usdJpy = usdJpyQuote.regularMarketPrice;
        usdJpyIsLive = true;
      }

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
        usdJpyWeeklyChange = Number((usdJpyQuote.regularMarketChangePercent ?? 0.0).toFixed(2));
      }
    } catch (e) {
      console.error('[carry] Yahoo Finance fetch error:', e);
    }

    const nominalSpread = Number((fedRate - bojRate).toFixed(2));
    const realSpread = Number((nominalSpread - inflationDiff).toFixed(2));

    let realSpreadProgress: number;
    if (realSpread <= 3.5) {
      realSpreadProgress = 100;
    } else if (realSpread >= 5.0) {
      realSpreadProgress = 0;
    } else {
      realSpreadProgress = Number((((5.0 - realSpread) / (5.0 - 3.5)) * 100).toFixed(1));
    }

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
      updatedAt: new Date().toISOString()
    };

    carryCache = { data: results, ts: Date.now() };
    res.json(results);
  });

  // 9. JPY Speculative Short COT Monitor
  let cotCache: { data: any; ts: number } | null = null;
  const COT_CACHE_TTL = 3600000; // 1-hour cache

  app.get('/api/cot', async (req, res) => {
    if (cotCache && Date.now() - cotCache.ts < COT_CACHE_TTL) {
      return res.json(cotCache.data);
    }

    const NASDAQ_API_KEY = process.env.NASDAQ_DATA_LINK_API_KEY;

    const fetchWithTimeout = async (url: string, init?: RequestInit, timeoutMs = 8000) => {
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
    };

    // 層1：Quandl/Nasdaq Data Link
    const fetchFromNasdaq = async (): Promise<{ value: number; date: string; history: Array<{date: string, value: number}> } | null> => {
      if (!NASDAQ_API_KEY) return null;
      try {
        const url = `https://data.nasdaq.com/api/v3/datasets/CFTC/097741_FO_ALL_CR.json?api_key=${NASDAQ_API_KEY}&rows=52`;
        const response = await fetchWithTimeout(url, undefined, 8000);
        if (!response.ok) return null;
        const json: any = await response.json();
        
        const dataset = json?.dataset;
        if (!dataset?.data || !dataset?.column_names) return null;
        
        const colNames: string[] = dataset.column_names.map((c: string) => c.toLowerCase());
        const shortIdx = colNames.findIndex(c => c.includes('noncommercial') && c.includes('short'));
        if (shortIdx === -1) return null;
        
        const rows: any[][] = dataset.data;
        if (!rows.length) return null;
        
        const latest = rows[0];
        const latestDate = latest[0] as string;
        const latestShort = latest[shortIdx] as number;
        
        const monthlyHistory: Array<{date: string, value: number}> = [];
        const seenMonths = new Set<string>();
        for (const row of rows) {
          const month = (row[0] as string).substring(0, 7);
          if (!seenMonths.has(month)) {
            seenMonths.add(month);
            monthlyHistory.push({ date: month, value: row[shortIdx] as number });
          }
        }
        monthlyHistory.reverse();
        
        return { value: latestShort, date: latestDate, history: monthlyHistory };
      } catch (e) {
        console.error('[cot] Nasdaq fetch error:', e);
        return null;
      }
    };

    // 層2：CFTC Socrata API (公用、無須金鑰、100%可靠)
    const fetchFromCFTCSocrata = async (): Promise<{ value: number; date: string; history: Array<{date: string, value: number}> } | null> => {
      try {
        const url = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=097741&$order=report_date_as_yyyy_mm_dd DESC&$limit=52';
        const response = await fetchWithTimeout(url, {
          headers: { 'Accept': 'application/json' }
        }, 10000);
        if (!response.ok) return null;
        const records: any[] = await response.json();
        if (!records || !records.length) return null;

        const latest = records[0];
        const latestDate = latest.report_date_as_yyyy_mm_dd?.split('T')[0] ?? '';
        const latestShort = Number(latest.noncomm_positions_short_all || 0);

        const monthlyHistory: Array<{date: string, value: number}> = [];
        const seenMonths = new Set<string>();
        for (const row of records) {
          const fullDate = row.report_date_as_yyyy_mm_dd?.split('T')[0] ?? '';
          if (!fullDate) continue;
          const month = fullDate.substring(0, 7);
          if (!seenMonths.has(month)) {
            seenMonths.add(month);
            monthlyHistory.push({
              date: month,
              value: Number(row.noncomm_positions_short_all || 0)
            });
          }
        }
        monthlyHistory.reverse();

        return { value: latestShort, date: latestDate, history: monthlyHistory };
      } catch (e) {
        console.error('[cot] CFTC Socrata fetch error:', e);
        return null;
      }
    };

    let currentShort: number = 80000;
    let isLive = false;
    let liveDate = '';
    let liveHistory: Array<{date: string, value: number}> = [];
    let dataSource = 'fallback';

    const nasdaqResult = await fetchFromNasdaq();
    if (nasdaqResult) {
      currentShort = nasdaqResult.value;
      liveDate = nasdaqResult.date;
      liveHistory = nasdaqResult.history;
      isLive = true;
      dataSource = 'nasdaq';
      console.log('[cot] Using Nasdaq Data Link source');
    } else {
      const socrataResult = await fetchFromCFTCSocrata();
      if (socrataResult) {
        currentShort = socrataResult.value;
        liveDate = socrataResult.date;
        liveHistory = socrataResult.history;
        isLive = true;
        dataSource = 'cftc';
        console.log('[cot] Using CFTC Socrata API source');
      } else {
        console.log('[cot] All live sources failed, using fallback 80000');
      }
    }

    const VERIFIED_HISTORICAL = [
      { date: '2024-08', contracts: 184223, isVerified: true },
    ];
    
    const ESTIMATED_HISTORICAL = [
      { date: '2024-10', contracts: 140000, isVerified: false },
      { date: '2024-12', contracts: 120000, isVerified: false },
      { date: '2025-02', contracts: 155000, isVerified: false },
      { date: '2025-05', contracts: 130000, isVerified: false },
      { date: '2025-08', contracts: 110000, isVerified: false },
      { date: '2025-11', contracts: 90000,  isVerified: false },
      { date: '2026-02', contracts: 95000,  isVerified: false },
    ];

    let historicalData: Array<{date: string, contracts: number, label: string, isVerified: boolean}>;
    
    if (isLive && liveHistory.length > 3) {
      historicalData = liveHistory.map(h => ({
        date: h.date,
        contracts: h.value,
        label: h.date.replace('-', '年') + '月',
        isVerified: true
      }));
    } else {
      historicalData = [
        ...VERIFIED_HISTORICAL.map(h => ({ ...h, label: h.date.replace('-', '年') + '月' })),
        ...ESTIMATED_HISTORICAL.map(h => ({ ...h, label: h.date.replace('-', '年') + '月（估算）' })),
      ];
    }

    const latestLabel = isLive
      ? `${liveDate.substring(0, 7).replace('-', '年')}月（CFTC Live）`
      : '2026年5月（估算）';
    
    const hasLatest = historicalData.some(h => h.date === liveDate.substring(0, 7));
    if (!hasLatest) {
      historicalData.push({
        date: liveDate.substring(0, 7) || '2026-05',
        contracts: currentShort,
        label: latestLabel,
        isVerified: isLive
      });
    }

    // 動態計算 peak
    let peakShort = 184223;
    let peakDate = '2024-08';
    let isNewAllTimeHigh = false;
    let dangerThreshold = 150000;
    let warningThreshold = 120000;
    let reductionPct = 56.6;
    let riskFromPeak = 43.4;

    if (historicalData && historicalData.length > 0) {
      const currentMonthKey = liveDate ? liveDate.substring(0, 7) : '2026-05';
      
      // 找出除了當前月份之外的最大契約數，代表「歷史舊峰值」
      const historicalWithoutCurrent = historicalData.filter(h => h.date !== currentMonthKey);
      
      let previousPeak = 184223;
      let previousPeakDate = '2024-08';
      
      if (historicalWithoutCurrent.length > 0) {
        let maxHist = historicalWithoutCurrent[0];
        for (const h of historicalWithoutCurrent) {
          if (h.contracts > maxHist.contracts) {
            maxHist = h;
          }
        }
        previousPeak = maxHist.contracts;
        previousPeakDate = maxHist.date;
      }

      // 判斷是否創新高 (當前空單大於歷史舊峰值)
      isNewAllTimeHigh = isLive && (currentShort > previousPeak);

      if (isNewAllTimeHigh) {
        peakShort = currentShort;
        peakDate = currentMonthKey;
        
        // 計算相對於「前歷史峰值」的超限比例
        reductionPct = Number(((previousPeak - currentShort) / previousPeak * 100).toFixed(1));
        riskFromPeak = Number((currentShort / previousPeak * 100).toFixed(1));
      } else {
        let maxAll = historicalData[0];
        for (const h of historicalData) {
          if (h.contracts > maxAll.contracts) {
            maxAll = h;
          }
        }
        peakShort = maxAll.contracts;
        peakDate = maxAll.date;

        reductionPct = Number(((peakShort - currentShort) / peakShort * 100).toFixed(1));
        riskFromPeak = Number((currentShort / peakShort * 100).toFixed(1));
      }

      // 動態門檻 calculation
      dangerThreshold = Math.round(peakShort * 0.81);
      warningThreshold = Math.round(peakShort * 0.65);
    }

    const results = {
      currentShort,
      peakShort,
      peakDate,
      isNewAllTimeHigh,
      reductionPct,
      riskFromPeak,
      historicalData,
      isLive,
      liveDate,
      dataSource,
      dangerThreshold,
      warningThreshold,
      updatedAt: new Date().toISOString()
    };

    cotCache = { data: results, ts: Date.now() };
    res.json(results);
  });

  // 10. Structural Systemic Risk Radar API (FRED + Fallback)
  let structuralCache: { data: any; ts: number; ttl: number } | null = null;
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

  const structuralFallbackData = {
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
    console.warn(`[structural-dev] FCF fallback due to: ${reason}`);
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
                console.warn(`[structural-dev] ${symbol} quoteSummary schema error, using partial result`);
              } else {
                console.error(`[structural-dev] ${symbol} quoteSummary failed:`, err?.message?.substring(0, 100));
                return nullStock(symbol, name);
              }
            }

            if (!summary) return nullStock(symbol, name);

            const fd = summary.financialData;
            const ks = summary.defaultKeyStatistics;

            console.log(`[structural-dev] ${symbol} raw:`, {
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
            console.error(`[structural-dev] FCF fetch error for ${symbol}:`, err);
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

      console.log('[structural-dev] Hyperscaler FCF results:', {
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
      console.error('[structural-dev] fetchHyperscalerFCF error:', err);
      return getFallbackFCF('outer-error');
    }
  }

  async function fetchFredSeries(seriesId: string, limit = 100): Promise<Array<{ date: string; value: number }> | null> {
    const FRED_API_KEY = process.env.FRED_API_KEY;
    if (!FRED_API_KEY) return null;
    try {
      const start = new Date();
      start.setMonth(start.getMonth() - 14);
      const startStr = start.toISOString().split('T')[0];
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${startStr}&limit=${limit}`;
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
      console.error(`[structural-dev] FRED fetch error for ${seriesId}:`, e);
      return null;
    }
  }

  function aggregateMonthly(obs: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
    const monthsMap = new Map<string, number>();
    for (const o of obs) {
      const monthKey = o.date.substring(0, 7);
      monthsMap.set(monthKey, o.value);
    }
    const result = Array.from(monthsMap.entries()).map(([date, value]) => ({ date, value }));
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result.slice(-13);
  }

  app.get('/api/structural', async (req, res) => {
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
    if (structuralCache && Date.now() - structuralCache.ts < (structuralCache.ttl ?? CACHE_TTL_SUCCESS)) {
      return res.json(structuralCache.data);
    }

    const FRED_API_KEY = process.env.FRED_API_KEY;
    if (!FRED_API_KEY) {
      try {
        const fcfData = await fetchHyperscalerFCF();
        const oasSignal = structuralFallbackData.aiCapex.signal;
        const compositeSignal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                                [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
        const signalLabel = compositeSignal === 'green' ? '信用利差與巨頭造血健全' : compositeSignal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';
        
        const copyFallback = JSON.parse(JSON.stringify(structuralFallbackData));
        copyFallback.aiCapex.fcf = fcfData;
        copyFallback.aiCapex.signal = compositeSignal;
        copyFallback.aiCapex.signalLabel = signalLabel;
        copyFallback.updatedAt = new Date().toISOString();
        copyFallback.dataSource = 'mix' as any;

        const fcfSuccess = fcfData.isLive && fcfData.stocks.some(s => s.fcfYield !== null);
        const ttl = fcfSuccess ? CACHE_TTL_SUCCESS : CACHE_TTL_FAIL;
        structuralCache = { data: copyFallback, ts: Date.now(), ttl };

        return res.json(copyFallback);
      } catch (err) {
        console.error('[structural-dev] Failed FCF fetch in no FRED Key fallback:', err);
        return res.json(structuralFallbackData);
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
        fetchFredSeries('BAMLH0A0HYM2'),
        fetchFredSeries('DCOILWTICO'),
        fetchFredSeries('STLFSI2'),      // STLFSI2 replaces STLFSI4
        fetchFredSeries('DRCCLACBS'),
        fetchFredSeries('DRCCLOBS'),     // DRCCLOBS replaces DRSFRMACBS
        fetchFredSeries('UMCSENT'),
        fetchFredSeries('IR')
      ]);

      // 階段 2：Yahoo Finance FCF（獨立執行，不受 FRED timeout 影響）
      // 給 FCF 獨立的 8 秒 deadline
      const fcfData = await Promise.race([
        fetchHyperscalerFCF(),
        new Promise<ReturnType<typeof getFallbackFCF>>(resolve =>
          setTimeout(() => resolve(getFallbackFCF('timeout')), 8000)
        )
      ]);

      let aiCapex: any = structuralFallbackData.aiCapex;
      if (oasRaw && oasRaw.length > 0) {
        const hyOas = oasRaw[oasRaw.length - 1].value;
        const hyOasHistory = aggregateMonthly(oasRaw).map(o => ({ date: o.date, value: o.value }));
        const oasSignal = hyOas < 300 ? 'green' : hyOas <= 500 ? 'yellow' : 'red';
        const signal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                       [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
        const signalLabel = signal === 'green' ? '信用利差與巨頭造血健全' : signal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';

        const monthlyHistory = aggregateMonthly(oasRaw);
        const prevMonthAvg = monthlyHistory.length >= 2
          ? Number(monthlyHistory[monthlyHistory.length - 2].value.toFixed(0))
          : null;

        aiCapex = { hyOas, hyOasHistory, prevMonthAvg, signal, signalLabel, isLive: true, fcf: fcfData };
      } else {
        const oasSignal = structuralFallbackData.aiCapex.signal;
        const signal = [oasSignal, fcfData.compositeSignal].includes('red') ? 'red' :
                       [oasSignal, fcfData.compositeSignal].includes('yellow') ? 'yellow' : 'green';
        const signalLabel = signal === 'green' ? '信用利差與巨頭造血健全' : signal === 'yellow' ? '利差警示/或 Capex 侵蝕 FCF' : '信用危險或 FCF 嚴重惡化';
        aiCapex = {
          ...structuralFallbackData.aiCapex,
          signal,
          signalLabel,
          isLive: true,
          fcf: fcfData
        };
      }

      let geopolitical: any = structuralFallbackData.geopolitical;
      if (wtiRaw && wtiRaw.length > 0) {
        const latestWti = wtiRaw[wtiRaw.length - 1].value;
        const wtiHistory = aggregateMonthly(wtiRaw);
        
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

      let nbfi: any = structuralFallbackData.nbfi;
      if (stressRaw && stressRaw.length > 0) {
        const finStressIndex = stressRaw[stressRaw.length - 1].value;
        const finStressHistory = aggregateMonthly(stressRaw);
        const creditCardDelinquency = ccDelinqRaw && ccDelinqRaw.length > 0 ? ccDelinqRaw[ccDelinqRaw.length - 1].value : 3.20;
        
        const signal = finStressIndex > 1.0 ? 'red' : finStressIndex >= 0 ? 'yellow' : 'green';
        const signalLabel = signal === 'green' ? '流動性充沛' : signal === 'yellow' ? '影子融資壓力' : '信用流動性乾涸';
        nbfi = { finStressIndex, finStressHistory, creditCardDelinquency, signal, signalLabel, isLive: true };
      }

      let kEconomy: any = structuralFallbackData.kEconomy;
      if (sentimentRaw && sentimentRaw.length > 0) {
        const creditCardDelinquency = ccDelinqRaw && ccDelinqRaw.length > 0 ? ccDelinqRaw[ccDelinqRaw.length - 1].value : 3.20;
        const autoDelinquency = autoDelinqRaw && autoDelinqRaw.length > 0 ? autoDelinqRaw[autoDelinqRaw.length - 1].value : 2.40;
        const consumerSentiment = sentimentRaw[sentimentRaw.length - 1].value;
        const consumerSentimentHistory = aggregateMonthly(sentimentRaw);
        
        const signal = creditCardDelinquency > 3.5 ? 'red' : creditCardDelinquency >= 2.5 ? 'yellow' : 'green';
        const signalLabel = signal === 'green' ? '消費基本面健全' : signal === 'yellow' ? 'K型中下階層透支' : '逾期率飆，消費斷崖';
        kEconomy = { creditCardDelinquency, autoDelinquency, consumerSentiment, consumerSentimentHistory, signal, signalLabel, isLive: true };
      }

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

      structuralCache = { data: liveData, ts: Date.now(), ttl };
      return res.json(liveData);

    } catch (error) {
      console.error('[structural-dev] Failed to assemble live FRED data:', error);
      return res.json(structuralFallbackData);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("CRITICAL SERVER ERROR:", err);
});
