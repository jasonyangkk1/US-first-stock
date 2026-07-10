import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

// 每個類群只抓 2-3 個代表股（避免超時）
const SECTOR_REPRESENTATIVES: Record<string, string[]> = {
  'GPU / 加速運算':      ['NVDA', 'AMD'],
  'CPU / 系統算力':      ['AMD', 'INTC'],
  '光通訊 / Data Center': ['COHR', 'ANET'],
  '記憶體 / 存儲':       ['MU', 'WDC'],
  '電力與散熱':          ['VRT', 'SMCI'],
  '客製化 AI 晶片':      ['MRVL', 'KLAC'],
  '邊緣 AI / 工業':      ['NXPI', 'ADI'],
  '雲端 / AI 軟體':      ['MSFT', 'AMZN'],
  'AI 機器人':           ['ISRG', 'ABB'],
  '衛星通訊':            ['ASTS', 'RKLB'],
  '核能 / 潔淨電力':     ['CEG', 'VST'],
};

interface SectorData {
  sector: string;
  avgChange1D: number;           // 類群今日平均漲跌幅（%）
  avgChange5D: number | null;    // 5日均值（用週漲跌幅代理）
  aboveMa50Count: number;        // 代表股中在 50MA 以上的數量
  totalCount: number;            // 代表股總數
  supplyDemandSignal: 'supply_surge' | 'accumulating' | 'balanced' | 'distributing' | 'demand_collapse';
  signalLabel: string;           // 中文訊號標籤
  signalDesc: string;            // 供需說明
  stocks: Array<{
    symbol: string;
    change1D: number;
    aboveMa50: boolean;
    distanceFromHigh: number;    // 距52週高點（%）
  }>;
  isStatic?: boolean;            // true = 靜態 fallback，非即時數據
}

// 靜態 fallback：基於近期市場觀察的保守估算
const STATIC_FALLBACK: SectorData[] = [
  {
    sector: 'GPU / 加速運算', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 2, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。請稍後重新整理以取得即時數據。',
    stocks: [
      { symbol: 'NVDA', change1D: 0, aboveMa50: true, distanceFromHigh: -5 },
      { symbol: 'AMD', change1D: 0, aboveMa50: true, distanceFromHigh: -15 },
    ],
    isStatic: true,
  },
  {
    sector: 'CPU / 系統算力', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。請稍後重新整理以取得即時數據。',
    stocks: [
      { symbol: 'AMD', change1D: 0, aboveMa50: true, distanceFromHigh: -15 },
      { symbol: 'INTC', change1D: 0, aboveMa50: false, distanceFromHigh: -40 },
    ],
    isStatic: true,
  },
  {
    sector: '光通訊 / Data Center', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'COHR', change1D: 0, aboveMa50: true, distanceFromHigh: -10 },
      { symbol: 'ANET', change1D: 0, aboveMa50: true, distanceFromHigh: -8 },
    ],
    isStatic: true,
  },
  {
    sector: '記憶體 / 存儲', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'MU', change1D: 0, aboveMa50: true, distanceFromHigh: -12 },
      { symbol: 'WDC', change1D: 0, aboveMa50: false, distanceFromHigh: -20 },
    ],
    isStatic: true,
  },
  {
    sector: '電力與散熱', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'VRT', change1D: 0, aboveMa50: true, distanceFromHigh: -7 },
      { symbol: 'SMCI', change1D: 0, aboveMa50: false, distanceFromHigh: -60 },
    ],
    isStatic: true,
  },
  {
    sector: '客製化 AI 晶片', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'MRVL', change1D: 0, aboveMa50: true, distanceFromHigh: -10 },
      { symbol: 'KLAC', change1D: 0, aboveMa50: true, distanceFromHigh: -5 },
    ],
    isStatic: true,
  },
  {
    sector: '邊緣 AI / 工業', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'NXPI', change1D: 0, aboveMa50: true, distanceFromHigh: -18 },
      { symbol: 'ADI', change1D: 0, aboveMa50: true, distanceFromHigh: -12 },
    ],
    isStatic: true,
  },
  {
    sector: '雲端 / AI 軟體', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 2, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'MSFT', change1D: 0, aboveMa50: true, distanceFromHigh: -5 },
      { symbol: 'AMZN', change1D: 0, aboveMa50: true, distanceFromHigh: -8 },
    ],
    isStatic: true,
  },
  {
    sector: 'AI 機器人', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'ISRG', change1D: 0, aboveMa50: true, distanceFromHigh: -6 },
      { symbol: 'ABB', change1D: 0, aboveMa50: true, distanceFromHigh: -10 },
    ],
    isStatic: true,
  },
  {
    sector: '衛星通訊', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'ASTS', change1D: 0, aboveMa50: true, distanceFromHigh: -35 },
      { symbol: 'RKLB', change1D: 0, aboveMa50: true, distanceFromHigh: -12 },
    ],
    isStatic: true,
  },
  {
    sector: '核能 / 潔淨電力', avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: 1, totalCount: 2,
    supplyDemandSignal: 'balanced', signalLabel: '⚖️ 供需均衡',
    signalDesc: '數據暫時無法取得，顯示預設狀態。',
    stocks: [
      { symbol: 'CEG', change1D: 0, aboveMa50: true, distanceFromHigh: -10 },
      { symbol: 'VST', change1D: 0, aboveMa50: true, distanceFromHigh: -15 },
    ],
    isStatic: true,
  },
];

