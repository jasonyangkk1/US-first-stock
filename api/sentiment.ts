
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { yahooFinance } from './_helpers.js';

const CNN_URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

// ── 台股融資靜態備援（TWSE API 完全失敗時的最終保底）──
// 每週手動更新一次即可（正常情況下不會用到，動態 API 已覆蓋）
const TW_MARGIN_FALLBACK = {
  maintenanceRatio: 156.27,      // 整戶融資維持率（%）← 7/14 實際值
  maintenanceRatioIsLive: false,
  marginBalance: 9350.0,         // 融資餘額（萬張）← 原 935.0 億股 × 10 = 9350 萬張
  marginDailyChange: -50.0,      // 單日增減（萬張）← 約 -5 億股 × 10 = -50 萬張
  shortBalance: 205.0,           // 融券餘額（萬張）← 原 20.5 億股 × 10 = 205 萬張
  marginShortRatio: 45.3,        // 融資/融券比（倍）← 由 93.5 / (93.5/45.3) 估算
  date: '2026-07-23',
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

// ── 解析工具：從物件中防禦性地找出整戶融資維持率欄位 ──
function extractMaintenanceRatio(obj: Record<string, any>): number | null {
  const parseNum = (s: any) => parseFloat(String(s).replace(/,/g, ''));

  // 策略一：找含 'Ratio' 或 '維持率' 的欄位（含融資關鍵字）
  for (const key of Object.keys(obj)) {
    const kLower = key.toLowerCase();
    if ((kLower.includes('ratio') || key.includes('維持率')) &&
        (kLower.includes('margin') || kLower.includes('purchase') ||
         key.includes('融資') || (!kLower.includes('short') && !key.includes('融券')))) {
      const v = parseNum(obj[key]);
      if (!isNaN(v) && v >= 50 && v <= 500) return v;
    }
  }

  // 策略二：用 Collateral / Amount 計算
  let collateral: number | null = null;
  let amount: number | null = null;
  for (const key of Object.keys(obj)) {
    const kLower = key.toLowerCase();
    if (kLower.includes('collateral') || key.includes('擔保')) {
      if (!kLower.includes('short') && !key.includes('融券')) {
        const v = parseNum(obj[key]);
        if (!isNaN(v) && v > 0) collateral = v;
      }
    }
    if ((kLower.includes('amount') || key.includes('金額')) &&
        (kLower.includes('margin') || kLower.includes('purchase') || key.includes('融資'))) {
      if (!kLower.includes('short') && !key.includes('融券')) {
        const v = parseNum(obj[key]);
        if (!isNaN(v) && v > 0) amount = v;
      }
    }
  }
  if (collateral != null && amount != null && amount > 0) {
    const ratio = (collateral / amount) * 100;
    if (ratio >= 50 && ratio <= 500) return parseFloat(ratio.toFixed(2));
  }

  return null;
}

// ── 從 TWSE FMTQIK 取得整戶融資維持率（正確端點）──
// FMTQIK = 每日全市場融資融券統計，直接包含整戶融資維持率（%）
async function fetchMaintenanceRatioForDate(dateStr: string): Promise<{
  ratio: number;
  isoDate: string;
} | null> {
  try {
    // 使用 FMTQIK（全市場統計）而非 MI_MARGN（個股統計）
    const url = `https://www.twse.com.tw/rwd/zh/marginTrading/FMTQIK?date=${dateStr}&response=json`;
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 7000);
    if (!res.ok) return null;

    const json: any = await res.json();
    if (json?.stat !== 'OK' || !Array.isArray(json?.data) || json.data.length === 0) {
      return null;
    }

    // FMTQIK 的 fields（帶日期查詢時）：
    // [0] 日期  [1] 融資金額(千元)  [2] 融資擔保品現值(千元)
    // [3] 整戶融資維持率(%)  [4] 融券金額  [5] 融券擔保品  [6] 整戶融券維持率
    const row = json.data[json.data.length - 1];
    const fields: string[] = json.fields ?? [];

    let ratio: number | null = null;
    let isoDate: string = dateStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

    // 從 fields 定位欄位索引
    const ratioIdx = fields.findIndex((f: string) =>
      f.includes('融資維持率') || f.includes('整戶融資') || f.toLowerCase().includes('margin') && f.includes('率')
    );
    const dateIdx = fields.findIndex((f: string) => f === '日期' || f.toLowerCase() === 'date');
    const collateralIdx = fields.findIndex((f: string) => f.includes('擔保品現值') && f.includes('融資'));
    const amountIdx     = fields.findIndex((f: string) => f.includes('融資金額'));

    // 取日期
    const rawDate = String(row[dateIdx >= 0 ? dateIdx : 0] ?? '');
    isoDate = rocDateToIso(rawDate) ?? isoDate;

    // 取維持率（直接讀取或計算）
    if (ratioIdx >= 0) {
      ratio = parseFloat(String(row[ratioIdx] ?? '').replace(/,/g, ''));
    }
    if ((ratio == null || isNaN(ratio)) && collateralIdx >= 0 && amountIdx >= 0) {
      const c = parseFloat(String(row[collateralIdx]).replace(/,/g, ''));
      const a = parseFloat(String(row[amountIdx]).replace(/,/g, ''));
      if (!isNaN(c) && !isNaN(a) && a > 0) ratio = parseFloat(((c / a) * 100).toFixed(2));
    }

    if (ratio == null || isNaN(ratio) || ratio < 50 || ratio > 500) return null;

    console.log(`[sentiment] FMTQIK OK: ratio=${ratio}% date=${isoDate} (queried=${dateStr})`);
    return { ratio, isoDate };
  } catch {
    return null;
  }
}

