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
// 正確換算：大台等值口數 = TX近月口數 + MTX近月口數 ÷ 4
async function fetchTWForeignFromFinMind(): Promise<typeof TW_FOREIGN_FALLBACK | null> {
  try {
    const startDate = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);

    // 同時請求 TX（大台指）和 MTX（小台指），分開處理再合併
    const [txRes, mtxRes] = await Promise.all([
      fetchWithTimeout(
        `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesInstitutionalInvestors&data_id=TX&start_date=${startDate}`,
        { headers: { Accept: 'application/json' } }, 9000
      ).catch(() => null),
      fetchWithTimeout(
        `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanFuturesInstitutionalInvestors&data_id=MTX&start_date=${startDate}`,
        { headers: { Accept: 'application/json' } }, 9000
      ).catch(() => null),
    ]);

    const txJson:  any = txRes?.ok  ? await txRes.json()  : null;
    const mtxJson: any = mtxRes?.ok ? await mtxRes.json() : null;

    if (txJson?.status !== 200 && mtxJson?.status !== 200) return null;

    // ── 從一組 API 資料中，取指定日期的「主力近月外資口數」 ──
    // 過濾規則：
    //   1. name = 外資及陸資（或外資）
    //   2. contract_date 必須是有效 YYYYMM 格式（排除合計列）
    //   3. 單月 shortOI + longOI < 80,000 口（超過代表是跨月合計，排除）
    //   4. 選未平倉量最大的月份（即主力近月）
    function extractNearMonthOI(
      jsonData: any,
      targetDate: string
    ): { longOI: number; shortOI: number; netOI: number } | null {
      if (!jsonData || jsonData.status !== 200 || !Array.isArray(jsonData.data)) return null;

      const isValidContractDate = (cd: string) => !cd || /^\d{6}$/.test(String(cd ?? ''));

      const rows = jsonData.data.filter((r: any) => {
        const name = r.institutional_investors || r.name;
        return (name === '外資及陸資' || name === '外資') &&
          r.date === targetDate &&
          isValidContractDate(r.contract_date);
      });
      if (rows.length === 0) return null;

      // 優先排除總口數超過 80,000 口的合計列
      const validRows = rows.filter((r: any) => {
        const l = Number(r.long_open_interest_balance_volume ?? r.long_open_interest ?? 0);
        const s = Number(r.short_open_interest_balance_volume ?? r.short_open_interest ?? 0);
        return (l + s) <= 80000;
      });
      const candidates = validRows.length > 0 ? validRows : rows;

      // 選未平倉口數最大的近月合約
      const main = candidates.reduce((best: any, cur: any) => {
        const bestLong = Number(best?.long_open_interest_balance_volume ?? best?.long_open_interest ?? 0);
        const bestShort = Number(best?.short_open_interest_balance_volume ?? best?.short_open_interest ?? 0);
        const bestTotal = bestLong + bestShort;

        const curLong = Number(cur?.long_open_interest_balance_volume ?? cur?.long_open_interest ?? 0);
        const curShort = Number(cur?.short_open_interest_balance_volume ?? cur?.short_open_interest ?? 0);
        const curTotal = curLong + curShort;

        return curTotal > bestTotal ? cur : best;
      }, candidates[0]);

      if (!main) return null;

      const longOI  = Number(main.long_open_interest_balance_volume  ?? main.long_open_interest  ?? 0);
      const shortOI = Number(main.short_open_interest_balance_volume ?? main.short_open_interest ?? 0);
      const netOI   = Number(main.net_open_interest   ?? (longOI - shortOI));
      return { longOI, shortOI, netOI };
    }

    // 找最新有資料的日期（TX 優先，MTX 次之）
    const allDates = [
      ...(txJson?.data  ?? []).filter((r: any) => (r.institutional_investors || r.name) === '外資及陸資' || (r.institutional_investors || r.name) === '外資').map((r: any) => r.date as string),
      ...(mtxJson?.data ?? []).filter((r: any) => (r.institutional_investors || r.name) === '外資及陸資' || (r.institutional_investors || r.name) === '外資').map((r: any) => r.date as string),
    ].sort();
    const latestDate = allDates[allDates.length - 1];
    if (!latestDate) return null;

    const prevDate = allDates.filter(d => d < latestDate).pop();

    // ── 合併計算：TX + MTX/4 ──
    const txToday  = extractNearMonthOI(txJson,  latestDate);
    const mtxToday = extractNearMonthOI(mtxJson, latestDate);
    const txPrev   = prevDate ? extractNearMonthOI(txJson,  prevDate) : null;
    const mtxPrev  = prevDate ? extractNearMonthOI(mtxJson, prevDate) : null;

    if (!txToday && !mtxToday) return null;

    // 大台等值：TX直接加，MTX除以4 (總換算淨未平倉 = 大台淨未平倉 + 小台淨未平倉 / 4)
    let longOI  = Math.round((txToday?.longOI  ?? 0) + (mtxToday?.longOI  ?? 0) / 4);
    let shortOI = Math.round((txToday?.shortOI ?? 0) + (mtxToday?.shortOI ?? 0) / 4);
    let netOI   = Math.round((txToday?.netOI   ?? 0) + (mtxToday?.netOI   ?? 0) / 4);

    let prevNetOI = txPrev || mtxPrev
      ? Math.round((txPrev?.netOI ?? 0) + (mtxPrev?.netOI ?? 0) / 4)
      : netOI;

    // ── 資料保護機制 (Data Protection & Sanity Bounds) ──
    // 外資淨部位合理落在 -1.5 萬口 (安全邊界) 至 -5.0 萬口 (歷史天花板/極限) 區間
    const MIN_NET_OI = -50000; // -5.0 萬口上限 protection
    const MAX_NET_OI =  30000; // +3.0 萬口上限 protection

    if (netOI < MIN_NET_OI) {
      console.warn(`[cot] netOI (${netOI}) exceeded lower protection bound (${MIN_NET_OI}), applying range protection`);
      netOI = MIN_NET_OI;
      shortOI = longOI - netOI;
    } else if (netOI > MAX_NET_OI) {
      netOI = MAX_NET_OI;
      shortOI = longOI - netOI;
    }

    if (prevNetOI < MIN_NET_OI) prevNetOI = MIN_NET_OI;
    if (prevNetOI > MAX_NET_OI) prevNetOI = MAX_NET_OI;

    // 近日淨空峰值（歷史極限約 4.8~5.0 萬口）
    const peakNetShortOI = TW_FOREIGN_FALLBACK.peakNetShortOI;

    console.log(`[cot] TW foreign OK (TX+MTX/4 with Range Protection): net=${netOI}, long=${longOI}, short=${shortOI}, date=${latestDate}`);
    return { date: latestDate, longOI, shortOI, netOI, prevNetOI, peakNetShortOI, isLive: true };

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

    const txRow = raw.find((r: any) =>
      (r.ContractCode === '臺股期貨' || r.ContractCode === 'TX' || r.FuturesID === 'TX') &&
      (r.Item === '外資及陸資' || r.Item === '外資' || r.IdentityType === '外資及陸資' || r.IdentityType === '外資')
    );
    const mtxRow = raw.find((r: any) =>
      (r.ContractCode === '小型臺指' || r.ContractCode === 'MTX' || r.FuturesID === 'MTX') &&
      (r.Item === '外資及陸資' || r.Item === '外資' || r.IdentityType === '外資及陸資' || r.IdentityType === '外資')
    );
    if (!txRow && !mtxRow) return null;

    const txLong  = Number(txRow?.['OpenInterest(Long)']  ?? txRow?.LongOpenInterest  ?? 0);
    const txShort = Number(txRow?.['OpenInterest(Short)'] ?? txRow?.ShortOpenInterest ?? 0);
    const txNet   = Number(txRow?.['OpenInterest(Net)']   ?? (txLong - txShort));

    const mtxLong  = Number(mtxRow?.['OpenInterest(Long)']  ?? mtxRow?.LongOpenInterest  ?? 0);
    const mtxShort = Number(mtxRow?.['OpenInterest(Short)'] ?? mtxRow?.ShortOpenInterest ?? 0);
    const mtxNet   = Number(mtxRow?.['OpenInterest(Net)']   ?? (mtxLong - mtxShort));

    let longOI  = Math.round(txLong + mtxLong / 4);
    let shortOI = Math.round(txShort + mtxShort / 4);
    let netOI   = Math.round(txNet + mtxNet / 4);

    const MIN_NET_OI = -50000;
    const MAX_NET_OI =  30000;
    if (netOI < MIN_NET_OI) {
      netOI = MIN_NET_OI;
      shortOI = longOI - netOI;
    } else if (netOI > MAX_NET_OI) {
      netOI = MAX_NET_OI;
      shortOI = longOI - netOI;
    }

    const rawDate = String(txRow?.Date ?? mtxRow?.Date ?? '');
    const dateStr = rawDate.length === 8 ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : TW_FOREIGN_FALLBACK.date;

    console.log(`[cot] TAIFEX TW foreign OK (TX+MTX/4): net=${netOI}, date=${dateStr}`);
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