async function fetchStockData(symbol: string): Promise<{
  symbol: string;
  price: number;
  changePercent: number;
  ma50: number | null;
  high52w: number | null;
} | null> {
  try {
    // 方法 A：quoteSummary（更穩定）
    const qs: any = await yahooFinance.quoteSummary(symbol, {
      modules: ['price']
    }, {
      fetchOptions: { signal: AbortSignal.timeout(7000) }  // 7 秒超時
    });
    const p = qs?.price;
    if (!p?.regularMarketPrice) return null;
    return {
      symbol,
      price: p.regularMarketPrice,
      changePercent: p.regularMarketChangePercent ?? 0,
      ma50: p.fiftyDayAverage ?? null,
      high52w: p.fiftyTwoWeekHigh ?? null,
    };
  } catch {
    try {
      // 方法 B：quote() 作為 fallback
      const q: any = await yahooFinance.quote(symbol, {}, {
        fetchOptions: { signal: AbortSignal.timeout(7000) }  // 7 秒超時
      });
      if (!q?.regularMarketPrice) return null;
      return {
        symbol,
        price: q.regularMarketPrice,
        changePercent: q.regularMarketChangePercent ?? 0,
        ma50: q.fiftyDayAverage ?? null,
        high52w: q.fiftyTwoWeekHigh ?? null,
      };
    } catch {
      return null;
    }
  }
}

function determineSupplyDemand(avgChange1D: number, aboveMa50Pct: number, avgDistFromHigh: number): {
  signal: SectorData['supplyDemandSignal'];
  label: string;
  desc: string;
} {
  // 供不應求（正在漲價）：今日大漲 + 多數在均線之上 + 距高點近
  if (avgChange1D > 2.0 && aboveMa50Pct >= 0.6) {
    return { 
      signal: 'supply_surge',
      label: '🔥 供不應求',
      desc: '買盤強勁，需求超越供給，機構正在積極加倉。價格可能持續走高。'
    };
  }
  // 積極建倉（預期漲價）：今日上漲 + 技術面健康
  if (avgChange1D > 0.5 && aboveMa50Pct >= 0.5) {
    return {
      signal: 'accumulating',
      label: '📈 積極建倉',
      desc: '資金流入明顯，市場預期未來供給缺口。長線資金正在佈局。'
    };
  }
  // 供過於求（在銷庫存）：今日下跌 + 多數跌破均線
  if (avgChange1D < -2.0 && aboveMa50Pct < 0.4) {
    return {
      signal: 'demand_collapse',
      label: '❄️ 供過於求',
      desc: '需求萎縮，供給過剩，廠商正積極削減庫存。估值修正風險高。'
    };
  }
  // 出貨分散（庫存消化中）：今日下跌 + 技術面轉弱
  if (avgChange1D < -0.5 && aboveMa50Pct < 0.5) {
    return {
      signal: 'distributing',
      label: '📉 出貨消化',
      desc: '機構在相對高位分散持股，庫存去化中。需觀察是否出現承接買盤。'
    };
  }
  // 均衡：
  return {
    signal: 'balanced',
    label: '⚖️ 供需均衡',
    desc: '多空力道相當，市場處於觀望整固階段。等待明確的催化劑驅動。'
  };
}

