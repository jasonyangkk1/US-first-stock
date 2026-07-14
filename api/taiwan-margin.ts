import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── 靜態備援（維持率無法從 TWSE 公開 API 直接取得，每週手動更新）──
// 更新來源：TWSE 官網 → 市場資訊 → 每日融資融券統計 → 整戶維持率
const FALLBACK_MAINTENANCE_RATIO = 153.2; // %
const FALLBACK_DATE = '2026-07-14';

// 融資融券餘額靜態備援（作為 TWSE Live 失敗時的後備）
const FALLBACK = {
  maintenanceRatio: FALLBACK_MAINTENANCE_RATIO,
  maintenanceRatioIsLive: false,         // 維持率永遠來自靜態備援
  marginBalance: 1820.1,                 // 億元
  marginDailyChange: -12.0,              // 億元（正=增加，負=減少）
  shortBalance: 320.5,                   // 融券餘額（億元）
  marginShortRatio: 5.7,                 // 融資/融券比（倍）
  date: FALLBACK_DATE,
  isLive: false,
};

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 小時

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function fetchTwseMarginData() {
  try {
    // TWSE OpenAPI v1 — 不需要日期參數，直接返回最新一日資料
    // 文件：https://openapi.twse.com.tw/#/exchangeReport/get_v1_exchangeReport_MI_MARGN
    const url = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error(`TWSE OpenAPI HTTP ${res.status}`);

    const raw: any[] = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('TWSE OpenAPI 回傳空陣列（假日或盤後資料尚未公布）');
    }

    // OpenAPI v1 回傳的是個股陣列，最後一筆（StockNo === '' 或 '合計'）是合計列
    // 欄位名稱（camelCase）：
    // Date, StockNo, MarginPurchaseBuy, MarginPurchaseSell,
    // MarginPurchaseCashRepayment, MarginPurchaseYesterdayBalance,
    // MarginPurchaseTodayBalance, MarginPurchaseLimit,
    // ShortSaleBuy, ShortSaleSell, ShortSaleCashRepayment,
    // ShortSaleYesterdayBalance, ShortSaleTodayBalance, ShortSaleLimit,
    // OffsetLots, Remarks

    // 找合計列（StockNo 通常是空字串或特殊標記）
    const summary = raw.find((r: any) =>
      r.StockNo === '' || r.StockNo === '合計' || !r.StockNo
    ) ?? raw[raw.length - 1]; // 找不到時用最後一列

    const parseNum = (s: string | number) =>
      typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

    // 融資部分（單位：千股）
    const marginToday = parseNum(summary.MarginPurchaseTodayBalance);    // 今日融資餘額（千股）
    const marginYest  = parseNum(summary.MarginPurchaseYesterdayBalance); // 昨日融資餘額（千股）
    const marginDiff  = marginToday - marginYest;                         // 單日增減（千股）

    // 融券部分（單位：千股）
    const shortToday  = parseNum(summary.ShortSaleTodayBalance);          // 今日融券餘額（千股）

    // 轉換為億股（÷ 100,000）方便顯示
    const marginBalanceBil = parseFloat((marginToday / 100_000).toFixed(1));
    const marginChangeBil  = parseFloat((marginDiff  / 100_000).toFixed(1));
    const shortBalanceBil  = parseFloat((shortToday  / 100_000).toFixed(1));

    // 融資/融券比（倍）
    const msRatio = shortToday > 0
      ? parseFloat((marginToday / shortToday).toFixed(1))
      : null;

    // 日期：從民國年格式轉 ISO（範例：'115/07/14' → '2026-07-14'）
    const dateRaw: string = summary.Date || '';
    let isoDate = FALLBACK_DATE;
    const parts = dateRaw.split('/');
    if (parts.length === 3) {
      const rocYear = parseInt(parts[0]);
      isoDate = `${rocYear + 1911}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
    }

    console.log('[taiwan-margin] Live OK:', {
      date: isoDate,
      marginBalance: marginBalanceBil, marginChange: marginChangeBil,
      shortBalance: shortBalanceBil, msRatio,
    });

    return {
      // 維持率：TWSE 無直接 API，保持靜態備援
      maintenanceRatio: FALLBACK_MAINTENANCE_RATIO,
      maintenanceRatioIsLive: false,
      // 以下為動態取得
      marginBalance: marginBalanceBil,       // 融資餘額（億股）
      marginDailyChange: marginChangeBil,    // 單日增減（億股）
      shortBalance: shortBalanceBil,         // 融券餘額（億股）
      marginShortRatio: msRatio,             // 融資/融券比（倍）
      date: isoDate,
      isLive: true,
    };
  } catch (e) {
    console.warn('[taiwan-margin] TWSE fetch failed:', (e as Error).message);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  const live = await fetchTwseMarginData();
  const data = live ?? FALLBACK;

  if (live) cache = { data, ts: Date.now() };

  return res.json(data);
}
