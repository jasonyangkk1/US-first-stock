
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

// ── 台股融資靜態備援（TWSE API 完全失敗時的最終保底）──
// 每週手動更新一次即可（正常情況下不會用到，動態 API 已覆蓋）
const TW_MARGIN_FALLBACK = {
  maintenanceRatio: 156.27,      // 整戶融資維持率（%）← 7/14 實際值
  maintenanceRatioIsLive: false,
  marginBalance: 1820.1,         // 融資餘額（億股）
  marginDailyChange: -12.0,      // 單日增減（億股）
  shortBalance: 320.5,           // 融券餘額（億股）
  marginShortRatio: 5.7,         // 融資/融券比（倍）
  date: '2026-07-14',
  isLive: false,
};

// 民國日期字串轉 ISO（'115/07/14' → '2026-07-14'）
function rocDateToIso(dateRaw: string): string | null {
  const parts = dateRaw.split('/');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]);
  if (isNaN(year) || year < 100) return null;
  return `${year + 1911}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

// 產生候選日期序列（台灣時間，往前最多 lookback 個日曆日，跳過週末）
function getCandidateDates(lookback = 6): string[] {
  const nowUtc = new Date();
  const tpeMs  = nowUtc.getTime() + 8 * 60 * 60 * 1000;
  const tpe    = new Date(tpeMs);
  const tpeHour = tpe.getUTCHours();

  // 台灣 18:00 前，當日資料未公布 → 從昨天開始
  // 台灣 18:00 後，當日資料已公布 → 從今天開始
  const startOffset = tpeHour < 18 ? 1 : 0;

  const candidates: string[] = [];
  for (let i = startOffset; i <= startOffset + lookback; i++) {
    const d = new Date(tpeMs - i * 86_400_000);
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue; // 跳過週末
    const y  = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    candidates.push(`${y}${mo}${dd}`);
    if (candidates.length >= 4) break; // 最多嘗試 4 個交易日
  }
  return candidates;
}

// 從 TWSE MI_MARGN selectType=RM 取得整戶融資維持率（%）
// 直接回傳維持率數值與對應日期，或 null（該日無資料）
async function fetchMaintenanceRatioForDate(dateStr: string): Promise<{
  ratio: number;
  isoDate: string;
} | null> {
  try {
    const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${dateStr}&selectType=RM&response=json`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 7000);
    if (!res.ok) return null;

    const json: any = await res.json();
    // stat=OK 且 data 非空才視為有資料
    if (json?.stat !== 'OK' || !Array.isArray(json?.data) || json.data.length === 0) {
      return null;
    }

    // 取最後一列（最新日期）
    const row = json.data[json.data.length - 1];
    // 欄位：[日期, 擔保品現值(千元), 融資金額(千元), 整戶融資維持率(%)]
    const ratioStr  = String(row[3] ?? '').replace(/,/g, '');
    const ratio     = parseFloat(ratioStr);
    const isoDate   = rocDateToIso(String(row[0] ?? '')) ?? dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

    if (isNaN(ratio) || ratio < 50 || ratio > 500) return null; // 合理範圍檢核

    return { ratio, isoDate };
  } catch {
    return null;
  }
}