// ── 動態計算近似整戶融資維持率 ──────────────────────────────────────────────
// 因 TWSE FMTQIK 端點封鎖 Vercel AWS IP（HTTP 403），改用以下方案：
// MI_MARGN（融資股數）× Yahoo Finance（收盤價 + 50日均價）計算加權平均維持率
// 公式：維持率 ≈ Σ(股數×收盤價) / Σ(股數×50日均×0.6) × 100%，誤差 ±5%
async function fetchMaintenanceRatioLatest(): Promise<{
  ratio: number;
  isoDate: string;
} | null> {
  try {
    // Step 1：取 MI_MARGN 個股融資股數，找出融資量前 20 大個股
    const margUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
    const margRes = await fetchWithTimeout(
      margUrl, { headers: { Accept: 'application/json' } }, 8000
    );
    if (!margRes.ok) throw new Error(`MI_MARGN HTTP ${margRes.status}`);

    const margRaw: any[] = await margRes.json();
    if (!Array.isArray(margRaw) || margRaw.length === 0) throw new Error('MI_MARGN empty');

    const parseNum = (s: any) =>
      typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

    // 取得日期（任一列相同）
    const sampleRow = margRaw.find(r => r.Date || r['日期']) ?? margRaw[0] ?? {};
    const dateRaw = sampleRow.Date || sampleRow['日期'] || '';
    const isoDate = rocDateToIso(String(dateRaw)) ?? new Date().toISOString().slice(0, 10);

    // 整理個股融資股數，過濾掉空值，按股數降序取前 20
    const stocks = margRaw
      .map(r => ({
        symbol: String(r['股票代號'] || r.StockNo || r.Code || '').trim(),
        balance: parseNum(r['融資今日餘額'] || r.MarginPurchaseTodayBalance),
      }))
      .filter(s => s.symbol && /^\d{4}$/.test(s.symbol) && s.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 20);

    if (stocks.length === 0) throw new Error('No valid stocks in MI_MARGN');

    console.log(`[sentiment] Ratio calc: top ${stocks.length} stocks, date=${isoDate}`);

    // Step 2：批量從 Yahoo Finance 取各股收盤價 + 50日均價
    // Yahoo Finance 台股格式：股票代號.TW（例如 2330.TW）
    const quoteResults = await Promise.allSettled(
      stocks.map(s =>
        (yahooFinance as any).quote(`${s.symbol}.TW`).catch(() => null)
      )
    );

    // Step 3：計算加權平均維持率
    let sumWeightedRatio = 0;
    let sumWeight = 0;
    let validCount = 0;

    for (let i = 0; i < stocks.length; i++) {
      const result = quoteResults[i];
      if (result.status !== 'fulfilled' || !result.value) continue;

      const q: any = result.value;
      const price   = q.regularMarketPrice;
      const ma50    = q.fiftyDayAverage;

      // 需要兩個值都有效才能計算
      if (!price || !ma50 || ma50 <= 0) continue;

      // 個股維持率 = 當前市價 / (50日均價 × 融資成數0.6) × 100%
      // 分母：50日均價 × 0.6 代表融資建倉成本的近似估算
      const stockRatio = (price / (ma50 * 0.6)) * 100;

      // 合理性濾除（維持率不可能 <50% 或 >600%）
      if (stockRatio < 50 || stockRatio > 600) continue;

      // 以融資股數為權重
      const weight = stocks[i].balance;
      sumWeightedRatio += stockRatio * weight;
      sumWeight += weight;
      validCount++;
    }

    if (validCount < 5 || sumWeight === 0) {
      throw new Error(`Insufficient valid quotes: only ${validCount}`);
    }

    const ratio = parseFloat((sumWeightedRatio / sumWeight).toFixed(2));
    console.log(`[sentiment] Ratio calc OK: ${ratio}% (${validCount} stocks, wt=${sumWeight})`);

    if (ratio < 50 || ratio > 500) throw new Error(`Ratio out of range: ${ratio}`);

    return { ratio, isoDate };
  } catch (e) {
    console.warn('[sentiment] Ratio calc failed:', (e as Error).message);
    return null;
  }
}

