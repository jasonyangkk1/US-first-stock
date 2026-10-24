
import YahooFinance from 'yahoo-finance2';

const instance = new YahooFinance({ 
  suppressNotices: ['ripHistorical', 'yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false }
});

export const yahooFinance = instance;

export const formatYFDate = (d: any) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'number') {
    const isMs = d > 100000000000;
    return new Date(isMs ? d : d * 1000).toISOString();
  }
  try {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  } catch {}
  return String(d);
};

/**
 * 計算「單季自由現金流量 FCF」與前一季，供 earnings.ts 與 earnings/[symbol].ts 共用。
 * FCF = 營業現金流 + 資本支出（資本支出在財報中為負值）
 * 來源順序：quoteSummary 的 cashflowStatementHistoryQuarterly → fundamentalsTimeSeries 備援
 */
export async function computeQuarterFCF(symbol: string, quote: any): Promise<{
  quarterFCF: number | null;
  quarterFCFLabel: string | null;
  prevQuarterFCF: number | null;
  prevQuarterFCFLabel: string | null;
}> {
  const toNum = (v: any): number | null => {
    if (v == null) return null;
    const n = typeof v === 'object' ? (v.raw ?? null) : v;
    return typeof n === 'number' && isFinite(n) ? n : null;
  };

  const toLabel = (dateLike: any): string | null => {
    const iso = formatYFDate(dateLike);
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return `${Math.ceil((d.getUTCMonth() + 1) / 3)}Q${d.getUTCFullYear()}`;
  };

  const fcfOf = (row: any): number | null => {
    if (!row) return null;
    const direct = toNum(row.freeCashFlow);
    if (direct != null) return direct;
    const op    = toNum(row.operatingCashflow ?? row.operatingCashFlow);
    const capex = toNum(row.capitalExpenditures ?? row.capitalExpenditure);
    return op != null && capex != null ? op + capex : null;
  };

  let quarterFCF: number | null = null;
  let quarterFCFLabel: string | null = null;
  let prevQuarterFCF: number | null = null;
  let prevQuarterFCFLabel: string | null = null;

  // 1) quoteSummary 的季度現金流量表（Yahoo 通常最新在前）
  const rows = quote?.cashflowStatementHistoryQuarterly?.cashflowStatements || [];
  if (rows[0]) {
    quarterFCF = fcfOf(rows[0]);
    quarterFCFLabel = toLabel(rows[0].endDate);
  }
  if (rows[1]) {
    prevQuarterFCF = fcfOf(rows[1]);
    prevQuarterFCFLabel = toLabel(rows[1].endDate);
  }

  // 2) 備援：fundamentalsTimeSeries（升序，最新在最後）
  if (quarterFCF == null || prevQuarterFCF == null) {
    try {
      const ts: any = await yahooFinance.fundamentalsTimeSeries(symbol, {
        period1: '2024-01-01',
        module: 'cash-flow',
      } as any);
      if (Array.isArray(ts) && ts.length > 0) {
        const last  = ts[ts.length - 1];
        const prev2 = ts.length > 1 ? ts[ts.length - 2] : null;
        if (quarterFCF == null) {
          quarterFCF = fcfOf(last);
          quarterFCFLabel = toLabel(last?.date) ?? quarterFCFLabel;
        }
        if (prevQuarterFCF == null && prev2) {
          prevQuarterFCF = fcfOf(prev2);
          prevQuarterFCFLabel = toLabel(prev2?.date) ?? prevQuarterFCFLabel;
        }
      }
    } catch (e) {
      console.warn(`[earnings] FCF fallback failed for ${symbol}:`, (e as Error).message);
    }
  }

  return { quarterFCF, quarterFCFLabel, prevQuarterFCF, prevQuarterFCFLabel };
}
