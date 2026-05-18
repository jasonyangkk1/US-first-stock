import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const TOP10 = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'NVIDIA' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AVGO', name: 'Broadcom' },
  { symbol: 'BRK-B', name: 'Berkshire' },
  { symbol: 'JPM', name: 'JPMorgan' },
];

const CACHE_VERSION = 'v4';
let cache: { data: any; ts: number; version: string } | null = null;
const CACHE_TTL = 600_000;

function generateBreadthAnalysis(score: number, premium: number, ma50Pct: number, ma200Pct: number): string {
  if (score > 70) {
    return `市場寬度健康，Top10 巨頭中 ${ma50Pct}% 站上50日均線、${ma200Pct}% 站上200日均線，漲勢具備廣泛參與基礎。集中度溢價僅 ${premium.toFixed(1)}%，顯示非巨頭股也有貢獻，牛市結構穩健，短期回調風險相對較低。`;
  }
  if (score > 50) {
    return `市場寬度出現收窄跡象，Top10 中有 ${100 - ma50Pct}% 已跌破50日均線。集中度溢價達 ${premium.toFixed(1)}%，顯示指數漲幅開始集中於少數個股驅動。歷史上此形態若持續 2-3 個月，往往先出現板塊輪動，再演變為較大幅度的指數修正。`;
  }
  if (score > 30) {
    return `市場寬度明顯惡化，Top10 中僅 ${ma50Pct}% 站上50日均線。集中度溢價高達 ${premium.toFixed(1)}%，漲幅高度集中於科技巨頭等少數股票，整體市場抵抗力下降。一旦領頭股出現利空，指數將快速回落。`;
  }
  return `市場寬度極度惡化，Top10 中僅 ${ma50Pct}% 站上50日均線，集中度溢價達 ${premium.toFixed(1)}%，已達歷史性極端水位。2000年科技泡沫頂峰和2021年底均出現類似形態，系統性風險極高。`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();
  
  if (cache && Date.now() - cache.ts < CACHE_TTL && cache.version === CACHE_VERSION) {
    return res.json(cache.data);
  }
  
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Phase 1: 並行抓取所有 quotes
    const stockQuotes = await Promise.all(
      TOP10.map(s => yahooFinance.quote(s.symbol).catch(() => null))
    );
    const sp500Quote = await yahooFinance.quote('^GSPC').catch(() => null);

    // Phase 2: 抓 S&P500 chart (可選，僅用於 3M 報酬參考)
    const sp500Chart = await yahooFinance.chart('^GSPC', {
      period1: ninetyDaysAgo,
      interval: '1d' as any
    }).catch(() => null);

    // Phase 3: 抓 QQQ 和 RSP 的即時報價，比 chart 更快
    const [qqqQuote, rspQuote] = await Promise.all([
      yahooFinance.quote('QQQ').catch(() => null),
      yahooFinance.quote('RSP').catch(() => null),
    ]);

    // 集中度指標：52週漲幅
    const qqqReturn52w = (qqqQuote?.regularMarketPrice && qqqQuote?.fiftyTwoWeekLow)
      ? ((qqqQuote.regularMarketPrice - qqqQuote.fiftyTwoWeekLow) / qqqQuote.fiftyTwoWeekLow) * 100
      : null;
    const rspReturn52w = (rspQuote?.regularMarketPrice && rspQuote?.fiftyTwoWeekLow)
      ? ((rspQuote.regularMarketPrice - rspQuote.fiftyTwoWeekLow) / rspQuote.fiftyTwoWeekLow) * 100
      : null;

    // 集中度溢價 = QQQ 52週漲幅 - RSP 52週漲幅 (正值越高表示越集中)
    const concentrationPremium = (qqqReturn52w !== null && rspReturn52w !== null)
      ? parseFloat((qqqReturn52w - rspReturn52w).toFixed(1))
      : null;

    const concentrationTrend = concentrationPremium !== null
      ? concentrationPremium > 15 ? 'extreme'
        : concentrationPremium > 8 ? 'high'
        : concentrationPremium > 3 ? 'moderate'
        : concentrationPremium > -3 ? 'neutral'
        : 'healthy'
      : 'unknown';

    function calc3MReturn(chart: any): number | null {
      if (!chart?.quotes?.length) return null;
      const quotes = chart.quotes.filter((q: any) => q.close != null);
      if (quotes.length < 5) return null;
      const first = quotes[0].close;
      const last = quotes[quotes.length - 1].close;
      return first > 0 ? ((last - first) / first) * 100 : null;
    }

    const sp500Return3M = calc3MReturn(sp500Chart);

    // 計算指標
    const topStocks = stockQuotes
      .map((q: any, i: number) => {
        if (!q) return null;
        const price = q.regularMarketPrice ?? 0;
        const ma50 = q.fiftyDayAverage ?? 0;
        const ma200 = q.twoHundredDayAverage ?? 0;
        const high52w = q.fiftyTwoWeekHigh ?? price;
        
        // 診斷 Logging
        if (i < 3) {
          console.log(`[breadth] ${TOP10[i].symbol}: price=${price}, ma50=${ma50}, ma200=${ma200}`);
        }

        return {
          symbol: TOP10[i].symbol,
          name: q.shortName || TOP10[i].name,
          changePercent1D: q.regularMarketChangePercent ?? 0,
          changePercent3M: null,
          aboveMa50: (q.fiftyDayAverage != null && q.fiftyDayAverage > 0) ? price > q.fiftyDayAverage : false,
          aboveMa200: (q.twoHundredDayAverage != null && q.twoHundredDayAverage > 0) ? price > q.twoHundredDayAverage : false,
          distanceFromHigh52w: high52w > 0 ? ((price - high52w) / high52w) * 100 : 0,
        };
      })
      .filter(Boolean);

    if (topStocks.length < 5) {
      return res.status(500).json({ error: 'Insufficient stock data' });
    }

    const validCount = topStocks.length;
    const aboveMa50Count = (topStocks as any[]).filter(s => s.aboveMa50).length;
    const aboveMa200Count = (topStocks as any[]).filter(s => s.aboveMa200).length;
    const advancingCount = (topStocks as any[]).filter(s => s.changePercent1D > 0).length;

    const breadthScore = Math.round(
      (aboveMa50Count / validCount) * 40 +
      (aboveMa200Count / validCount) * 30 +
      (advancingCount / validCount) * 30
    );

    const top10AboveMa50Pct = Math.round((aboveMa50Count / validCount) * 100);
    const top10AboveMa200Pct = Math.round((aboveMa200Count / validCount) * 100);

    const top10WeightEstimate = 38.5;

    const breadthSignal = 
      breadthScore > 70 ? 'healthy' :
      breadthScore > 50 ? 'narrowing' :
      breadthScore > 30 ? 'concentrated' : 'extreme_concentration';

    const breadthLabel =
      breadthSignal === 'healthy' ? '健康 (Healthy)' :
      breadthSignal === 'narrowing' ? '收窄 (Narrowing)' :
      breadthSignal === 'concentrated' ? '集中 (Concentrated)' : '極度集中 (Extreme)';

    const riskLevel =
      breadthSignal === 'healthy' ? 'low' :
      breadthSignal === 'narrowing' ? 'medium' :
      breadthSignal === 'concentrated' ? 'high' : 'critical';

    const breadthAnalysisValue = generateBreadthAnalysis(
      breadthScore, 
      concentrationPremium || 0, 
      top10AboveMa50Pct, 
      top10AboveMa200Pct
    );

    const result = {
      concentration: {
        breadthScore,
        concentrationPremium,
        concentrationPremiumLabel: (qqqReturn52w !== null && rspReturn52w !== null)
          ? `QQQ +${qqqReturn52w.toFixed(1)}% vs RSP +${rspReturn52w.toFixed(1)}% (52週漲幅)`
          : null,
        top10WeightEstimate,
        top10Return3M: qqqReturn52w,
        sp500Return3M: sp500Return3M,
        concentrationTrend,
      },
      topStocks,
      breadthSignal,
      breadthLabel,
      breadthAnalysis: breadthAnalysisValue,
      riskLevel,
      top10AboveMa50Pct,
      top10AboveMa200Pct,
      lastUpdated: new Date().toISOString(),
    };
    
    cache = { data: result, ts: Date.now(), version: CACHE_VERSION };
    res.json(result);
  } catch (error: any) {
    console.error('[breadth] Handler error:', error?.message);
    res.status(500).json({ error: 'Failed to calculate market breadth' });
  }
}
