import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

// 每個類群只抓 2 個代表股（減少並發量，避免 Yahoo Finance IP 阻擋）
const SECTOR_REPRESENTATIVES: Record<string, string[]> = {
  'GPU / 加速運算':        ['NVDA', 'AMD'],
  '光通訊 / Data Center':  ['COHR', 'ANET'],
  '記憶體 / 存儲':         ['MU', 'WDC'],
  '電力與散熱':            ['VRT', 'SMCI'],
  '客製化 AI 晶片':        ['MRVL', 'KLAC'],
  '邊緣 AI / 工業':        ['NXPI', 'ADI'],
  '雲端 / AI 軟體':        ['MSFT', 'AMZN'],
  'AI 機器人':             ['ISRG', 'ABB'],
  '衛星通訊':              ['ASTS', 'RKLB'],
  '核能 / 潔淨電力':       ['CEG', 'VST'],
  'CPU / 系統算力':        ['AMD', 'INTC'],
};

interface SectorData {
  sector: string;
  avgChange1D: number;
  avgChange5D: number | null;
  aboveMa50Count: number;
  totalCount: number;
  supplyDemandSignal: 'supply_surge' | 'accumulating' | 'balanced' | 'distributing' | 'demand_collapse';
  signalLabel: string;
  signalDesc: string;
  stocks: Array<{
    symbol: string;
    change1D: number;
    aboveMa50: boolean;
    distanceFromHigh: number;
  }>;
  isStatic?: boolean;
}

// ── 靜態 fallback ──────────────────────────────────────────────────────────
function makeStaticSector(sector: string, symbols: string[]): SectorData {
  return {
    sector,
    avgChange1D: 0, avgChange5D: null,
    aboveMa50Count: Math.ceil(symbols.length / 2),
    totalCount: symbols.length,
    supplyDemandSignal: 'balanced',
    signalLabel: '⚖️ 供需均衡',
    signalDesc: '即時數據暫時無法取得，顯示預設狀態。請稍後重新整理。',
    stocks: symbols.map(sym => ({
      symbol: sym, change1D: 0, aboveMa50: true, distanceFromHigh: -10,
    })),
    isStatic: true,
  };
}

const STATIC_FALLBACK: SectorData[] = Object.entries(SECTOR_REPRESENTATIVES)
  .map(([sector, symbols]) => makeStaticSector(sector, symbols));

// ── 帶 timeout 的單股 fetch（只用最簡單的 quote API）───────────────────────
async function fetchQuoteWithTimeout(symbol: string, timeoutMs = 6000): Promise<{
  symbol: string;
  changePercent: number;
  price: number;
  ma50: number | null;
  high52w: number | null;
} | null> {
  // 自訂 timeout：不依賴 AbortSignal.timeout（相容性最好）
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<null>(resolve => {
    timerId = setTimeout(() => resolve(null), timeoutMs);
  });

  const fetchPromise = (async () => {
    try {
      // 只用 quote()，是最穩定的 Yahoo Finance API
      const q: any = await yahooFinance.quote(symbol);
      if (!q?.regularMarketPrice) return null;
      if (timerId) clearTimeout(timerId);
      return {
        symbol,
        changePercent: q.regularMarketChangePercent ?? 0,
        price: q.regularMarketPrice,
        ma50: q.fiftyDayAverage ?? null,
        high52w: q.fiftyTwoWeekHigh ?? null,
      };
    } catch {
      if (timerId) clearTimeout(timerId);
      return null;
    }
  })();

  const result = await Promise.race([fetchPromise, timeoutPromise]);
  if (timerId) clearTimeout(timerId);
  return result;
}

