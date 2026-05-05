
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from '../_helpers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol } = req.query;
  const ticker = String(symbol).toUpperCase();

  try {
    const end = new Date();
    const start = new Date();
    start.setFullYear(end.getFullYear() - 1);
    
    const history: any = await yahooFinance.chart(ticker, {
      period1: start, period2: end, interval: '1d' as any
    });
    
    const quotes = history.quotes || [];
    if (!quotes.length) return res.json({ symbol: ticker, currentPrice: 0, data: [] });

    const data = quotes.map((q: any, i: number) => {
      const slice50 = quotes.slice(Math.max(0, i - 49), i + 1);
      const slice200 = quotes.slice(Math.max(0, i - 199), i + 1);
      return {
        date: q.date,
        close: q.close,
        ma50: slice50.length >= 50 ? slice50.reduce((a: number, c: any) => a + (c.close || 0), 0) / slice50.length : null,
        ma200: slice200.length >= 200 ? slice200.reduce((a: number, c: any) => a + (c.close || 0), 0) / slice200.length : null,
      };
    });

    const lastValidQuote = [...quotes].reverse().find((q: any) => q.close != null);
    res.json({ symbol: ticker, currentPrice: lastValidQuote?.close ?? 0, data: data.slice(-250) });
  } catch (error) {
    res.json({ symbol: ticker, currentPrice: 0, data: [] });
  }
}
