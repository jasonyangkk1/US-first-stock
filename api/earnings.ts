
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance, formatYFDate } from './_helpers.js';

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 600_000; // 10 mins

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA'];
  
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
        return { symbol, name: symbol, earningsDate: new Date().toISOString(), exDividendDate: null, summary: null };
      }
    }));
    
    cache = { data: results, ts: Date.now() };
    res.json(results);
  } catch (error) {
    res.json([]);
  }
}
