
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance, formatYFDate, computeQuarterFCF } from '../_helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { symbol } = req.query;
  const ticker = String(symbol).toUpperCase();

  try {
    const quote: any = await yahooFinance.quoteSummary(ticker, {
      modules: ['calendarEvents', 'price', 'earnings', 'financialData', 'defaultKeyStatistics', 'cashflowStatementHistoryQuarterly']
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

    // 單季 FCF 與前一季（與批次 /api/earnings 共用同一套邏輯）
    const fcf = await computeQuarterFCF(ticker, quote);

    res.json({
      symbol: ticker,
      name: quote.price?.shortName || ticker,
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
        quarterFCF: fcf.quarterFCF,
        quarterFCFLabel: fcf.quarterFCFLabel,
        prevQuarterFCF: fcf.prevQuarterFCF,
        prevQuarterFCFLabel: fcf.prevQuarterFCFLabel,
      }
    });
  } catch (error) {
    res.status(404).json({ error: 'Symbol not found' });
  }
}
