
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from '../_helpers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { symbol } = req.query;
  const ticker = String(symbol).toUpperCase();

  try {
    const quote: any = await yahooFinance.quote(ticker);
    res.json({
      symbol: ticker,
      currentPrice: quote.regularMarketPrice ?? 0,
      change: quote.regularMarketChange ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
    });
  } catch (e) {
    res.status(404).json({ error: 'Not found' });
  }
}