// 從 TWSE OpenAPI v1 取得融資股數（餘額、增減、融券等）
async function fetchMarginBalance(): Promise<{
  marginBalance: number;
  marginDailyChange: number;
  shortBalance: number;
  marginShortRatio: number | null;
  balanceDate: string | null;
} | null> {
  try {
    const url = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
    if (!res.ok) return null;

    const raw: any[] = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const summary =
      raw.find((r: any) => !r.StockNo || r.StockNo === '合計') ??
      raw[raw.length - 1];

    const parseNum = (s: string | number) =>
      typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

    const marginToday = parseNum(summary.MarginPurchaseTodayBalance);    // 千股
    const marginYest  = parseNum(summary.MarginPurchaseYesterdayBalance); // 千股
    const shortToday  = parseNum(summary.ShortSaleTodayBalance);          // 千股

    const marginBalanceBil = parseFloat((marginToday / 100_000).toFixed(1));
    const marginChangeBil  = parseFloat(((marginToday - marginYest) / 100_000).toFixed(1));
    const shortBalanceBil  = parseFloat((shortToday / 100_000).toFixed(1));
    const msRatio = shortToday > 0
      ? parseFloat((marginToday / shortToday).toFixed(1))
      : null;

    const balanceDate = rocDateToIso(String(summary.Date || ''));

    return {
      marginBalance: marginBalanceBil,
      marginDailyChange: marginChangeBil,
      shortBalance: shortBalanceBil,
      marginShortRatio: msRatio,
      balanceDate,
    };
  } catch {
    return null;
  }
}

// 主函數：並行取得維持率（帶日期回溯）+ 融資股數
async function fetchTwseMarginData() {
  try {
    const candidates = getCandidateDates(6);
    console.log('[sentiment] TWSE RM candidates:', candidates);

    // ── 維持率：依序嘗試候選日期，找到第一個有資料的就停止 ──
    let ratioResult: { ratio: number; isoDate: string } | null = null;
    for (const dateStr of candidates) {
      ratioResult = await fetchMaintenanceRatioForDate(dateStr);
      if (ratioResult) {
        console.log(`[sentiment] TWSE RM OK: ${ratioResult.ratio}% @ ${ratioResult.isoDate} (dateStr=${dateStr})`);
        break;
      }
    }

    // ── 融資股數（餘額/增減）：用 openapi 無日期版本 ──
    const balanceResult = await fetchMarginBalance();

    if (!ratioResult && !balanceResult) {
      console.warn('[sentiment] TWSE: both RM and balance fetch failed');
      return null;
    }

    return {
      // 維持率（動態，最多 lag 1 個交易日）
      maintenanceRatio:       ratioResult?.ratio          ?? TW_MARGIN_FALLBACK.maintenanceRatio,
      maintenanceRatioIsLive: ratioResult != null,         // true = 動態取得
      maintenanceRatioDate:   ratioResult?.isoDate         ?? null,

      // 融資股數（動態）
      marginBalance:          balanceResult?.marginBalance      ?? TW_MARGIN_FALLBACK.marginBalance,
      marginDailyChange:      balanceResult?.marginDailyChange  ?? TW_MARGIN_FALLBACK.marginDailyChange,
      shortBalance:           balanceResult?.shortBalance       ?? TW_MARGIN_FALLBACK.shortBalance,
      marginShortRatio:       balanceResult?.marginShortRatio   ?? TW_MARGIN_FALLBACK.marginShortRatio,

      // 日期：優先用維持率日期，次用融資餘額日期
      date:   ratioResult?.isoDate ?? balanceResult?.balanceDate ?? TW_MARGIN_FALLBACK.date,
      isLive: true,
    };
  } catch (e) {
    console.warn('[sentiment] TWSE margin fetch failed:', (e as Error).message);
    return null;
  }
}

