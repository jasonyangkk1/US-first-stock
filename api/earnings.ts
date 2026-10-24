
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance, formatYFDate, computeQuarterFCF } from './_helpers.js';

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 600_000; // 10 mins

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  const isValidFutureDate = (dateStr: string | null): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    return date.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
  };

  const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA'];
  
  try {
    const results = [];
    for (const symbol of symbols) {
      try {
        const quote: any = await yahooFinance.quoteSummary(symbol, {
          modules: ['calendarEvents', 'price', 'earnings', 'financialData', 'defaultKeyStatistics', 'cashflowStatementHistoryQuarterly']
        });
        const quarterlyEarnings = quote.earnings?.earningsChart?.quarterly || [];
        const quarterlyFinancials = quote.earnings?.financialsChart?.quarterly || [];
        const lastEarnings = quarterlyEarnings[quarterlyEarnings.length - 1] || null;
        const lastFinancials = quarterlyFinancials[quarterlyFinancials.length - 1] || null;
        const prevEarnings = quarterlyEarnings[quarterlyEarnings.length - 2] || null;
        const prevFinancials = quarterlyFinancials[quarterlyFinancials.length - 2] || null;

        // 單季 FCF 與前一季（共用函數，與 /api/earnings/[symbol] 同一套邏輯）
        const { quarterFCF, quarterFCFLabel, prevQuarterFCF, prevQuarterFCFLabel } =
          await computeQuarterFCF(symbol, quote);

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

        results.push({
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
            // 單季自由現金流量（美元）
            // 來源：cashflowStatementHistoryQuarterly 最新一季
            // FCF = 營業現金流 + 資本支出（資本支出為負值）
            quarterFCF,
            quarterFCFLabel,
            prevQuarterFCF,
            prevQuarterFCFLabel,
          }
        });
      } catch (e: any) {
        console.error(`[earnings] Failed to fetch ${symbol}:`, e?.message || e);
        results.push({ symbol, name: symbol, earningsDate: null, earningsDateStatus: 'unknown', exDividendDate: null, summary: null });
      }
      // Small delay between requests to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }
    
    cache = { data: results, ts: Date.now() };
    res.json(results);
  } catch (error) {
    res.json([]);
  }
}
