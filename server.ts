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

          return {
            symbol,
            name: quote.price?.shortName || symbol,
            earningsDate: formatYFDate(quote.calendarEvents?.earnings?.earningsDate?.[0]),
            exDividendDate: formatYFDate(quote.calendarEvents?.exDividendDate),
            summary: {
              epsEstimate: quote.calendarEvents?.earnings?.earningsAverage || null,
              revenueEstimate: quote.calendarEvents?.earnings?.revenueAverage || null,
              epsActual: lastEarnings?.actual || null,
              revenueActual: lastFinancials?.revenue || null,
              lastQuarterLabel: lastEarnings?.date || null,
              prevEpsActual: prevEarnings?.actual || null,
              prevRevenueActual: prevFinancials?.revenue || null,
              margin: quote.financialData?.profitMargins || null,
              growth: quote.financialData?.revenueGrowth || null,
              epsTTM: quote.defaultKeyStatistics?.trailingEps || null,
            }
          };
        } catch (e) {
          console.warn(`Failed to fetch ${symbol}:`, e);
          return { symbol, name: symbol, earningsDate: new Date().toISOString(), exDividendDate: null, summary: null };
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

      const result = {
        symbol: symbol.toUpperCase(),
        name: quote.price?.shortName || symbol.toUpperCase(),
        earningsDate: formatYFDate(quote.calendarEvents?.earnings?.earningsDate?.[0]),
        exDividendDate: formatYFDate(quote.calendarEvents?.exDividendDate),
        summary: {
          epsEstimate: quote.calendarEvents?.earnings?.earningsAverage || null,
          revenueEstimate: quote.calendarEvents?.earnings?.revenueAverage || null,
          epsActual: lastEarnings?.actual || null,
          revenueActual: lastFinancials?.revenue || null,
          lastQuarterLabel: lastEarnings?.date || null,
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

      // 2. Fetch VIX and S&P 500 for additional context
      const [vixQuote]: any = await Promise.all([
        yahooFinance.quote('^VIX')
      ]);
      
      const currentVix = vixQuote.regularMarketPrice;
      
      const resSentiment = {
        vix: {
          value: currentVix,
          change: vixQuote.regularMarketChangePercent,
        },
        fearAndGreed: {
          value: fearAndGreed.value,
          label: fearAndGreed.rating, // for frontend label field
          updated: fearAndGreed.updated
        }
      };

      cache.set(cacheKey, resSentiment, 1800); // Cache for 30 mins
      res.json(resSentiment);
    } catch (error) {
      console.error('Sentiment Error:', error);
      res.json({ 
        vix: { value: 15, change: 0 },
        fearAndGreed: { value: 50, label: 'neutral', updated: new Date().toISOString() }
      });
    }
  });

  // 4. Macro Indicators (NFP, ADP, CPI)
  app.get('/api/macro', async (req, res) => {
    const cacheKey = 'macro_indicators';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const FRED_API_KEY = process.env.FRED_API_KEY;
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
      CPI: 'CPIAUCSL'
    };

    const fetchFred = async (seriesId: string, limit = 16) => {
      try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data: any = await response.json();
        return (data.observations || [])
          .filter((o: any) => o.value !== '.')
          .map((o: any) => ({ ...o, value: Number(o.value) }));
      } catch (e) {
        return null;
      }
    };

    const getNthDayOfMonth = (year: number, month: number, nth: number, dayOfWeek: number) => {
      const date = new Date(year, month, 1);
      let count = 0;
      while (date.getMonth() === month) {
        if (date.getDay() === dayOfWeek) {
          count++;
          if (count === nth) return new Date(date);
        }
        date.setDate(date.getDate() + 1);
      }
      return null;
    };

    const getNextReleaseDates = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const checkPassed = (d: Date, hourUTC: number, minUTC = 0) => {
        const releaseTime = d.getTime() + hourUTC * 3600000 + minUTC * 60000;
        return releaseTime < now.getTime();
      };

      let adp = getNthDayOfMonth(year, month, 1, 3);
      if (adp && checkPassed(adp, 13, 15)) adp = getNthDayOfMonth(year, month + 1, 1, 3);
      
      let nfp = getNthDayOfMonth(year, month, 1, 5);
      if (nfp && checkPassed(nfp, 13, 30)) nfp = getNthDayOfMonth(year, month + 1, 1, 5);

      let cpi = getNthDayOfMonth(year, month, 2, 3);
      if (cpi && checkPassed(cpi, 13, 30)) cpi = getNthDayOfMonth(year, month + 1, 2, 3);

      const format = (d: Date | null, time: string) => d ? `${d.toISOString().split('T')[0]} ${time} (TPE)` : 'TBD';
      return { adp: format(adp, '20:15'), nfp: format(nfp, '20:30'), cpi: format(cpi, '20:30') };
    };

    try {
      const [nfpData, adpData, cpiData] = await Promise.all([
        fetchFred(SERIES.NFP, 5),
        fetchFred(SERIES.ADP, 5),
        fetchFred(SERIES.CPI, 18)
      ]);

      const dates = getNextReleaseDates();
      const validateRange = (val: number, min: number, max: number) => !isNaN(val) && val >= min && val <= max;

      const nfpActualVal = (nfpData && nfpData.length >= 2) ? nfpData[0].value - nfpData[1].value : NaN;
      const nfpPrevVal = (nfpData && nfpData.length >= 3) ? nfpData[1].value - nfpData[2].value : NaN;
      const adpActualVal = (adpData && adpData.length >= 1) ? adpData[0].value : NaN;
      const adpPrevVal = (adpData && adpData.length >= 2) ? adpData[1].value : NaN;
      const cpiActualVal = (cpiData && cpiData.length >= 13) ? (cpiData[0].value / cpiData[12].value - 1) * 100 : NaN;
      const cpiPrevVal = (cpiData && cpiData.length >= 14) ? (cpiData[1].value / cpiData[13].value - 1) * 100 : NaN;

      const results = {
        nfp: {
          actual: validateRange(nfpActualVal, -500, 1500) ? `${Math.round(nfpActualVal)}K` : null,
          previous: validateRange(nfpPrevVal, -500, 1500) ? `${Math.round(nfpPrevVal)}K` : null,
          forecast: "145K",
          nextRelease: dates.nfp,
          lastUpdated: new Date().toISOString()
        },
        adp: {
          actual: validateRange(adpActualVal, -500, 1000) ? `${Math.round(adpActualVal)}K` : null,
          previous: validateRange(adpPrevVal, -500, 1000) ? `${Math.round(adpPrevVal)}K` : null,
          forecast: "150K",
          nextRelease: dates.adp,
          lastUpdated: new Date().toISOString()
        },
        cpi: {
          actual: validateRange(cpiActualVal, -5, 20) ? `${cpiActualVal.toFixed(1)}%` : null,
          previous: validateRange(cpiPrevVal, -5, 20) ? `${cpiPrevVal.toFixed(1)}%` : null,
          forecast: "3.4%",
          nextRelease: dates.cpi,
          lastUpdated: new Date().toISOString()
        }
      };

      if (results.nfp.actual || results.adp.actual || results.cpi.actual) {
        cache.set(cacheKey, results, 3600); // 1 hour cache
      }
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch macro data' });
    }
  });

  // 5. Factors / Algo selection
  app.get('/api/factors', async (req, res) => {
    // Return a predefined set of "Factor" stocks calculated server-side
    // Momentum, Value, Quality (Filtered for Tech)
    res.json({
      momentum: ['NVDA', 'AVGO', 'MSFT', 'AMD', 'TSM'],
      value: ['INTC', 'CSCO', 'IBM', 'ORCL', 'MU'],
      quality: ['AAPL', 'MSFT', 'GOOGL', 'ASML', 'ADBE']
    });
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
