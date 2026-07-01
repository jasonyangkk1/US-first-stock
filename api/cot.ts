import type { VercelRequest, VercelResponse } from '@vercel/node';

const NASDAQ_API_KEY = process.env.NASDAQ_DATA_LINK_API_KEY; // 免費申請：data.nasdaq.com

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 3600000; // 1小時

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 8000) {
  let timeoutId: any = null;
  let signal: AbortSignal | undefined = undefined;

  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, { ...init, signal: signal ?? init?.signal });
    if (timeoutId) clearTimeout(timeoutId);
    return response;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
}

// 層1：Quandl/Nasdaq Data Link (需要 API Key, 備用)
async function fetchFromNasdaq(): Promise<{ value: number; date: string; history: Array<{date: string, value: number}> } | null> {
  if (!NASDAQ_API_KEY) return null;
  try {
    const url = `https://data.nasdaq.com/api/v3/datasets/CFTC/097741_FO_ALL_CR.json?api_key=${NASDAQ_API_KEY}&rows=52`;
    const res = await fetchWithTimeout(url, undefined, 8000);
    if (!res.ok) return null;
    const json: any = await res.json();
    
    const dataset = json?.dataset;
    if (!dataset?.data || !dataset?.column_names) return null;
    
    const colNames: string[] = dataset.column_names.map((c: string) => c.toLowerCase());
    const shortIdx = colNames.findIndex(c => c.includes('noncommercial') && c.includes('short'));
    if (shortIdx === -1) return null;
    
    const rows: any[][] = dataset.data;
    if (!rows.length) return null;
    
    const latest = rows[0];
    const latestDate = latest[0] as string;
    const latestShort = latest[shortIdx] as number;
    
    const monthlyHistory: Array<{date: string, value: number}> = [];
    const seenMonths = new Set<string>();
    for (const row of rows) {
      const month = (row[0] as string).substring(0, 7);
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        monthlyHistory.push({ date: month, value: row[shortIdx] as number });
      }
    }
    monthlyHistory.reverse();
    
    return { value: latestShort, date: latestDate, history: monthlyHistory };
  } catch (e) {
    console.error('[cot] Nasdaq fetch error:', e);
    return null;
  }
}