// ── 供需訊號判斷 ────────────────────────────────────────────────────────────
function determineSupplyDemand(avgChange1D: number, aboveMa50Pct: number): {
  signal: SectorData['supplyDemandSignal'];
  label: string;
  desc: string;
} {
  if (avgChange1D > 2.0 && aboveMa50Pct >= 0.6) {
    return {
      signal: 'supply_surge', label: '🔥 供不應求',
      desc: '買盤強勁，需求超越供給，機構正在積極加倉。',
    };
  }
  if (avgChange1D > 0.5 && aboveMa50Pct >= 0.5) {
    return {
      signal: 'accumulating', label: '📈 積極建倉',
      desc: '資金流入明顯，市場預期未來供給缺口，長線資金正在佈局。',
    };
  }
  if (avgChange1D < -2.0 && aboveMa50Pct < 0.4) {
    return {
      signal: 'demand_collapse', label: '❄️ 供過於求',
      desc: '需求萎縮，供給過剩，廠商積極削減庫存，估值修正風險高。',
    };
  }
  if (avgChange1D < -0.5 && aboveMa50Pct < 0.5) {
    return {
      signal: 'distributing', label: '📉 出貨消化',
      desc: '機構在相對高位分散持股，庫存去化中，需觀察承接買盤。',
    };
  }
  return {
    signal: 'balanced', label: '⚖️ 供需均衡',
    desc: '多空力道相當，市場處於觀望整固階段，等待明確催化劑。',
  };
}

// ── Module-level cache（在同一 warm instance 內有效）────────────────────────
let cache: { data: SectorData[]; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 分鐘

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 最外層 try/catch：確保永遠回傳有效 JSON，絕不回傳 500
  try {
    // Cache 命中（同一 warm instance 內）
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return res.json(cache.data);
    }

    // ── 同步等待所有資料（修正核心：不再「先回傳再背景更新」）──
    const allSymbols = [...new Set(Object.values(SECTOR_REPRESENTATIVES).flat())];

    // 分批並行（每批 3 個），控制對 Yahoo Finance 的並發量
    const BATCH_SIZE = 3;
    const stockMap: Record<string, any> = {};

    for (let i = 0; i < allSymbols.length; i += BATCH_SIZE) {
      const batch = allSymbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(sym => fetchQuoteWithTimeout(sym, 5000))
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) {
          stockMap[batch[idx]] = r.value;
        }
      });
      // 批次間短暫等待，減輕 Yahoo Finance 節流壓力
      if (i + BATCH_SIZE < allSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const successCount = Object.keys(stockMap).length;
    console.log(`[sector-performance] Fetched ${successCount}/${allSymbols.length} symbols`);

    // 如果完全取不到資料，使用靜態 fallback
    if (successCount === 0) {
      console.warn('[sector-performance] All Yahoo Finance fetches failed, returning static fallback');
      return res.json(STATIC_FALLBACK);
    }

    // 組合各類群資料
    const sectorData: SectorData[] = Object.entries(SECTOR_REPRESENTATIVES).map(([sector, symbols]) => {
      const validData = symbols.map(s => stockMap[s]).filter(Boolean);

      if (validData.length === 0) {
        // 該類群無資料，用靜態備援
        return makeStaticSector(sector, symbols);
      }

      const stockDetails = validData.map((d: any) => {
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

      const avgChange1D = stockDetails.reduce((s, i) => s + i.change1D, 0) / stockDetails.length;
      const aboveMa50Count = stockDetails.filter(d => d.aboveMa50).length;
      const aboveMa50Pct = aboveMa50Count / stockDetails.length;

      const { signal, label, desc } = determineSupplyDemand(avgChange1D, aboveMa50Pct);

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
        // isStatic 故意不加：有拿到數據就是 live
      };
    });

    // 按今日漲跌排序
    const sorted = sectorData.sort((a, b) => b.avgChange1D - a.avgChange1D);

    // 更新 cache
    cache = { data: sorted, ts: Date.now() };
    console.log(`[sector-performance] Cache updated: ${sorted.length} sectors`);

    return res.json(sorted);

  } catch (err: any) {
    // 最終安全網：任何未預期錯誤，回傳靜態備援（絕不回傳 500）
    console.error('[sector-performance] Unexpected handler error:', err?.message ?? err);
    return res.json(STATIC_FALLBACK);
  }
}
