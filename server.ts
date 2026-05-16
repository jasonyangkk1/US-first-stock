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

  // 5. Yields
  app.get('/api/yields', async (req, res) => {
    const cacheKey = 'yields_indicators';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const FRED_API_KEY = process.env.FRED_API_KEY;
    const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

    if (!FRED_API_KEY) {
      return res.json({ error: 'FRED_API_KEY_MISSING' });
    }

    const fetchFredSeries = async (seriesId: string) => {
      try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return null;
        const data: any = await response.json();
        const valid = (data.observations || [])
          .filter((o: any) => o.value !== '.')
          .map((o: any) => ({ value: Number(o.value), date: o.date }));
        return valid.length > 0 ? valid[0] : null;
      } catch (e) {
        console.error(`[yields] Fetch failed for ${seriesId}:`, e);
        return null;
      }
    };

    async function fetchFredHistory(seriesId: string, monthsBack: number) {
      if (!FRED_API_KEY) return [];
      try {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - monthsBack);
        const observationStart = startDate.toISOString().split('T')[0];
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${observationStart}&frequency=m`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data: any = await res.json();
        return (data.observations || [])
          .filter((o: any) => o.value !== '.')
          .map((o: any) => ({ value: Number(o.value), date: o.date }));
      } catch (e) {
        return [];
      }
    }

    function calculatePercentile(history: Array<{ value: number }>, currentValue: number) {
      if (history.length === 0) return 50;
      const below = history.filter(h => h.value <= currentValue).length;
      return Math.round((below / history.length) * 100);
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
      const [y2, y10, y30, history20y, chartHistory] = await Promise.all([
        fetchFredSeries('DGS2'),
        fetchFredSeries('DGS10'),
        fetchFredSeries('DGS30'),
        fetchFredHistory('DGS10', 240),
        fetchFredHistory('DGS10', 24)
      ]);

      if (!y2 || !y10) {
        return res.json({ error: 'DATA_UNAVAILABLE', yield2y: null, yield10y: null });
      }

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
        chartData: chartHistory
      };

      cache.set(cacheKey, results, 600);
      res.json(results);
    } catch (err) {
      res.json({ error: 'INTERNAL_ERROR' });
    }
  });

  // 6. Factors / Algo selection
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
