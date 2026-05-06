
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const cnnPromise = fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.cnn.com/markets/fear-and-greed' }
    });
    const vixPromise = yahooFinance.quote('^VIX');

    const [cnnRes, vixQuote] = await Promise.all([cnnPromise, vixPromise]);
    
    let fearAndGreed = { value: 50, label: 'neutral', updated: new Date().toISOString() };
    if (cnnRes.ok) {
      const cnnData: any = await cnnRes.json();
      if (cnnData?.fear_and_greed) {
        fearAndGreed = {
          value: Math.round(cnnData.fear_and_greed.score),
          label: cnnData.fear_and_greed.rating,
          updated: cnnData.fear_and_greed.timestamp || new Date().toISOString()
        };
      }
    }

    res.json({
      vix: { value: vixQuote.regularMarketPrice, change: vixQuote.regularMarketChangePercent },
      fearAndGreed
    });
  } catch (error) {
    res.json({ vix: { value: 15, change: 0 }, fearAndGreed: { value: 50, label: 'neutral', updated: new Date().toISOString() } });
  }
}