async function fetchSkewFromYahoo(): Promise<{ value: number; change: number } | null> {
  try {
    const skewQuote = await yahooFinance.quote('^SKEW');
    if (!skewQuote) return null;
    const value = skewQuote.regularMarketPrice ?? 141.5;
    const change = skewQuote.regularMarketChangePercent ?? 0;
    return {
      value: parseFloat(value.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
    };
  } catch (e) {
    console.error('[sentiment] Yahoo Finance SKEW fetch failed, using fallback:', (e as Error).message);
    return { value: 141.5, change: 0 };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 5000) {
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

async function getCNNData() {
  try {
    const res = await fetchWithTimeout(CNN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://www.cnn.com/markets/fear-and-greed',
        'Accept': 'application/json'
      }
    }, 5000);
    
    if (res.ok) {
      const data: any = await res.json();
      if (data?.fear_and_greed?.score != null) {
        return {
          value: Math.round(data.fear_and_greed.score),
          label: data.fear_and_greed.rating,
          source: 'cnn'
        };
      }
    }
  } catch (e) {
    console.error('[sentiment] CNN API failed:', e);
  }
  return null;
}

async function calculateSyntheticSentiment() {
  try {
    const [vix, spy, spyChart] = await Promise.all([
      yahooFinance.quote('^VIX'),
      yahooFinance.quote('^GSPC'),
      yahooFinance.chart('^GSPC', { 
        period1: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), 
        interval: '1d' 
      })
    ]);

    let score = 50;
    
    // 1. VIX Contribution (0-20 points)
    // VIX < 12 (Very Greed) -> 20pts, VIX > 35 (Extreme Fear) -> 0pts
    const vixVal = (vix as any).regularMarketPrice || 15;
    const vixScore = Math.max(0, Math.min(20, (30 - vixVal) * 1.5 + 5));
    
    // 2. Momentum Contribution (0-40 points) - Price vs 125d MA
    const quotes = spyChart.quotes || [];
    const ma125 = quotes.slice(-125).reduce((acc: number, q: any) => acc + (q.close || 0), 0) / Math.min(quotes.length, 125);
    const price = spy.regularMarketPrice || ma125;
    const distFromMA = (price / ma125 - 1) * 100; // percent
    // dist > 5% -> Greed, dist < -5% -> Fear
    const momScore = Math.max(0, Math.min(40, (distFromMA + 5) * 4));

    // 3. Short term volatility/change (0-40 points)
    const pc = spy.regularMarketChangePercent || 0;
    const changeScore = Math.max(0, Math.min(40, (pc + 2) * 10));

    score = Math.round(vixScore + momScore + changeScore);
    score = Math.max(0, Math.min(100, score));
    
    let label = 'neutral';
    if (score >= 75) label = 'extreme greed';
    else if (score >= 60) label = 'greed';
    else if (score <= 25) label = 'extreme fear';
    else if (score <= 40) label = 'fear';

    return { value: score, label, source: 'synthetic' };
  } catch (e) {
    console.error('[sentiment] Synthetic calculation failed:', e);
    return { value: 50, label: 'neutral', source: 'default' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const vixPromise          = yahooFinance.quote('^VIX').catch(() => null);
    const skewPromise         = fetchSkewFromYahoo().catch(() => null);
    const cnnDataPromise      = getCNNData();
    const twMarginPromise     = fetchTwseMarginData().catch(() => null);

    const [vixQuote, skewResult, cnnData, twMarginResult] = await Promise.all([
      vixPromise, skewPromise, cnnDataPromise, twMarginPromise
    ]);
    
    let fearAndGreed: any = cnnData;
    if (!fearAndGreed) {
      fearAndGreed = await calculateSyntheticSentiment();
    }

    const vixPrice  = (vixQuote as any)?.regularMarketPrice ?? 15;
    const vixChange = (vixQuote as any)?.regularMarketChangePercent ?? 0;
    const skewPrice = skewResult?.value ?? 141.5;
    const skewChange = skewResult?.change ?? 0;

    res.json({
      vix: { 
        value: vixPrice, 
        change: vixChange 
      },
      skew: {
        value: skewPrice,
        change: skewChange,
        isLive: skewResult !== null && skewResult.value !== 141.5,
      },
      fearAndGreed: {
        ...fearAndGreed,
        updated: new Date().toISOString()
      },
      taiwanMargin: twMarginResult ?? TW_MARGIN_FALLBACK,
    });
  } catch (error) {
    console.error('[sentiment] Handler error:', error);
    res.json({ 
      vix: { value: 15, change: 0 }, 
      fearAndGreed: { value: 50, label: 'neutral', source: 'error', updated: new Date().toISOString() },
      taiwanMargin: TW_MARGIN_FALLBACK,
    });
  }
}