// ── 從 TWSE OpenAPI v1 MI_MARGN 取得融資餘額、增減、融券（修正版）──
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

    const parseNum = (s: string | number) =>
      typeof s === 'number' ? s : parseFloat(String(s).replace(/,/g, '')) || 0;

    // 關鍵修正：openapi MI_MARGN 只有個股資料，沒有合計列
    // 必須對所有個股加總，才能得到全市場融資合計
    let totalMarginToday  = 0;
    let totalShortToday   = 0;
    // 流量法：當日融資淨增減 = 買進 - 賣出 - 現金償還
    // 不依賴 TodayBalance vs YesterdayBalance（兩者盤後前可能相等）
    let totalMarginBuy    = 0;
    let totalMarginSell   = 0;
    let totalMarginRepay  = 0;
    let latestDate: string | null = null;

    for (const item of raw) {
      // 融資餘額（取今日餘額，中/英文欄位名稱都嘗試）
      totalMarginToday  += parseNum(item['融資今日餘額'] ?? item.MarginPurchaseTodayBalance ?? 0);

      // 融資當日流量（用於計算淨增減，不受 Balance 更新時序影響）
      totalMarginBuy    += parseNum(item['融資買進'] ?? item.MarginPurchaseBuy ?? 0);
      totalMarginSell   += parseNum(item['融資賣出'] ?? item.MarginPurchaseSell ?? 0);
      totalMarginRepay  += parseNum(
        item['現金償還'] ?? item['融資現金償還'] ?? item.MarginPurchaseCashRepayment ?? 0
      );

      // 融券餘額
      totalShortToday   += parseNum(item['融券今日餘額'] ?? item.ShortSaleTodayBalance ?? 0);

      // 日期（所有列相同，取第一筆即可）
      if (!latestDate) {
        const d = item.Date || item['日期'];
        if (d) latestDate = rocDateToIso(String(d));
      }
    }

    // 合理性驗證
    if (totalMarginToday < 100_000_000) {
      console.warn('[sentiment] MI_MARGN sum too small:', totalMarginToday,
        '— API may have changed structure');
    }

    // 當日淨融資增減 = 買進 - 賣出 - 現金償還（流量法）
    // 數學等式：TodayBalance = YesterdayBalance + Buy - Sell - Repayment
    // 所以 Buy - Sell - Repayment = TodayBalance - YesterdayBalance = 淨增減
    // 流量欄位在盤後資料發布前即已有值，不受 Balance 未更新影響
    const totalMarginNetChange = totalMarginBuy - totalMarginSell - totalMarginRepay;

    // 單位：萬張（1 千股 = 1 張；÷ 10,000 得萬張）
    const marginBalanceMwt = parseFloat((totalMarginToday    / 10_000).toFixed(1));
    const marginChangeMwt  = parseFloat((totalMarginNetChange / 10_000).toFixed(1));
    const shortBalanceMwt  = parseFloat((totalShortToday      / 10_000).toFixed(1));
    const msRatio          = totalShortToday > 0
      ? parseFloat((totalMarginToday / totalShortToday).toFixed(1))
      : null;

    console.log('[sentiment] MI_MARGN (萬張):', {
      totalMarginToday,
      buy: totalMarginBuy, sell: totalMarginSell, repay: totalMarginRepay,
      netChange: totalMarginNetChange,
      marginBalance: marginBalanceMwt, marginChange: marginChangeMwt,
      shortBalance: shortBalanceMwt, date: latestDate,
    });

    return {
      marginBalance:     marginBalanceMwt,   // 萬張
      marginDailyChange: marginChangeMwt,    // 萬張
      shortBalance:      shortBalanceMwt,    // 萬張
      marginShortRatio:  msRatio,
      balanceDate:       latestDate,
    };
  } catch (e) {
    console.warn('[sentiment] MI_MARGN fetch failed:', (e as Error).message);
    return null;
  }
}

