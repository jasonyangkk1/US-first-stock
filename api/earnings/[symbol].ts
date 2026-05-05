
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance, formatYFDate } from '../_helpers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol } = req.query;
  const ticker = String(symbol).toUpperCase();

  try {
    const quote: any = await yahooFinance.quoteSummary(ticker, {
      modules: ['calendarEvents', 'price', 'earnings', 'financialData', 'defaultKeyStatistics']
    });
    const quarterlyEarnings = quote.earnings?.earningsChart?.quarterly || [];
    const quarterlyFinancials = quote.earnings?.financialsChart?.quarterly || [];
    const lastEarnings = quarterlyEarnings[quarterlyEarnings.length - 1] || null;
    const lastFinancials = quarterlyFinancials[quarterlyFinancials.length - 1] || null;
    const prevEarnings = quarterlyEarnings[quarterlyEarnings.length - 2] || null;
    const prevFinancials = quarterlyFinancials[quarterlyFinancials.length - 2] || null;

    res.json({
      symbol: ticker,
      name: quote.price?.shortName || ticker,
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
    });
  } catch (error) {
    res.status(404).json({ error: 'Symbol not found' });
  }
}
