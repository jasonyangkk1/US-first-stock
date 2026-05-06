
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.json({
    momentum: ['NVDA', 'AVGO', 'MSFT', 'AMD', 'TSM'],
    value: ['INTC', 'CSCO', 'IBM', 'ORCL', 'MU'],
    quality: ['AAPL', 'MSFT', 'GOOGL', 'ASML', 'ADBE']
  });
}
