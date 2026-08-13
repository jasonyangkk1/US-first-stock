
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance, formatYFDate } from './_helpers.js';

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

        // ── 單季自由現金流量（FCF）計算 ──
        // 來源：cashflowStatementHistoryQuarterly（季度現金流量表）
        // FCF = 營業現金流 + 資本支出（資本支出本身為負值，等效於相減）
        const qtrlyCashflows = quote.cashflowStatementHistoryQuarterly?.cashflowStatements || [];
        const latestCashflow = qtrlyCashflows.length > 0 ? qtrlyCashflows[0] : null; // Yahoo 通常最新在前
        const prevCashflow   = qtrlyCashflows.length > 1 ? qtrlyCashflows[1] : null; // 前一季

        let quarterFCF: number | null = null;
        let quarterFCFLabel: string | null = null;
        let prevQuarterFCF: number | null = null;
        let prevQuarterFCFLabel: string | null = null;

        if (latestCashflow) {
          // 優先用直接提供的 freeCashFlow，其次用 operatingCashflow + capitalExpenditures 計算
          const rawFCF      = latestCashflow.freeCashFlow          ?? null;
          const rawOpCF     = latestCashflow.operatingCashflow     ?? null;
          const rawCapex    = latestCashflow.capitalExpenditures    ?? null; // 通常為負值

          if (rawFCF != null) {
            quarterFCF = typeof rawFCF === 'object' ? (rawFCF.raw ?? rawFCF) : rawFCF;
          } else if (rawOpCF != null && rawCapex != null) {
            const opCF  = typeof rawOpCF  === 'object' ? (rawOpCF.raw  ?? rawOpCF)  : rawOpCF;
            const capex = typeof rawCapex === 'object' ? (rawCapex.raw ?? rawCapex)  : rawCapex;
            quarterFCF = opCF + capex; // capex 本身為負值，故為 opCF - |capex|
          }

          // 從 endDate 推算季度標籤（例：2026-06-28 → 2Q2026）
          const rawEndDate = latestCashflow.endDate;
          if (rawEndDate) {
            const endDateStr = formatYFDate(rawEndDate);
            if (endDateStr) {
              const month = new Date(endDateStr).getUTCMonth() + 1;
              const year  = new Date(endDateStr).getUTCFullYear();
              quarterFCFLabel = `${Math.ceil(month / 3)}Q${year}`;
            }
          }
        }

        // ── 前一季 FCF（用於 QoQ 對比）──
        if (prevCashflow) {
          const rawFCF   = prevCashflow.freeCashFlow       ?? null;
          const rawOpCF  = prevCashflow.operatingCashflow  ?? null;
          const rawCapex = prevCashflow.capitalExpenditures ?? null;

          if (rawFCF != null) {
            prevQuarterFCF = typeof rawFCF === 'object' ? (rawFCF.raw ?? rawFCF) : rawFCF;
          } else if (rawOpCF != null && rawCapex != null) {
            const opCF  = typeof rawOpCF  === 'object' ? (rawOpCF.raw  ?? rawOpCF)  : rawOpCF;
            const capex = typeof rawCapex === 'object' ? (rawCapex.raw ?? rawCapex)  : rawCapex;
            prevQuarterFCF = opCF + capex;
          }

          const rawPrevDate = prevCashflow.endDate;
          if (rawPrevDate) {
            const prevDateStr = formatYFDate(rawPrevDate);
            if (prevDateStr) {
              const month = new Date(prevDateStr).getUTCMonth() + 1;
              const year  = new Date(prevDateStr).getUTCFullYear();
              prevQuarterFCFLabel = `${Math.ceil(month / 3)}Q${year}`;
            }
          }
        }

        // Yahoo Finance 於 Nov 2024 後在 quoteSummary 的 cashflowStatementHistoryQuarterly 隱藏了部分欄位
        // 若 quarterFCF 為 null，透過 fundamentalsTimeSeries 作備援
        if (quarterFCF == null) {
          try {
            const ts: any = await yahooFinance.fundamentalsTimeSeries(symbol, { period1: '2024-01-01', module: 'cash-flow' });
            if (ts && ts.length > 0) {
              // ts 為升序，最新在最後
              const last: any  = ts[ts.length - 1];
              const prev2: any = ts.length > 1 ? ts[ts.length - 2] : null;

              if (last.freeCashFlow != null) {
                quarterFCF = last.freeCashFlow;
              } else if (last.operatingCashFlow != null && last.capitalExpenditure != null) {
                quarterFCF = last.operatingCashFlow + last.capitalExpenditure;
              }
              if (last.date) {
                const d = new Date(last.date);
                quarterFCFLabel = `${Math.ceil((d.getUTCMonth() + 1) / 3)}Q${d.getUTCFullYear()}`;
              }

              // 前一季備援
              if (prev2 && prevQuarterFCF == null) {
                if (prev2.freeCashFlow != null) {
                  prevQuarterFCF = prev2.freeCashFlow;
                } else if (prev2.operatingCashFlow != null && prev2.capitalExpenditure != null) {
                  prevQuarterFCF = prev2.operatingCashFlow + prev2.capitalExpenditure;
                }
                if (prev2.date) {
                  const d = new Date(prev2.date);
                  prevQuarterFCFLabel = `${Math.ceil((d.getUTCMonth() + 1) / 3)}Q${d.getUTCFullYear()}`;
                }
              }
            }
          } catch {}
        }

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
