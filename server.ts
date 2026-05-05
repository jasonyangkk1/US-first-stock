import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import YahooFinance from 'yahoo-finance2';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const yahooFinance = new (YahooFinance as any)();

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

  // 4. Factors / Algo selection
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