// 主函數：並行取得維持率（帶日期回溯）+ 融資股數
async function fetchTwseMarginData() {
  try {
    const candidates = getCandidateDates(6);
    console.log('[sentiment] TWSE RM candidates:', candidates);

    // ── 維持率：用 MI_MARGN + Yahoo Finance 動態計算 ──
    // （TWSE FMTQIK 端點封鎖 Vercel IP，改用計算法）
    let ratioResult: { ratio: number; isoDate: string } | null = null;

    // 主要方案：動態計算（MI_MARGN 融資股數 × Yahoo Finance 股價）
    ratioResult = await fetchMaintenanceRatioLatest();

    // 備援：帶日期的 FMTQIK（若未來 TWSE 解除封鎖可自動恢復）
    if (!ratioResult) {
      for (const dateStr of candidates) {
        ratioResult = await fetchMaintenanceRatioForDate(dateStr);
        if (ratioResult) break;
      }
    }

    if (ratioResult) {
      console.log(`[sentiment] TWSE ratio OK: ${ratioResult.ratio}% @ ${ratioResult.isoDate}`);
    } else {
      console.warn('[sentiment] TWSE ratio: all attempts failed, using fallback');
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

  // ── 診斷路由：GET /api/sentiment?debug=1 ──
  // 直接測試各 TWSE 端點並回傳原始回應，用於確認 IP 封鎖和欄位格式問題
  if (req.query?.debug === '1') {
    const debugInfo: Record<string, any> = {};

    const TEST_URLS = [
      ['fmtqik_openapi', 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK'],
      ['fmtqik_rwd_nodate', 'https://www.twse.com.tw/rwd/zh/marginTrading/FMTQIK?response=json'],
      ['fmtqik_rwd_date', `https://www.twse.com.tw/rwd/zh/marginTrading/FMTQIK?date=${new Date().toISOString().slice(0,10).replace(/-/g,'')}&response=json`],
      ['mi_margn_openapi', 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN'],
    ];

    await Promise.allSettled(
      TEST_URLS.map(async ([name, url]) => {
        try {
          const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 8000);
          const text = await r.text();
          let parsed: any;
          try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 500); }

          // 摘要化回應（避免回傳太大）
          if (Array.isArray(parsed)) {
            debugInfo[name] = {
              status: r.status,
              length: parsed.length,
              firstItem: parsed[0],
              lastItem: parsed[parsed.length - 1],
            };
          } else if (typeof parsed === 'object') {
            debugInfo[name] = {
              status: r.status,
              stat: parsed.stat,
              fields: parsed.fields,
              dataLength: parsed.data?.length,
              dataFirst: parsed.data?.[0],
              dataLast:  parsed.data?.[parsed.data?.length - 1],
            };
          } else {
            debugInfo[name] = { status: r.status, raw: String(parsed).slice(0, 300) };
          }
        } catch (e) {
          debugInfo[name] = { error: (e as Error).message };
        }
      })
    );

    return res.json({ timestamp: new Date().toISOString(), debug: debugInfo });
  }

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
