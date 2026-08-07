import type { VercelRequest, VercelResponse } from '@vercel/node';

const NASDAQ_API_KEY = process.env.NASDAQ_DATA_LINK_API_KEY; // 免費申請：data.nasdaq.com

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 3600000; // 1小時

// ── 台指期外資籌碼靜態備援（每週手動更新） ────────────────────────────
const TW_FOREIGN_FALLBACK = {
  date: '2026-08-07',
  longOI: 30000,          // 外資多頭未平倉口數
  shortOI: 65000,         // 外資空頭未平倉口數
  netOI: -35000,          // 淨部位（負=淨空）
  prevNetOI: -38000,      // 前一交易日淨部位
  peakNetShortOI: 50000,  // 歷史最大淨空單口數（2024-08，取絕對值）
  isLive: false,
};

// 從 FinMind 取台指期外資多空未平倉（主要來源）
async function fetchTWForeignFromFinMind(): Promise<typeof TW_FOREIGN_FALLBACK | null> {
  try {
    // 取最近 5 個交易日，確保有前日資料做比較
    const startDate = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesInstitutionalInvestors&data_id=TX&start_date=${startDate}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 9000);
    if (!res.ok) return null;

    const json: any = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data)) return null;

    // 篩選外資，依日期排序（最新在後）
    const foreignRows = json.data
      .filter((r: any) => r.name === '外資及陸資' || r.name === '外資')
      .sort((a: any, b: any) => a.date.localeCompare(b.date));

    if (foreignRows.length === 0) return null;

    const latest  = foreignRows[foreignRows.length - 1];
    const prev    = foreignRows.length >= 2 ? foreignRows[foreignRows.length - 2] : null;

    const longOI  = Number(latest.long_open_interest  ?? 0);
    const shortOI = Number(latest.short_open_interest ?? 0);
    const netOI   = Number(latest.net_open_interest   ?? (longOI - shortOI));
    const prevNetOI = prev ? Number(prev.net_open_interest ?? 0) : netOI;

    // 合理性驗證
    if (shortOI < 0 || longOI < 0 || Math.abs(netOI) > 300000) return null;

    // 改為追蹤「淨空單峰值」（取 netOI 最負的絕對值）
    const peakNetShortOI = Math.max(
      ...foreignRows.map((r: any) => Math.abs(Math.min(0, Number(r.net_open_interest ?? 0)))),
      TW_FOREIGN_FALLBACK.peakNetShortOI
    );

    console.log(`[cot] TW foreign OK: net=${netOI}, long=${longOI}, short=${shortOI}, date=${latest.date}`);
    return { date: latest.date, longOI, shortOI, netOI, prevNetOI, peakNetShortOI, isLive: true };
  } catch (e) {
    console.warn('[cot] FinMind TW foreign fetch failed:', (e as Error).message);
    return null;
  }
}

// 從 TAIFEX openapi 取台指期外資（備用來源）
async function fetchTWForeignFromTaifex(): Promise<typeof TW_FOREIGN_FALLBACK | null> {
  try {
    const url = 'https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate';
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
    if (!res.ok) return null;

    const raw: any[] = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const row = raw.find((r: any) =>
      (r.ContractCode === '臺股期貨' || r.ContractCode === 'TX' || r.FuturesID === 'TX') &&
      (r.Item === '外資及陸資' || r.Item === '外資' || r.IdentityType === '外資及陸資' || r.IdentityType === '外資')
    );
    if (!row) return null;

    const longOI  = Number(row['OpenInterest(Long)'] ?? row.LongOpenInterest ?? row.long_open_interest ?? 0);
    const shortOI = Number(row['OpenInterest(Short)'] ?? row.ShortOpenInterest ?? row.short_open_interest ?? 0);
    const netOI   = Number(row['OpenInterest(Net)'] ?? (longOI - shortOI));
    const rawDate = String(row.Date ?? '');
    const dateStr = rawDate.length === 8 ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : TW_FOREIGN_FALLBACK.date;

    console.log(`[cot] TAIFEX TW foreign OK: net=${netOI}, date=${dateStr}`);
    return {
      date: dateStr,
      longOI, shortOI, netOI,
      prevNetOI: TW_FOREIGN_FALLBACK.prevNetOI,
      peakNetShortOI: TW_FOREIGN_FALLBACK.peakNetShortOI,
      isLive: true,
    };
  } catch (e) {
    console.warn('[cot] TAIFEX TW foreign fetch failed:', (e as Error).message);
    return null;
  }
}

// 取台指期外資籌碼（主備並行）
async function fetchTWForeignShort(): Promise<typeof TW_FOREIGN_FALLBACK> {
  const result = await fetchTWForeignFromFinMind() ?? await fetchTWForeignFromTaifex();
  return result ?? TW_FOREIGN_FALLBACK;
}

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

  // 並行取台指期外資籌碼
  const twForeign = await fetchTWForeignShort();

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
    twForeign,                          // ← 新增台指期外資籌碼
    updatedAt: new Date().toISOString()
  };

  cache = { data: results, ts: Date.now() };
  res.json(results);
}
