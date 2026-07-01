import type { VercelRequest, VercelResponse } from '@vercel/node';

const FRED_API_KEY = process.env.FRED_API_KEY ? process.env.FRED_API_KEY.trim().replace(/^['"]|['"]$/g, '') : undefined;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
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
    const response = await fetch(url, { signal });
    if (timeoutId) clearTimeout(timeoutId);
    return response;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
}

interface HistoricalContext {
  period: string;
  years: string;
  marketEvent: string;
  outcome: string;
  similarity: 'identical' | 'similar' | 'approximate';
}

interface YieldData {
  yield2y: number | null;
  yield10y: number | null;
  yield30y: number | null;
  spread_2_10: number | null;
  spread_2_30: number | null;
  curveSignal: 'normal' | 'flat' | 'inverted' | 'deep_inverted';
  stockOutlook: string;
  outlookType: 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  date: string;
  lastUpdated: string;
  // New fields
  absoluteLevel: 'low' | 'moderate' | 'high' | 'very_high';
  absoluteLevelNote: string;
  pressureOnEquity: 'low' | 'moderate' | 'high' | 'very_high';
  pressureNote: string;
  keyRisks: string[];
  keyOpportunities: string[];
  analystTake: string;
  warningFlags: string[];
  // History fields
  percentile20y: number | null;
  percentileNote: string | null;
  historicalContexts: HistoricalContext[];
  chartData: {
    dates: string[];
    yield2y: (number | null)[];
    yield10y: (number | null)[];
    yield30y: (number | null)[];
  };
  isFallback?: boolean;
}

let cache: { data: YieldData; ts: number } | null = null;
const CACHE_TTL = 600_000; // 10 minutes

const FALLBACK_DATA: YieldData = {
  yield2y: 3.85,
  yield10y: 4.28,
  yield30y: 4.65,
  spread_2_10: 0.43,
  spread_2_30: 0.8,
  curveSignal: 'normal',
  stockOutlook: '（使用備援數據，請稍後重試）',
  outlookType: 'neutral',
  date: new Date().toISOString().split('T')[0],
  lastUpdated: new Date().toISOString(),
  absoluteLevel: 'high',
  absoluteLevelNote: '10年期殖利率偏高，壓縮股票本益比，成長股面臨估值修正壓力',
  pressureOnEquity: 'high',
  pressureNote: '高殖利率環境壓縮股票風險溢價，特別對高本益比科技股不利',
  keyRisks: ['⚠️ 數據暫時無法由美聯儲取得', '10年期殖利率處於偏高水位，本益比面臨潛在折價風險'],
  keyOpportunities: ['配置長期債券鎖定收益'],
  analystTake: '當前 FRED API 因網路或請求限制暫時無法取得最新數據。顯示為上次已知或合理市場預估。此時 2-10 債券利差大約維持在小幅走平至正常水位，債券對股市利差優勢仍強。',
  warningFlags: ['⚠️ 數據載入中，顯示為估算值'],
  percentile20y: 50,
  percentileNote: '當前 10Y 殖利率處於前 20 年的歷史中位水位附近。',
  historicalContexts: [],
  chartData: { dates: [], yield2y: [], yield10y: [], yield30y: [] },
  isFallback: true
};

function getHistoricalContext(
  yield2y: number,
  yield10y: number,
  yield30y: number | null,
  spread_2_10: number
): HistoricalContext[] {
  const contexts: HistoricalContext[] = [];

  // Special Check: 30Y > 5%
  if (yield30y && yield30y >= 5.0) {
    contexts.push({
      period: '長期資本預算轉折點',
      years: '2023.10',
      marketEvent: '30年期美債殖利率突破 5% 心理關卡，為 2007 年以來首次，標誌長期資本成本進入「新高利率時代」。美國赤字融資壓力加劇，殖利率曲線在長端出現劇烈「熊市陡峭化」（Bear Steepening）。',
      outcome: '股市短期兩週內急跌約 5-7%，房地產投資信託（REITs）因折現率攀升而大幅下調。然而隨後因聯準會政策指引轉向，股市在兩個月內報復性反彈近 15%，證明 5% 雖是壓力位但並非牛市終結點。',
      similarity: 'identical'
    });
  }

  // Level Logic: Very High (>4.5%)
  if (yield10y >= 4.5) {
    if (spread_2_10 < 0) {
      contexts.push({
        period: '金融海嘯前夕（倒掛期）',
        years: '2006-2007',
        marketEvent: '10年期殖利率穩定於 4.5-5.3% 區間，聯署會將基準利率維持在 5.25% 達一年之久。2-10年利差最深倒掛達 -15bp，房市泡沫開始出現裂痕，但股市仍在慣性上漲。',
        outcome: '標普 500 在倒掛後仍持續上漲約 12 個月並創新高，直到 2007 年 10 月才見頂。隨後進入長達 17 個月、最大跌幅 57% 的全球金融危機。倒掛至股市崩跌存在顯著的時間滯後。',
        similarity: 'similar'
      });
    }
    contexts.push({
      period: '聯準會暴力升息循環',
      years: '2022-2024',
      marketEvent: 'CPI 峰值達 9.1%，Fed 在 12 個月內升息 525bp。10年期殖利率從 1.5% 飆升至 5%，2年期一度達 5.3%，2-10利差嚴重倒掛達 -108bp（自 1980 年代以來最深）。',
      outcome: '錄得百年最差股債組合表現：標普 500 跌 25%，納斯達克跌 34%。隨後 AI 浪潮爆發引發估值重構，股市在殖利率維持 4% 以上的高位時仍大幅反彈並創歷史新高（2023-2024）。',
      similarity: 'identical'
    });
  } 
  // Level Logic: High (4.0% - 4.5%)
  else if (yield10y >= 4.0) {
    if (spread_2_10 < 0.2) {
      contexts.push({
        period: '網路泡沫頂峰前奏',
        years: '1998-1999',
        marketEvent: '10年期殖利率由 4.2% 回升至 6% 區間。當時經濟成長強勁，技術進步推升生產力預期，Fed 啟動防禦性升息。曲線近乎平坦，市場極度樂觀。',
        outcome: '儘管利率走高，納斯達克指數在 1999 年仍翻倍成長，最終在 2000 年 3 月殖利率達到 6.8% 時崩潰。說明在「生產力爆發」期，股市對 4% 以上利率有極強耐受力。',
        similarity: 'similar'
      });
    }
    contexts.push({
      period: '後疫情緊縮恢復期',
      years: '2022.Q3',
      marketEvent: '10年期首次站上 4% 關卡，市場正式告別 10 年來的低利率環境（ZERPI）。市場正在重新學習如何對債券進行風險定價，波動率指數（VIX）長期維持在 20 以上。',
      outcome: '股市呈現極高敏感度，每次通膨數據公布皆引發 2-3% 的單日震盪。隨後價值股與能源股表現顯著優於虧損中的科技股，市場重心由「成長展望」轉向「獲利品質」。',
      similarity: 'similar'
    });
  }
  // Level Logic: Moderate (3.0% - 4.0%)
  else if (yield10y >= 3.0) {
    if (spread_2_10 < 0) {
      contexts.push({
        period: '聯準會貨幣緊縮末期',
        years: '2018-2019',
        marketEvent: 'Fed 縮表（QT）疊加升息，10年期殖利率升至 3.25%。2-10利差一度倒掛，當時中美貿易爭端加劇，市場對經濟成長放緩產生劇烈恐慌。',
        outcome: '2018 年 Q4 標普 500 急跌 20% 觸發空頭市場，迫使 Fed 官員集體「轉鴿」並於 2019 年展開預防性降息。隨後股市報復性反彈，開啟了 2019 年近 30% 的年度漲幅。',
        similarity: 'similar'
      });
    } else {
      contexts.push({
        period: '削減恐慌（Taper Tantrum）',
        years: '2013-2014',
        marketEvent: 'Fed 暗示將減少每月的購債規模，10年期殖利率在 4 個月內從 1.6% 暴力拉升至 3.0%。全球資金由新興市場回流美國，借貸成本預期陡增。',
        outcome: '股市經歷短暫 5-8% 震盪後隨即消化衝擊。當時美股企業獲利強勁，足以抵銷利息成本上升的負面影響，標普 500 全年最終錄得 30% 漲幅。',
        similarity: 'approximate'
      });
    }
  }
  // Level Logic: Low (2.0% - 3.0%)
  else if (yield10y >= 2.0) {
    contexts.push({
      period: '金髮女孩經濟時期',
      years: '2016-2018',
      marketEvent: '10年期在 1.8% 至 2.6% 區間波動，通膨維持在 2% 目標附近。Fed 緩步且透明地提高利率。這是標準的景氣擴張中期，資金環境異常舒適。',
      outcome: '標普 500 呈現穩定的低波動上漲，科技股（FAANG）正式進入權重支配階段。直到 2018 年殖利率突破 3% 且 Fed 發言過於強硬，上漲趨勢才被打破。',
      similarity: 'similar'
    });
  }
  // Level Logic: Very Low (< 2.0%)
  else {
    contexts.push({
      period: '疫情量化寬鬆盛世',
      years: '2020-2021',
      marketEvent: '為應對疫情，Fed 實施無限量 QE 並將利率調降至零（ZLB）。10年期一度跌破 0.6%，真實利率（Real Yield）深度負值，資金無處可去。',
      outcome: '催生了史詩級的資產價格泡沫：納斯達克兩年內翻倍，S&P 500 創下最速從熊市恢復並翻倍的紀錄。加密貨幣與非利潤型科技股出現非理性狂熱。',
      similarity: 'similar'
    });
  }

  return contexts.slice(0, 3); // Return up to top 3 relevant cases
}

function calculatePercentile(history: Array<{ value: number }>, currentValue: number): number {
  if (history.length === 0) return 50;
  const below = history.filter(h => h.value <= currentValue).length;
  return Math.round((below / history.length) * 100);
}

function mergeChartData(
  data2y: Array<{ value: number; date: string }>,
  data10y: Array<{ value: number; date: string }>,
  data30y: Array<{ value: number; date: string }>
) {
  // 建立各自的 YYYY-MM → value lookup
  const lookup2y  = new Map(data2y.map(d  => [d.date.slice(0, 7), d.value]));
  const lookup10y = new Map(data10y.map(d => [d.date.slice(0, 7), d.value]));
  const lookup30y = new Map(data30y.map(d => [d.date.slice(0, 7), d.value]));

  // 取三方月份聯集，排序
  const allMonths = Array.from(
    new Set([
      ...data2y.map(d  => d.date.slice(0, 7)),
      ...data10y.map(d => d.date.slice(0, 7)),
      ...data30y.map(d => d.date.slice(0, 7)),
    ])
  ).sort();  // "YYYY-MM" 字串排序即正確時間順序

  const result = allMonths.map(month => ({
    date:     month,
    yield2y:  lookup2y.get(month)  ?? null,
    yield10y: lookup10y.get(month) ?? null,
    yield30y: lookup30y.get(month) ?? null,
  }));

  return {
    dates:    result.map(r => r.date),
    yield2y:  result.map(r => r.yield2y),
    yield10y: result.map(r => r.yield10y),
    yield30y: result.map(r => r.yield30y),
  };
}

function sampleMonthlyLast(
  daily: Array<{ value: number; date: string }>
): Array<{ value: number; date: string }> {
  if (daily.length === 0) return [];
  
  const byMonth: Record<string, { value: number; date: string }> = {};
  
  for (const point of daily) {
    const monthKey = point.date.slice(0, 7); // "YYYY-MM"
    byMonth[monthKey] = point; // Overwrite to keep latest in that month
  }
  
  return Object.values(byMonth).sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFredHistory(
  seriesId: string, 
  monthsBack: number,
  frequency: 'm' | 'd' = 'm',
  retries = 2
): Promise<Array<{ value: number; date: string }>> {
  if (!FRED_API_KEY) return [];
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);
  const observationStart = startDate.toISOString().split('T')[0];
  const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=asc&observation_start=${observationStart}&frequency=${frequency}&aggregation_method=eop`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, 6000);
      if (res.status === 429) {
        console.warn(`[yields] Rate limited for history ${seriesId}, attempt ${attempt + 1}/${retries + 1}`);
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      if (!res.ok) return [];
      const data: any = await res.json();
      const monthly = (data.observations || [])
        .filter((o: any) => o.value !== '.')
        .map((o: any) => ({ value: Number(o.value), date: o.date }));
      
      return monthly;
    } catch (e) {
      console.error(`[yields] History fetch failed for ${seriesId} on try ${attempt + 1}:`, e);
      if (attempt < retries) {
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return [];
    }
  }
  return [];
}

function getAbsoluteLevel(yield10y: number): { level: YieldData['absoluteLevel']; note: string } {
  if (yield10y < 2.5) return { level: 'low', note: '10年期殖利率處於低位，對股市估值壓力輕微，有利成長股' };
  if (yield10y < 3.5) return { level: 'moderate', note: '10年期殖利率溫和，對股市估值影響中性' };
  if (yield10y < 4.5) return { level: 'high', note: '10年期殖利率偏高，壓縮股票本益比，成長股面臨估值修正壓力' };
  return { level: 'very_high', note: '10年期殖利率達近年高位（>4.5%），對股市估值形成顯著壓制，無風險報酬率吸引力上升' };
}

function getEquityPressure(yield10y: number, yield30y: number | null): { 
  pressure: YieldData['pressureOnEquity']; 
  note: string 
} {
  const base = yield10y;
  const longEnd = yield30y ?? yield10y + 0.5;
  
  if (base < 3.0) return { pressure: 'low', note: '殖利率偏低，資金成本低廉，股票相對債券仍具吸引力' };
  if (base < 4.0) return { pressure: 'moderate', note: '殖利率溫和上行，股債競爭加劇，但股市仍可支撐' };
  if (base < 4.5 || longEnd < 5.0) return { pressure: 'high', note: '高殖利率環境壓縮股票風險溢價，特別對高本益比科技股不利' };
  return { 
    pressure: 'very_high', 
    note: `10年期 ${base.toFixed(2)}%${longEnd >= 5.0 ? `、30年期 ${longEnd.toFixed(2)}%` : ''}，殖利率全面高位，債券作為替代資產吸引力顯著提升，股市估值承壓` 
  };
}

function getKeyRisks(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number): string[] {
  const risks: string[] = [];
  
  if (yield10y >= 4.5) risks.push(`10年期殖利率 ${yield10y.toFixed(2)}% 處於近年高位，本益比壓縮風險`);
  if (yield30y && yield30y >= 5.0) risks.push(`30年期殖利率突破 5%，長期資本成本上升，不利基建與房地產`);
  if (spread_2_10 < 0.3 && spread_2_10 >= 0) risks.push(`2-10利差僅 ${(spread_2_10 * 100).toFixed(0)}bp，曲線近乎平坦，銀行業利差收窄`);
  if (spread_2_10 < 0) risks.push(`殖利率曲線倒掛 ${(Math.abs(spread_2_10) * 100).toFixed(0)}bp，歷史上預測衰退準確率達 70%`);
  if (yield2y >= 4.5) risks.push(`2年期殖利率 ${yield2y.toFixed(2)}%，短債具吸引力，資金可能從股市流向貨幣市場基金`);
  
  return risks.slice(0, 4);
}

function getKeyOpportunities(yield10y: number, spread_2_10: number): string[] {
  const opps: string[] = [];
  
  if (yield10y >= 4.5 && spread_2_10 > 0) opps.push('高殖利率環境有利銀行股與保險股，利差擴大帶動淨利息收入');
  if (yield10y >= 4.0) opps.push('長債殖利率高位鎖定，配置 TLT/TMF 等長債 ETF 具潛在資本利得機會');
  
  return opps;
}

function getAnalystTake(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number): string {
  const longEnd = yield30y ?? null;
  
  if (yield10y >= 4.0 && yield10y < 4.5 && spread_2_10 >= 0 && spread_2_10 < 0.5) {
    return `當前殖利率曲線呈平坦形態，2-10利差僅 ${(spread_2_10 * 100).toFixed(0)}bp，顯示市場對短期利率維持高位的預期。10年期 ${yield10y.toFixed(2)}% 的絕對水位對成長股估值構成壓力，股票風險溢價（ERP）已收窄至歷史低位。建議重點關注現金流穩定的價值股，降低對高本益比科技股的暴露。`;
  }
  
  if (longEnd && longEnd >= 5.0) {
    return `30年期公債殖利率突破 5% 心理關卡，標誌著長期資本成本全面走高。這對以長期現金流折現定價的資產（房地產、公用事業、成長股）形成系統性壓制。${yield10y >= 4.5 ? `10年期同步達 ${yield10y.toFixed(2)}%，` : ''}市場正在重新評估「Fed put」是否仍然有效，建議提高現金比例，等待殖利率回落再布局風險資產。`;
  }
  
  if (spread_2_10 < 0) {
    return `殖利率曲線倒掛 ${(Math.abs(spread_2_10) * 100).toFixed(0)}bp，歷史上自 1960 年以來，此形態後的 12-18 個月內美國有 8 次衰退（準確率超過 70%）。然而，倒掛到衰退的時間差長短不一（最短 6 個月，最長 24 個月），股市在倒掛期間仍可能維持上漲。建議關注信用利差走勢，作為衰退即將到來的更即時訊號。`;
  }
  
  if (spread_2_10 > 0.5 && yield10y < 3.5) {
    return `殖利率曲線陡峭化且絕對水位溫和，為股市最友善的債市環境。銀行業受益於利差擴大，成長股估值壓力輕微。歷史上此組合往往對應經濟早期擴張階段，股市中長期表現通常強勁。`;
  }
  
  return `當前殖利率格局顯示市場處於政策轉折的關鍵觀察期。2年期 ${yield2y.toFixed(2)}% 反映市場對聯準會維持高利率的預期，而 10年期 ${yield10y.toFixed(2)}% 則顯示長期通膨預期仍偏高。在通膨數據回落至 2% 目標前，高利率環境可能持續，股市的支撐需來自企業獲利的實質增長。`;
}

function getWarningFlags(yield2y: number, yield10y: number, yield30y: number | null, spread_2_10: number): string[] {
  const flags: string[] = [];
  if (yield10y >= 4.5) flags.push('🔴 10Y ≥ 4.5%：估值壓制區');
  else if (yield10y >= 4.0) flags.push('實質 10Y ≥ 4.0%：高殖利率警戒');
  if (yield30y && yield30y >= 5.0) flags.push('🔴 30Y ≥ 5.0%：長期資本成本高位');
  if (spread_2_10 < 0) flags.push(`🔴 曲線倒掛 ${(Math.abs(spread_2_10)*100).toFixed(0)}bp`);
  else if (spread_2_10 < 0.25) flags.push('🟡 曲線趨平，接近倒掛');
  if (yield2y >= 4.5) flags.push('🟡 2Y高位：貨幣市場基金競爭股市資金');
  return flags;
}

async function fetchFredSeries(seriesId: string, retries = 2): Promise<{ value: number; date: string } | null> {
  if (!FRED_API_KEY) return null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`;
      const res = await fetchWithTimeout(url, 6000); // Reduced timeout to 6 seconds
      
      if (res.status === 429) {
        // Rate limit: backoff and retry
        console.warn(`[yields] Rate limited for ${seriesId}, attempt ${attempt + 1}`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // 1s, 2s delay
          continue;
        }
        return null;
      }
      
      if (!res.ok) return null;
      
      const data: any = await res.json();
      const valid = (data.observations || [])
        .filter((o: any) => o.value !== '.')
        .map((o: any) => ({ value: Number(o.value), date: o.date }));
      
      return valid.length > 0 ? valid[0] : null;
    } catch (e) {
      console.error(`[yields] Fetch failed for ${seriesId} (attempt ${attempt + 1}):`, e);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // 0.5s, 1s delay
        continue;
      }
      return null;
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  if (!FRED_API_KEY) {
    return res.status(200).json({ error: 'FRED_API_KEY_MISSING' });
  }

  try {
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    // === Layer 1: Core yields data (DGS2, DGS10, DGS30) - Must succeed, use retrying fetch ===
    const [y2, y10, y30] = await Promise.all([
      fetchFredSeries('DGS2'),
      delay(200).then(() => fetchFredSeries('DGS10')),
      delay(400).then(() => fetchFredSeries('DGS30')),
    ]);

    if (!y2 || !y10) {
      console.warn('[yields] Core FRED yields unavailable, returning fallback data');
      return res.status(200).json({
        ...FALLBACK_DATA,
        isFallback: true,
        error: null
      });
    }

    // === Layer 2: Historical datasets - Failsafe fetching with Promise.allSettled ===
    const [histResult, chart2yResult, chart10yResult, chart30yResult] = await Promise.allSettled([
      delay(600).then(() => fetchFredHistory('DGS10', 240, 'm')),
      delay(800).then(() => fetchFredHistory('DGS2', 24, 'm')),
      delay(1000).then(() => fetchFredHistory('DGS10', 24, 'm')),
      delay(1200).then(() => fetchFredHistory('DGS30', 24, 'm'))
    ]);

    const history20y = histResult.status === 'fulfilled' ? histResult.value : [];
    const chart2y    = chart2yResult.status === 'fulfilled' ? chart2yResult.value : [];
    const chart10y   = chart10yResult.status === 'fulfilled' ? chart10yResult.value : [];
    const chart30y   = chart30yResult.status === 'fulfilled' ? chart30yResult.value : [];

    const spread_2_10 = y10.value - y2.value;
    const spread_2_30 = y30 ? y30.value - y2.value : null;

    let curveSignal: YieldData['curveSignal'] = 'normal';
    let stockOutlook = '';
    let outlookType: YieldData['outlookType'] = 'bullish';

    if (spread_2_10 > 0.5) {
      curveSignal = 'normal';
      stockOutlook = '殖利率曲線正常，經濟擴張預期，有利股市';
      outlookType = 'bullish';
    } else if (spread_2_10 >= 0) {
      curveSignal = 'flat';
      stockOutlook = '殖利率曲線趨平，經濟放緩跡象，建議謹慎';
      outlookType = 'neutral';
    } else if (spread_2_10 >= -0.5) {
      curveSignal = 'inverted';
      stockOutlook = '殖利率曲線倒掛，歷史上為衰退前兆，留意風險';
      outlookType = 'bearish';
    } else {
      curveSignal = 'deep_inverted';
      stockOutlook = '殖利率曲線深度倒掛，衰退訊號強烈，建議保守';
      outlookType = 'strong_bearish';
    }

    const absLevel = getAbsoluteLevel(y10.value);
    const pressure = getEquityPressure(y10.value, y30 ? y30.value : null);

    const percentile20y = calculatePercentile(history20y, y10.value);
    const percentileNote = `當前 10Y 殖利率高於過去 20 年中 ${percentile20y}% 的時間，處於歷史${percentile20y > 80 ? '極高' : percentile20y > 60 ? '偏高' : percentile20y > 40 ? '中位' : '偏低'}水位`;

    const mergedCharts = mergeChartData(chart2y, chart10y, chart30y);

    // Debug log（生產環境可移除）
    console.log('[yields] Chart data points:', {
      dates:    mergedCharts.dates.length,
      yield2y:  mergedCharts.yield2y.filter(v => v !== null).length,
      yield10y: mergedCharts.yield10y.filter(v => v !== null).length,
      yield30y: mergedCharts.yield30y.filter(v => v !== null).length,
      sample2y:  mergedCharts.yield2y.slice(-3),
      sample30y: mergedCharts.yield30y.slice(-3),
    });

    // Ensure chart last point matches real-time if significant gap exists
    if (y10 && mergedCharts.dates.length > 0) {
      const todayMonth = y10.date.slice(0, 7);
      const lastChartMonth = mergedCharts.dates[mergedCharts.dates.length - 1];

      if (todayMonth !== lastChartMonth) {
        // 新月份：追加一筆
        mergedCharts.dates.push(todayMonth);
        mergedCharts.yield2y.push(y2?.value  ?? null);
        mergedCharts.yield10y.push(y10.value);
        mergedCharts.yield30y.push(y30?.value ?? null);
      } else {
        // 同月份：更新最後一筆（三條線都更新）
        const lastIdx = mergedCharts.dates.length - 1;
        mergedCharts.yield2y[lastIdx]  = y2?.value  ?? mergedCharts.yield2y[lastIdx];
        mergedCharts.yield10y[lastIdx] = y10.value;
        mergedCharts.yield30y[lastIdx] = y30?.value ?? mergedCharts.yield30y[lastIdx];
      }
    }

    const data: YieldData = {
      yield2y: y2.value,
      yield10y: y10.value,
      yield30y: y30 ? y30.value : null,
      spread_2_10,
      spread_2_30,
      curveSignal,
      stockOutlook,
      outlookType,
      date: y10.date,
      lastUpdated: new Date().toISOString(),
      absoluteLevel: absLevel.level,
      absoluteLevelNote: absLevel.note,
      pressureOnEquity: pressure.pressure,
      pressureNote: pressure.note,
      keyRisks: getKeyRisks(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
      keyOpportunities: getKeyOpportunities(y10.value, spread_2_10),
      analystTake: getAnalystTake(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
      warningFlags: getWarningFlags(y2.value, y10.value, y30 ? y30.value : null, spread_2_10),
      percentile20y,
      percentileNote,
      historicalContexts: getHistoricalContext(
        y2.value,
        y10.value,
        y30 ? y30.value : null,
        spread_2_10
      ),
      chartData: mergedCharts,
      isFallback: false
    };

    cache = { data, ts: Date.now() };
    res.json(data);
  } catch (error) {
    console.error('[yields] Handler error:', error);
    res.status(200).json({
      ...FALLBACK_DATA,
      isFallback: true,
      error: null
    });
  }
}