// 層2：CFTC Socrata API (公用、無須金鑰、100%可靠)
async function fetchFromCFTCSocrata(): Promise<{ value: number; date: string; history: Array<{date: string, value: number}> } | null> {
  try {
    // 查詢 CME 日圓期貨合約 097741 的投機性空單 (noncomm_positions_short_all)
    const url = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?cftc_contract_market_code=097741&$order=report_date_as_yyyy_mm_dd DESC&$limit=52';
    const res = await fetchWithTimeout(url, {
      headers: { 'Accept': 'application/json' }
    }, 10000);
    if (!res.ok) return null;
    const records: any[] = await res.json();
    if (!records || !records.length) return null;

    const latest = records[0];
    const latestDate = latest.report_date_as_yyyy_mm_dd?.split('T')[0] ?? '';
    const latestShort = Number(latest.noncomm_positions_short_all || 0);

    const monthlyHistory: Array<{date: string, value: number}> = [];
    const seenMonths = new Set<string>();
    for (const row of records) {
      const fullDate = row.report_date_as_yyyy_mm_dd?.split('T')[0] ?? '';
      if (!fullDate) continue;
      const month = fullDate.substring(0, 7);
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        monthlyHistory.push({
          date: month,
          value: Number(row.noncomm_positions_short_all || 0)
        });
      }
    }
    monthlyHistory.reverse();

    return { value: latestShort, date: latestDate, history: monthlyHistory };
  } catch (e) {
    console.error('[cot] CFTC Socrata fetch error:', e);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (cache && Date.now() - cache.ts < CACHE_TTL) return res.json(cache.data);

  let currentShort: number = 80000;
  let isLive = false;
  let liveDate = '';
  let liveHistory: Array<{date: string, value: number}> = [];
  let dataSource = 'fallback';

  // 嘗試層1: Nasdaq Data Link
  const nasdaqResult = await fetchFromNasdaq();
  if (nasdaqResult) {
    currentShort = nasdaqResult.value;
    liveDate = nasdaqResult.date;
    liveHistory = nasdaqResult.history;
    isLive = true;
    dataSource = 'nasdaq';
    console.log('[cot] Using Nasdaq Data Link source');
  } else {
    // 嘗試層2: CFTC Socrata (公用、最穩定)
    const socrataResult = await fetchFromCFTCSocrata();
    if (socrataResult) {
      currentShort = socrataResult.value;
      liveDate = socrataResult.date;
      liveHistory = socrataResult.history;
      isLive = true;
      dataSource = 'cftc';
      console.log('[cot] Using CFTC Socrata API source');
    } else {
      console.log('[cot] All live sources failed, using fallback 80000');
    }
  }

  // 歷史數據 fallback 用的估算值
  const VERIFIED_HISTORICAL = [
    { date: '2024-08', contracts: 184223, isVerified: true },
  ];
  const ESTIMATED_HISTORICAL = [
    { date: '2024-10', contracts: 140000, isVerified: false },
    { date: '2024-12', contracts: 120000, isVerified: false },
    { date: '2025-02', contracts: 155000, isVerified: false },
    { date: '2025-05', contracts: 130000, isVerified: false },
    { date: '2025-08', contracts: 110000, isVerified: false },
    { date: '2025-11', contracts: 90000,  isVerified: false },
    { date: '2026-02', contracts: 95000,  isVerified: false },
  ];

  let historicalData: Array<{date: string, contracts: number, label: string, isVerified: boolean}>;
  if (isLive && liveHistory.length > 3) {
    historicalData = liveHistory.map(h => ({
      date: h.date,
      contracts: h.value,
      label: h.date.replace('-', '年') + '月',
      isVerified: true
    }));
  } else {
    historicalData = [
      ...VERIFIED_HISTORICAL.map(h => ({ ...h, label: h.date.replace('-', '年') + '月' })),
      ...ESTIMATED_HISTORICAL.map(h => ({ ...h, label: h.date.replace('-', '年') + '月（估算）' })),
    ];
  }

  // 加入最新數據點
  const latestLabel = isLive
    ? `${liveDate.substring(0, 7).replace('-', '年')}月（CFTC Live）`
    : '2026年5月（估算）';
  
  // 如果 live 歷史中不重複包含最新點，才加入最新點
  const hasLatest = historicalData.some(h => h.date === liveDate.substring(0, 7));
  if (!hasLatest) {
    historicalData.push({
      date: liveDate.substring(0, 7) || '2026-05',
      contracts: currentShort,
      label: latestLabel,
      isVerified: isLive
    });
  }

  // 動態計算 peak
  let peakShort = 184223;
  let peakDate = '2024-08';
  let isNewAllTimeHigh = false;
  let dangerThreshold = 150000;
  let warningThreshold = 120000;
  let reductionPct = 56.6;
  let riskFromPeak = 43.4;

  if (historicalData && historicalData.length > 0) {
    const currentMonthKey = liveDate ? liveDate.substring(0, 7) : '2026-05';
    
    // 找出除了當前月份之外的最大契約數，代表「歷史舊峰值」
    const historicalWithoutCurrent = historicalData.filter(h => h.date !== currentMonthKey);
    
    let previousPeak = 184223;
    let previousPeakDate = '2024-08';
    
    if (historicalWithoutCurrent.length > 0) {
      let maxHist = historicalWithoutCurrent[0];
      for (const h of historicalWithoutCurrent) {
        if (h.contracts > maxHist.contracts) {
          maxHist = h;
        }
      }
      previousPeak = maxHist.contracts;
      previousPeakDate = maxHist.date;
    }

    // 判斷是否創新高 (當前空單大於歷史舊峰值)
    isNewAllTimeHigh = isLive && (currentShort > previousPeak);

    if (isNewAllTimeHigh) {
      peakShort = currentShort;
      peakDate = currentMonthKey;
      
      // 計算相對於「前歷史峰值」的超限比例
      reductionPct = Number(((previousPeak - currentShort) / previousPeak * 100).toFixed(1));
      riskFromPeak = Number((currentShort / previousPeak * 100).toFixed(1));
    } else {
      let maxAll = historicalData[0];
      for (const h of historicalData) {
        if (h.contracts > maxAll.contracts) {
          maxAll = h;
        }
      }
      peakShort = maxAll.contracts;
      peakDate = maxAll.date;

      reductionPct = Number(((peakShort - currentShort) / peakShort * 100).toFixed(1));
      riskFromPeak = Number((currentShort / peakShort * 100).toFixed(1));
    }

    // 動態門檻 calculation
    dangerThreshold = Math.round(peakShort * 0.81);
    warningThreshold = Math.round(peakShort * 0.65);
  }

  const results = {
    currentShort,
    peakShort,
    peakDate,
    isNewAllTimeHigh,
    reductionPct,
    riskFromPeak,
    historicalData,
    isLive,
    liveDate,
    dataSource,
    dangerThreshold,
    warningThreshold,
    updatedAt: new Date().toISOString()
  };

  cache = { data: results, ts: Date.now() };
  res.json(results);
}