let cache: { data: SectorData[]; ts: number } | null = null;
const CACHE_TTL = 300_000; // 5分鐘（比其他 API 短，因為需要即時性）

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // 有 cache 且沒過期，直接回傳
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  // 關鍵：不阻礙前端。立刻先回傳備用資料（過期 cache 或靜態 fallback），隨後在背景非同步更新數據。
  const responseData = cache ? cache.data : STATIC_FALLBACK;
  res.json(responseData);

  // 背景更新 cache
  try {
    const allSymbols = [...new Set(Object.values(SECTOR_REPRESENTATIVES).flat())];
    const batchSize = 4;
    const allResults: any[] = [];
    
    // 分批並行，避免高並發導致 Yahoo 阻擋或請求堆積
    for (let i = 0; i < allSymbols.length; i += batchSize) {
      const batch = allSymbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(s => fetchStockData(s)));
      allResults.push(...batchResults);
    }
    
    const stockMap: Record<string, any> = {};
    allSymbols.forEach((s, i) => { if (allResults[i]) stockMap[s] = allResults[i]; });
    
    const sectorData = Object.entries(SECTOR_REPRESENTATIVES).map(([sector, symbols]) => {
      const validData = symbols.map(s => stockMap[s]).filter(Boolean);
      
      const stockDetails = validData.map(d => {
        const aboveMa50 = d.ma50 != null && d.ma50 > 0 && d.price > d.ma50;
        const distFromHigh = d.high52w != null && d.high52w > 0
          ? ((d.price - d.high52w) / d.high52w) * 100
          : 0;
        return {
          symbol: d.symbol,
          change1D: parseFloat(d.changePercent.toFixed(2)),
          aboveMa50,
          distanceFromHigh: parseFloat(distFromHigh.toFixed(1)),
        };
      });
      
      const avgChange1D = stockDetails.length > 0
        ? stockDetails.reduce((sum, item) => sum + item.change1D, 0) / stockDetails.length
        : 0;
      const aboveMa50Count = stockDetails.filter(d => d.aboveMa50).length;
      const aboveMa50Pct = stockDetails.length > 0 ? aboveMa50Count / stockDetails.length : 0.5;
      const avgDistFromHigh = stockDetails.length > 0
        ? stockDetails.reduce((sum, item) => sum + item.distanceFromHigh, 0) / stockDetails.length
        : 0;
      
      const { signal, label, desc } = determineSupplyDemand(avgChange1D, aboveMa50Pct, avgDistFromHigh);
      
      return {
        sector,
        avgChange1D: parseFloat(avgChange1D.toFixed(2)),
        avgChange5D: null,
        aboveMa50Count,
        totalCount: stockDetails.length,
        supplyDemandSignal: signal,
        signalLabel: label,
        signalDesc: desc,
        stocks: stockDetails,
      };
    });
    
    const validSectors = sectorData.filter((s: SectorData) => s.totalCount > 0);
    if (validSectors.length > 0) {
      const sorted = validSectors.sort((a: SectorData, b: SectorData) => b.avgChange1D - a.avgChange1D);
      cache = { data: sorted, ts: Date.now() };
      console.log('[sector-performance] Background cache updated with', sorted.length, 'sectors');
    } else {
      console.warn('[sector-performance] Background update failed: No valid sectors fetched.');
    }
  } catch (err: any) {
    console.warn('[sector-performance] Background update failed:', err?.message);
  }
}
