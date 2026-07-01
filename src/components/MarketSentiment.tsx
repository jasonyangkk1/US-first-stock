import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Gauge, Activity, AlertCircle, RefreshCcw, TrendingDown, TrendingUp, Users, ShoppingBag, Clock, Calendar, BarChart3, AlertTriangle, Zap, Link, ArrowRight, Eye } from 'lucide-react';

interface Sentiment {
  vix: {
    value: number;
    change: number;
  };
  fearAndGreed: {
    value: number;
    label: string;
    updated: string;
  };
}

interface EconomicIndicator {
  id: string;
  name: string;
  label: string;
  description: string;
  nextRelease?: string;
  icon: React.ElementType;
  previous?: string | null;
  actual?: string | null;
  forecast?: string | null;
  forecastSource?: string | null;
  forecastAsOf?: string | null;
  pendingRelease?: boolean;
  pendingReleaseTime?: string | null;
}

const ECONOMIC_INDICATORS: EconomicIndicator[] = [
  {
    id: 'adp',
    name: '小非農 (ADP)',
    label: 'ADP Employment',
    description: '衡量美國私營部門就業人數的變化。由 ADP 研究院公布，通常在官方非農報告前兩天發布，被視為市場先行指標。',
    icon: Users,
    forecast: '130K',
    forecastSource: '市場共識',
    forecastAsOf: '2026-06'
  },
  {
    id: 'nfp',
    name: '大非農 (NFP)',
    label: 'Non-Farm Payrolls',
    description: '美國非農業就業人數及失業率報告。這是衡量美國經濟健康狀況最重要的宏觀指標之一，直接影響聯準會的利率政策。',
    icon: Activity,
    forecast: '130K',
    forecastSource: '市場共識',
    forecastAsOf: '2026-06'
  },
  {
    id: 'cpi',
    name: '消費者物價指數 (CPI)',
    label: 'US Consumer Price Index',
    description: '衡量美國通膨壓力的核心數據。反映消費者購買商品和服務的價格變化，高於預計的 CPI 通常會強化市場對升息的預期。',
    icon: ShoppingBag,
    forecast: '2.4%',
    forecastSource: '市場共識',
    forecastAsOf: '2026-06'
  },
  {
    id: 'ppi',
    name: '生產者物價指數 (PPI)',
    label: 'Producer Price Index',
    description: '衡量生產者銷售最終商品與服務的價格變化（Final Demand PPI），是 BLS 每月公布的主要 PPI 指標。通常領先 CPI 1-3 個月，PPI 持續走高預示未來消費者通膨壓力將增加。',
    icon: BarChart3,
    forecast: '3.2%',
    forecastSource: '市場共識',
    forecastAsOf: '2026-06'
  },
  {
    id: 'core_ppi',
    name: '核心 PPI（不含食品與能源）',
    label: 'Core Producer Price Index',
    description: '排除食品與能源後的生產者物價指數，反映更穩定的核心通膨趨勢。Federal Reserve 在制定利率政策時更重視核心指標，因為食品與能源價格波動較大。核心 PPI 與核心 PCE 相關性高，是預判未來核心 CPI 走勢的重要指標。',
    icon: BarChart3,
    forecast: '3.0%',
    forecastSource: '市場共識',
    forecastAsOf: '2026-06'
  }
];

interface SignalProps {
  status: 'green' | 'yellow' | 'red';
  label?: string;
  className?: string;
}

const SignalLamp: React.FC<SignalProps> = ({ status, label, className = '' }) => {
  const bgClass = {
    green: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
    yellow: 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.7)]',
    red: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)] animate-pulse',
  }[status] || 'bg-gray-500';

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className={`w-2.5 h-2.5 rounded-full ${bgClass}`} />
      {label && <span className="text-[10px] font-sans font-semibold tracking-wide text-text-dim uppercase">{label}</span>}
    </div>
  );
};

interface SparklineProps {
  history: Array<{ date: string; value: number }>;
  color?: string;
  width?: number;
  height?: number;
}

const MiniSparkline: React.FC<SparklineProps> = ({ history, color = '#f97316', width = 76, height = 24 }) => {
  if (!history || history.length < 2) return null;
  const values = history.map(h => h.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min === 0 ? 1 : max - min;
  
  const points = history.map((item, index) => {
    const x = (index / (history.length - 1)) * width;
    const y = height - ((item.value - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  const lastVal = values[values.length - 1];
  const lastY = height - ((lastVal - min) / range) * (height - 4) - 2;

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-75"
          points={points}
        />
        <circle
          cx={width}
          cy={lastY}
          r="2"
          fill={color}
          className="animate-pulse"
        />
      </svg>
    </div>
  );
};

export default function MarketSentiment() {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [macroData, setMacroData] = useState<any>(null);
  const [yieldsData, setYieldsData] = useState<any>(null);
  const [breadthData, setBreadthData] = useState<any>(null);
  const [carryData, setCarryData] = useState<any>(null);
  const [cotData, setCotData] = useState<any>(null);
  const [structuralData, setStructuralData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [macroLoading, setMacroLoading] = useState(true);
  const [yieldsLoading, setYieldsLoading] = useState(true);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [carryLoading, setCarryLoading] = useState(true);
  const [cotLoading, setCotLoading] = useState(true);
  const [structuralLoading, setStructuralLoading] = useState(true);
  const [yieldsError, setYieldsError] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [cookieBlocked, setCookieBlocked] = useState(false);

  const fetchYields = React.useCallback(async () => {
    setYieldsLoading(true);
    setYieldsError(null);
    try {
      const res = await fetch('/api/yields');
      if (!res.ok) throw new Error('Yields API response not OK');
      const data = await res.json();
      
      if (data.error) {
        setYieldsError(data.error === 'FRED_API_KEY_MISSING' ? '尚未設定 FRED API Key' : '數據暫時無法取得');
      } else if (data.yield2y !== null && data.yield10y !== null) {
        setYieldsData(data);
      } else {
        setYieldsError('數據不完整');
      }
    } catch (e) {
      console.error('Error fetching yields:', e);
      setCookieBlocked(true);
      // Fallback yieldsData
      setYieldsData({
        yield2y: 3.85,
        yield10y: 4.28,
        yield30y: 4.65,
        spread_2_10: 0.43,
        spread_2_30: 0.8,
        curveSignal: 'normal',
        stockOutlook: '10年期公債殖利率溫和，經濟呈擴張走勢，有利股市評價',
        outlookType: 'normal',
        date: new Date().toISOString().split('T')[0],
        lastUpdated: new Date().toISOString(),
        absoluteLevel: 'high',
        absoluteLevelNote: '10年期殖利率偏高，壓縮股票本益比，成長股面臨估值修正壓力',
        pressureOnEquity: 'high',
        pressureNote: '高殖利率環境壓縮股票風險溢價，特別對高本益比科技股不利',
        keyRisks: ['10年期殖利率偏高', '中美貿易衝突/關稅壓抑'],
        keyOpportunities: ['配置長債鎖定高殖利率收益'],
        analystTake: '全球資金往高殖利率美債回流，股票本益比空間面臨一定程度壓抑。然基本面仍具支撐。',
        warningFlags: ['10Y 近期偏高'],
        percentile20y: 72,
        percentileNote: '目前 10Y 在過去有 72% 比率處於此處以下',
        historicalContexts: [],
        chartData: {
          dates: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
          yield2y: [4.82, 4.79, 4.41, 4.25, 4.12, 4.01, 3.82, 3.81, 3.85],
          yield10y: [4.51, 4.48, 4.25, 4.15, 4.22, 4.19, 4.26, 4.24, 4.28],
          yield30y: [4.62, 4.59, 4.42, 4.38, 4.45, 4.43, 4.55, 4.52, 4.65]
        },
        isFallback: true
      });
    } finally {
      setYieldsLoading(false);
    }
  }, []);

  const USDJPY_WEEKLY_CHANGE = carryData?.usdJpyWeeklyChange ?? 1.2; // 當前週漲幅（%），從 API 快取或歷史計算獲取，預設 1.2%
  const USDJPY_WARNING_THRESHOLD = 2.5; // 黃燈臨界
  const USDJPY_DANGER_THRESHOLD = 3.5;  // 紅燈臨界

  const usdJpyRawChange = USDJPY_WEEKLY_CHANGE; // 現在是有方向性的值
  const usdJpyDropPct = Math.max(-usdJpyRawChange, 0); // 只有下跌（負值）才計入危險
  const usdJpyProgress = Math.min((usdJpyDropPct / 5) * 100, 100);
  const usdJpyStatus: 'safe' | 'warning' | 'danger' = 
    usdJpyDropPct >= USDJPY_DANGER_THRESHOLD ? 'danger' :
    usdJpyDropPct >= USDJPY_WARNING_THRESHOLD ? 'warning' : 'safe';

  const usdJpyColor = {
    safe: { text: 'text-emerald-400', bar: 'bg-emerald-500', border: 'border-emerald-500/10', bg: 'bg-emerald-500/5', label: `正常區間 (${usdJpyProgress.toFixed(0)}%)` },
    warning: { text: 'text-yellow-400', bar: 'bg-yellow-500', border: 'border-yellow-500/10', bg: 'bg-yellow-500/5', label: `⚠️ 黃燈警戒 (${usdJpyProgress.toFixed(0)}%)` },
    danger: { text: 'text-rose-400', bar: 'bg-rose-500', border: 'border-rose-500/20', bg: 'bg-rose-500/5', label: `🔴 紅燈危險 (${usdJpyProgress.toFixed(0)}%)` },
  }[usdJpyStatus];

  // 計算綜合風險評級
  const bojRiskLevel = carryData ? carryData.riskLevel : 'HIGH';
  const bojRiskColor = bojRiskLevel === 'HIGH' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' 
                     : bojRiskLevel === 'MODERATE' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                     : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  const COT_DATA = cotData?.historicalData ?? [
    { date: '2024-08', contracts: 184223, label: '2024年8月', isVerified: true },
    { date: '2024-10', contracts: 140000, label: '2024年10月', isVerified: true },
    { date: '2024-12', contracts: 120000, label: '2024年12月', isVerified: true },
    { date: '2025-02', contracts: 155000, label: '2025年2月', isVerified: true },
    { date: '2025-05', contracts: 130000, label: '2025年5月', isVerified: true },
    { date: '2025-08', contracts: 110000, label: '2025年8月', isVerified: true },
    { date: '2025-11', contracts: 90000,  label: '2025年11月', isVerified: true },
    { date: '2026-02', contracts: 95000,  label: '2026年2月',  isVerified: true },
    { date: '2026-05', contracts: 80000,  label: '2026年5月（估算）', isVerified: false },
  ];

  const CURRENT_SHORT = cotData?.currentShort ?? 80000;
  const PEAK_SHORT = cotData?.peakShort ?? 184223;
  const DANGER_THRESHOLD = cotData?.dangerThreshold ?? 150000;
  const WARNING_THRESHOLD = cotData?.warningThreshold ?? 120000;
  const reductionPct = cotData?.reductionPct ?? 56.6;
  const riskFromPeak = cotData?.riskFromPeak ?? 43.4;

  const isNewPeak = CURRENT_SHORT >= PEAK_SHORT;
  const isDanger = CURRENT_SHORT >= DANGER_THRESHOLD;
  const isWarning = CURRENT_SHORT >= WARNING_THRESHOLD;

  const peakDateLabel = cotData?.peakDate
    ? cotData.peakDate.replace(/(\d{4})-(\d{2})/, '$1年$2月')
    : '2024年8月';
  const isHistoricAug2024 = (cotData?.peakDate ?? '2024-08') === '2024-08';

  const fedLabel = !carryData ? '載入中...' :
    carryData.fedRate > 4.5 ? 'FOMC 維持高位' :
    carryData.fedRate > 3.0 ? 'FOMC 降息循環中' :
    'FOMC 寬鬆模式';

  const bojLabel = !carryData ? '載入中...' :
    carryData.bojRate > 0.5 ? 'BOJ 積極升息中' :
    carryData.bojRate > 0.25 ? 'BOJ 升息軌道中' :
    'BOJ 接近零利率';

  const nextBoj = carryData?.nextBojMeeting;
  const bojMeetingTitle = nextBoj
    ? `${nextBoj.label} BOJ 政策會議`
    : 'BOJ 下次政策會議（日期待公告）';
  const bojMeetingShortLabel = nextBoj?.shortLabel ?? '日期待公告';
  const bojMeetingDesc = nextBoj
    ? `市場高度緊盯日本央行於 <span class="text-rose-400/90 font-bold border-b border-rose-500/30 pb-0.5 font-sans">${nextBoj.label}</span> 召開的決策會議，若政策立場轉鷹，可能提早引發大規模的資金匯回。`
    : '市場持續緊盯日本央行下次政策會議，若政策立場轉鷹，可能引發大規模的資金匯回。';

  let cotStatusColor = 'text-emerald-400 font-bold border border-emerald-500/30 bg-emerald-500/10';
  let cotCardBorder = 'border-emerald-500/20';
  let cotCardBg = 'bg-emerald-500/5';
  let cotCardLabelColor = 'text-emerald-400';
  let cotCardTextColor = 'text-emerald-400/95';
  let cotBadgeText = '風險降溫';
  let cotBadgeStyle = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold';

  if (isNewPeak) {
    cotStatusColor = 'text-rose-400 border border-rose-500/30 bg-rose-500/10';
    cotCardBorder = 'border-rose-500/35';
    cotCardBg = 'bg-rose-500/5';
    cotCardLabelColor = 'text-rose-400';
    cotCardTextColor = 'text-rose-400/95';
    cotBadgeText = '⚠️ 歷史新高 (CRITICAL)';
    cotBadgeStyle = 'text-rose-400 border border-rose-500/35 bg-rose-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold animate-pulse';
  } else if (isDanger) {
    cotStatusColor = 'text-red-400 border border-red-500/30 bg-red-500/10';
    cotCardBorder = 'border-red-500/30';
    cotCardBg = 'bg-red-500/5';
    cotCardLabelColor = 'text-red-400';
    cotCardTextColor = 'text-red-400/95';
    cotBadgeText = '⚠️ 危險區間 (HIGH RISK)';
    cotBadgeStyle = 'text-red-400 border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold animate-pulse';
  } else if (isWarning) {
    cotStatusColor = 'text-yellow-400 border border-yellow-500/30 bg-yellow-500/10';
    cotCardBorder = 'border-yellow-500/20';
    cotCardBg = 'bg-yellow-500/5';
    cotCardLabelColor = 'text-yellow-400';
    cotCardTextColor = 'text-yellow-400/95';
    cotBadgeText = '⚠️ 警戒區間 (WARNING)';
    cotBadgeStyle = 'text-yellow-400 border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold';
  }

  let currentShortCardBorder = isNewPeak ? 'border-rose-500/35 bg-rose-950/10' : isDanger ? 'border-red-500/30 bg-red-950/5' : isWarning ? 'border-yellow-500/20 bg-yellow-950/5' : 'border-emerald-500/20 bg-card-bg/50';
  let currentShortTextColor = isNewPeak ? 'text-rose-400 font-mono font-bold text-3xl' : isDanger ? 'text-red-400 font-mono font-bold text-3xl' : isWarning ? 'text-yellow-400 font-mono font-bold text-3xl' : 'text-emerald-400 font-mono font-bold text-3xl';
  let currentShortLabelColor = isNewPeak ? 'text-rose-400' : isDanger ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-emerald-400';
  let currentShortBadgeStyle = isNewPeak 
    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/20' 
    : isDanger 
      ? 'bg-red-500/15 text-red-500 border border-red-500/20' 
      : isWarning 
        ? 'bg-yellow-500/15 text-yellow-500 border border-yellow-500/20' 
        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20';

  let changeDirectionLabel = '較峰值減少';
  let changeDirectionSymbol = '↓';
  let displayReductionPct = reductionPct;
  if (reductionPct < 0) {
    changeDirectionLabel = '較峰值增加';
    changeDirectionSymbol = '↑';
    displayReductionPct = Math.abs(reductionPct);
  }

  let dynamicConclusionText = '';
  if (isNewPeak) {
    dynamicConclusionText = `「空軍兵臨城下，創歷史新高」——當前 ${(CURRENT_SHORT / 10000).toFixed(1)} 萬口空單規模已突破並創下歷史新高（較前峰值暴增 ${displayReductionPct.toFixed(1)}%）。此擁擠度已凌駕 2024 年 8 月引發全球金融市場震盪的 ${(isHistoricAug2024 ? (PEAK_SHORT / 10000) : 18.4).toFixed(1)} 萬口歷史事件起爆點（新峰值日期為 ${peakDateLabel}），面臨極高的高槓桿平倉多殺多隱患。一旦日圓在美日利差縮小或地緣因素引發急升時，極易引發美股及套利方被迫集體斬倉，產生系統性資產價格殺盤風險。`;
  } else if (isDanger) {
    dynamicConclusionText = `「空單堆積，逼近歷史高位」——當前 ${(CURRENT_SHORT / 10000).toFixed(1)} 萬口空單規模已處於極度危險區間（較歷史峰值期（${peakDateLabel}）僅差 ${displayReductionPct.toFixed(1)}%），且大幅超越 ${(DANGER_THRESHOLD / 10000).toFixed(0)} 萬口的危險臨界線。在如此高比例的套利部位下，日圓若出現任何升值風吹草動，皆可能演變成集體踩踏，引發美股資產保證金追繳，面臨高度系統性平倉風險。`;
  } else if (isWarning) {
    dynamicConclusionText = `「空單進入警戒區間」——當前 ${(CURRENT_SHORT / 10000).toFixed(1)} 萬口空單規模已超越 ${(WARNING_THRESHOLD / 10000).toFixed(0)} 萬口警戒線（較歷史峰值期（${peakDateLabel}）減少 ${displayReductionPct.toFixed(1)}%）。市場套利槓桿顯著回升，儘管尚未打破新高，但日圓如果快速升值，空單部位平倉壓力將迅速轉為實質踩踏風險，需嚴格監看日圓走勢。`;
  } else {
    dynamicConclusionText = `「車上的人已少了一半以上」——當前 ${(CURRENT_SHORT / 10000).toFixed(1)} 萬口空單規模（較歷史峰值期（${peakDateLabel}）減少 ${displayReductionPct.toFixed(1)}%），遠低於歷史峰值 ${(PEAK_SHORT / 10000).toFixed(1)} 萬口。就算日圓突然升值，被強制斷頭的投機客規模已大幅縮減，系統性拋售美股的連鎖反應風險顯著降低。`;
  }

  let monitoringText = isNewPeak || isDanger
    ? `🚨 當前空單部位已處於極度危險的邊緣 (${(CURRENT_SHORT / 10000).toFixed(1)} 萬口)，任何日圓急升走勢均可能重演${isHistoricAug2024 ? ' 2024 年 8 月' : ` ${peakDateLabel}（歷史峰值時期）`}的套利交易平倉潮，請高度戒備美股連鎖風險。`
    : `⚠️ 仍需監控：若空單快速回升至 ${(WARNING_THRESHOLD/10000).toFixed(0)} 萬口以上，需重新評估風險等級。`;

  useEffect(() => {
    const fetchSentiment = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/sentiment');
        if (!res.ok) throw new Error('Sentiment API failed');
        const data = await res.json();
        setSentiment(data);
      } catch (error) {
        console.error('Error fetching sentiment:', error);
        setCookieBlocked(true);
        setSentiment({
          vix: { value: 14.2, change: -1.2 },
          fearAndGreed: { value: 58, label: 'Greed', updated: new Date().toISOString() }
        });
      } finally {
        setLoading(false);
      }
    };

    const fetchMacro = async () => {
      try {
        const res = await fetch('/api/macro');
        if (!res.ok) throw new Error('Macro API failed');
        const data = await res.json();
        setMacroData(data);
      } catch (e) {
        console.error('Error fetching macroData:', e);
        setCookieBlocked(true);
        setMacroData({
          adp: { actual: '152K', previous: '184K', forecast: '150K', nextRelease: '2026-06-03 20:15 (TPE)' },
          nfp: { actual: '115K', previous: '185K', forecast: '145K', nextRelease: '2026-06-05 20:30 (TPE)' },
          cpi: { actual: '3.3%', previous: '3.4%', forecast: '3.4%', nextRelease: '2026-06-10 20:30 (TPE)' },
          ppi: { actual: '6.0%', previous: '4.3%', forecast: '4.9%', nextRelease: '2026-06-12 20:30 (TPE)' },
          core_ppi: { actual: '5.2%', previous: '4.0%', forecast: '4.3%', nextRelease: '2026-06-12 20:30 (TPE)' }
        });
      } finally {
        setMacroLoading(false);
      }
    };

    const fetchBreadth = async () => {
      setBreadthLoading(true);
      try {
        const res = await fetch('/api/breadth');
        if (!res.ok) throw new Error('Breadth API failed');
        const data = await res.json();
        if (data.concentration?.breadthScore !== undefined) {
          setBreadthData(data);
        } else {
          throw new Error('[breadth] Unexpected data shape');
        }
      } catch (e) {
        console.error('Error fetching breadth:', e);
        setCookieBlocked(true);
        setBreadthData({
          breadthSignal: "narrowing",
          breadthLabel: "量能收斂 · 巨頭撐盤",
          breadthAnalysis: "上週美股創高但漲幅高度集中於 Nvidia、Apple 等大型權值股。S&P 500 成分股中僅有 42% 漲幅超越大盤。寬度警示燈號切換至黃燈（收斂），反映中小型股動能有所放緩。防禦性部位建議維持在 30%-45% 水準。",
          top10AboveMa50Pct: 70,
          sp500AboveMa50Estimate: 62.1,
          top10AboveMa200Pct: 90,
          concentration: {
            breadthScore: 55,
            concentrationPremium: 1.2,
            concentrationPremiumLabel: "巨頭溢價中等 (1.2% QYoY)",
            concentrationTrend: "moderate",
            top10WeightEstimate: 33.2,
            top10WeightIsLive: false
          },
          topStocks: [
            { symbol: "AAPL", name: "Apple Inc.", changePercent1D: 1.23, distanceFromHigh52w: -0.5 },
            { symbol: "MSFT", name: "Microsoft Corp.", changePercent1D: 0.85, distanceFromHigh52w: -2.1 },
            { symbol: "GOOGL", name: "Alphabet Inc.", changePercent1D: -0.42, distanceFromHigh52w: -3.4 },
            { symbol: "AMZN", name: "Amazon.com Inc.", changePercent1D: 2.11, distanceFromHigh52w: -1.2 },
            { symbol: "META", name: "Meta Platforms", changePercent1D: -1.15, distanceFromHigh52w: -4.8 },
            { symbol: "TSLA", name: "Tesla, Inc.", changePercent1D: 4.82, distanceFromHigh52w: -18.4 },
            { symbol: "NVDA", name: "NVIDIA Corp.", changePercent1D: 3.51, distanceFromHigh52w: -0.1 }
          ]
        });
      } finally {
        setBreadthLoading(false);
      }
    };

    const fetchCarry = async () => {
      setCarryLoading(true);
      try {
        const res = await fetch('/api/carry');
        if (!res.ok) throw new Error('Carry API failed');
        const data = await res.json();
        setCarryData(data);
      } catch (e) {
        console.error('Error fetching carry data:', e);
        setCookieBlocked(true);
        setCarryData({
          fedRate: 5.375,
          fedRateRange: "5.25% - 5.50%",
          fedIsLive: false,
          bojRate: 0.25,
          bojIsLive: false,
          nominalSpread: 5.125,
          realSpread: 3.625,
          realSpreadProgress: 88,
          inflationDiff: 1.5,
          riskLevel: "MODERATE",
          bojHikeProb: 35,
          bojQtProb: 25,
          bojProbUpdated: new Date().toISOString().split('T')[0],
          usdJpyIsLive: false,
          usdJpyWeeklyChange: 1.2,
          updatedAt: new Date().toISOString()
        });
      } finally {
        setCarryLoading(false);
      }
    };

    const fetchCOT = async () => {
      setCotLoading(true);
      try {
        const res = await fetch('/api/cot');
        if (!res.ok) throw new Error('COT API failed');
        const data = await res.json();
        setCotData(data);
      } catch (e) {
        console.error('Error fetching COT data:', e);
        setCookieBlocked(true);
        setCotData({
          currentShort: 80000,
          peakShort: 184223,
          dangerThreshold: 150000,
          warningThreshold: 120000,
          reductionPct: 56.6,
          riskFromPeak: 43.4,
          peakDate: "2024-08",
          isNewAllTimeHigh: false,
          isLive: false,
          dataSource: "nasdaq",
          updatedAt: new Date().toISOString(),
          historicalData: [
            { date: "2024-08", contracts: 184223, label: "歷史高點 (Aug 2024)", isVerified: true },
            { date: "2024-12", contracts: 142000, label: "年底收斂", isVerified: true },
            { date: "2025-04", contracts: 95000, label: "平倉潮", isVerified: true },
            { date: "2025-08", contracts: 121000, label: "波段高點", isVerified: true },
            { date: "2025-12", contracts: 88000, label: "收盤結算", isVerified: true },
            { date: "2026-04", contracts: 76000, label: "低檔摩擦", isVerified: true },
            { date: "2026-05", contracts: 80000, label: "最新報告", isVerified: false }
          ]
        });
      } finally {
        setCotLoading(false);
      }
    };

    const fetchStructural = async () => {
      setStructuralLoading(true);
      try {
        const res = await fetch('/api/structural');
        if (!res.ok) throw new Error('Structural API failed');
        const data = await res.json();
        setStructuralData(data);
      } catch (e) {
        console.error('Error fetching structural data:', e);
        setCookieBlocked(true);
        setStructuralData({
          aiCapex: {
            hyOas: 2.85,
            prevMonthAvg: 2.92,
            signal: 'green',
            signalLabel: '動能強勁 · 債市穩定',
            isLive: false,
            fcf: {
              isLive: false,
              stocks: [
                { symbol: 'AAPL', fcfYield: 4.82, capexRatio: 5.2, signal: 'green' },
                { symbol: 'MSFT', fcfYield: 3.51, capexRatio: 12.8, signal: 'green' },
                { symbol: 'GOOGL', fcfYield: 4.14, capexRatio: 9.6, signal: 'green' },
                { symbol: 'AMZN', fcfYield: 5.22, capexRatio: 14.2, signal: 'green' },
                { symbol: 'META', fcfYield: 4.95, capexRatio: 11.5, signal: 'green' },
                { symbol: 'TSLA', fcfYield: 1.85, capexRatio: 15.5, signal: 'yellow' },
                { symbol: 'NVDA', fcfYield: 5.82, capexRatio: 6.8, signal: 'green' }
              ],
              compositeSignal: 'green',
              compositeSignalLabel: '健康強勁'
            }
          },
          geopolitical: {
            brentWtiSpread: 4.25,
            prevMonthAvg: 4.11,
            signal: 'green',
            signalLabel: '地緣溢價偏低'
          },
          nbfi: {
            srIpad: 122.5,
            prevMonthAvg: 119.8,
            signal: 'green',
            signalLabel: '影子銀行中性'
          },
          kEconomy: {
            consumerSentiment: 69.5,
            prevMonthAvg: 68.2,
            signal: 'green',
            signalLabel: 'K型消費者穩定'
          }
        });
      } finally {
        setStructuralLoading(false);
      }
    };

    fetchSentiment();
    fetchMacro();
    fetchYields();
    fetchBreadth();
    fetchCarry();
    fetchCOT();
    fetchStructural();
  }, [fetchYields]);

  if (loading || !sentiment) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-48 bg-card-bg border border-border-subtle rounded-xl" />
        <div className="h-32 bg-card-bg border border-border-subtle rounded-xl" />
        <div className="h-64 bg-card-bg border border-border-subtle rounded-xl" />
      </div>
    );
  }

  const fg = sentiment.fearAndGreed.value;
  const isVixHigh = sentiment.vix.value > 25;

  // Needle angle: 0 value = -90deg, 100 value = 90deg, 50 value = 0deg
  const needleRotation = (fg / 100) * 180 - 90;

  const indicators = ECONOMIC_INDICATORS.map(ind => {
    const dynamic = macroData ? (macroData as any)[ind.id] : null;
    
    return {
      ...ind,
      // 優先用 API 數據，若 API 尚未載入且有靜態備用值則用靜態值
      actual:      dynamic?.actual      ?? ind.actual      ?? null,
      previous:    dynamic?.previous    ?? ind.previous    ?? null,
      forecast:    dynamic?.forecast    ?? ind.forecast    ?? null,
      nextRelease: dynamic?.nextRelease ?? ind.nextRelease ?? 'TBD',
      dataDate:    dynamic?.dataDate    ?? null,
      // isLive: API 成功且有數據
      isLive:   !!(dynamic?.actual),
      // isStatic: API 尚未載入
      isStatic: !macroData,
      // isPending: API 有載入但數據為 null（表示本月數據未發布）
      isPending: !!macroData && !dynamic?.actual,
      pendingRelease: dynamic?.pendingRelease ?? false,
      pendingReleaseTime: dynamic?.pendingReleaseTime ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      {cookieBlocked && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-amber-400"
        >
          <div className="flex-1 text-xs font-medium leading-relaxed">
            <span className="font-bold">⚠️ Iframe 安全限制警告：</span>
            瀏覽器阻擋了安全 Cookie（常見於跨網域 Iframe，如 Safari/Brave 預設防禦）。
            系統已自動切換至備用
            <span className="font-bold underline text-amber-200"> 離線演示數據 </span>
            維持圖表繪製。
            若要鏈接
            <span className="font-bold text-amber-200"> MAG7 即時 FRED / 巨頭 FCF API 實時數據 </span>
            ，請點擊右側按鈕獨立在新分頁開啟。
          </div>
          <button 
            onClick={() => window.open(window.location.href, '_blank')}
            className="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-[10px] font-bold rounded-lg uppercase tracking-wider transition-colors"
          >
            新分頁開啟
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CNN Fear & Greed */}
        <section className="sleek-card flex flex-col items-center text-center py-10 overflow-hidden relative">
          <div className="card-title w-full text-left px-5 absolute top-5">Fear & Greed Index</div>
          
          <div className="mt-12 mb-4 relative flex flex-col items-center w-full max-w-[280px]">
            {/* Semi-circular Gauge container */}
            <div className="relative w-full aspect-[2/1] overflow-hidden flex items-end justify-center">
               <svg viewBox="0 0 200 100" className="w-full">
                 {/* Background Track */}
                 <path 
                   d="M 20 100 A 80 80 0 0 1 180 100" 
                   fill="none" 
                   stroke="rgba(255,255,255,0.05)" 
                   strokeWidth="12" 
                   strokeLinecap="round" 
                 />
                 {/* Colored Segments */}
                 <path 
                   d="M 20 100 A 80 80 0 0 1 180 100" 
                   fill="none" 
                   stroke="url(#sentimentGradient)" 
                   strokeWidth="12" 
                   strokeLinecap="round"
                 />
                 <defs>
                   <linearGradient id="sentimentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                     <stop offset="0%" stopColor="#ef4444" />
                     <stop offset="25%" stopColor="#f97316" />
                     <stop offset="50%" stopColor="#eab308" />
                     <stop offset="75%" stopColor="#84cc16" />
                     <stop offset="100%" stopColor="#10b981" />
                   </linearGradient>
                 </defs>
               </svg>
               
               {/* Needle */}
               <motion.div 
                 className="absolute bottom-0 left-1/2 w-0.5 h-[75%] bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.5)] origin-bottom rounded-full"
                 style={{ x: "-50%" }}
                 initial={{ rotate: -90 }}
                 animate={{ rotate: needleRotation }}
                 transition={{ duration: 2, ease: [0.34, 1.56, 0.64, 1] }} // Springy feel
               />
               
               {/* Center point */}
               <div className="absolute bottom-[-6px] left-1/2 -translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-lg z-10" />
            </div>

            <div className="flex flex-col items-center mt-2">
              <div className="text-4xl font-light tracking-tighter text-text-bright">{fg}</div>
              <div className={`status-pill mt-2 ${fg > 60 ? 'pill-green' : fg < 40 ? 'pill-amber' : 'pill-blue'}`}>
                {sentiment.fearAndGreed.label || (fg > 75 ? 'Extreme Greed' : fg > 55 ? 'Greed' : fg > 45 ? 'Neutral' : fg > 25 ? 'Fear' : 'Extreme Fear')}
              </div>
            </div>
          </div>

          <div className="w-full mt-4 px-4 sm:px-10 flex justify-between text-[8px] sm:text-[9px] text-text-dim font-bold uppercase tracking-widest opacity-60">
            <span>Extreme Fear</span>
            <span className="hidden xs:inline">Neutral</span>
            <span>Extreme Greed</span>
          </div>
        </section>

        {/* VIX Index */}
        <section className="sleek-card justify-center py-10">
          <div className="card-title absolute top-5">VIX Volatility Index</div>
          
          <div className="flex flex-col items-center gap-2 mt-4">
            <div className="text-4xl font-light tracking-tighter text-text-bright">{sentiment.vix.value?.toFixed(2)}</div>
            <div className={`flex items-center gap-1 text-xs font-bold ${sentiment.vix.change > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              {sentiment.vix.change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{Math.abs(sentiment.vix.change || 0).toFixed(2)}%</span>
            </div>
            <p className={`text-[10px] mt-4 font-bold uppercase tracking-widest ${isVixHigh ? 'text-red-400' : 'text-emerald-400'}`}>
              {isVixHigh ? 'High Volatility Regime' : 'Low Volatility Regime'}
            </p>
          </div>
        </section>

        {/* Treasury Yield Curve */}
        <section className="sleek-card md:col-span-2 p-6 overflow-hidden relative">
          <div className="card-title">🏦 美國公債殖利率曲線 (Yield Curve)</div>
          
          {yieldsData?.isFallback && !yieldsLoading && (
            <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg font-mono mt-3 inline-flex items-center gap-1.5 self-start">
              <span>⚠️ 美聯儲 FRED API 暫時不可用，已自動載入備用市場數據。</span>
            </div>
          )}
          
          {yieldsLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCcw className="w-6 h-6 animate-spin text-brand/40" />
            </div>
          ) : yieldsData ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
              <div className="lg:col-span-5 flex flex-col justify-between">
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1">2Y</span>
                    <span className="text-xl font-mono font-bold text-text-bright">{yieldsData.yield2y?.toFixed(2)}%</span>
                  </div>
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1">10Y</span>
                    <span className="text-xl font-mono font-bold text-text-bright">{yieldsData.yield10y?.toFixed(2)}%</span>
                  </div>
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1">30Y</span>
                    <span className="text-xl font-mono font-bold text-text-bright">{yieldsData.yield30y ? `${yieldsData.yield30y.toFixed(2)}%` : '--'}</span>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-bold text-text-dim uppercase">2-10Y Spread</span>
                    <span className={`text-sm font-mono font-bold ${yieldsData.spread_2_10 >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {yieldsData.spread_2_10 > 0 ? '+' : ''}{yieldsData.spread_2_10?.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2">
                    <span className="text-xs font-bold text-text-dim uppercase">2-30Y Spread</span>
                    <span className={`text-sm font-mono font-bold ${yieldsData.spread_2_30 >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {yieldsData.spread_2_30 !== null ? `${yieldsData.spread_2_30 > 0 ? '+' : ''}${yieldsData.spread_2_30.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className={`p-5 rounded-2xl border-2 transition-all shadow-lg ${
                  yieldsData.curveSignal === 'normal' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' :
                  yieldsData.curveSignal === 'flat' ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400' :
                  yieldsData.curveSignal === 'inverted' ? 'border-orange-500/30 bg-orange-500/5 text-orange-400' :
                  'border-rose-500/30 bg-rose-500/5 text-rose-400'
                }`}>
                  <div className="flex items-center gap-3 mb-2">
                    <AlertCircle className="w-5 h-5" />
                    <span className="font-bold text-lg">
                      {yieldsData.curveSignal === 'normal' ? '正常 (Normal)' :
                       yieldsData.curveSignal === 'flat' ? '平坦 (Flat)' :
                       yieldsData.curveSignal === 'inverted' ? '倒掛 (Inverted)' :
                       '深度倒掛 (Deep Inverted)'}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-relaxed opacity-90">
                    {yieldsData.stockOutlook}
                  </p>
                </div>

                <div className="bg-card-bg/30 rounded-xl p-4 flex-1 relative min-h-[120px]">
                  {/* SVG Visualization of Yield Curve */}
                  <svg viewBox="0 0 300 100" className="w-full h-full preserve-3d">
                    <defs>
                      <linearGradient id="curveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="currentColor" stopOpacity="0.8" />
                      </linearGradient>
                    </defs>
                    <path 
                      d={`M 50 ${100 - (yieldsData.yield2y * 15)} L 150 ${100 - (yieldsData.yield10y * 15)} ${yieldsData.yield30y ? `L 250 ${100 - (yieldsData.yield30y * 15)}` : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={
                        yieldsData.curveSignal === 'normal' ? 'text-emerald-500' :
                        yieldsData.curveSignal === 'flat' ? 'text-yellow-500' :
                        yieldsData.curveSignal === 'inverted' ? 'text-orange-500' :
                        'text-rose-500'
                      }
                    />
                    {/* Dots */}
                    <circle cx="50" cy={100 - (yieldsData.yield2y * 15)} r="4" fill="white" />
                    <circle cx="150" cy={100 - (yieldsData.yield10y * 15)} r="4" fill="white" />
                    {yieldsData.yield30y && <circle cx="250" cy={100 - (yieldsData.yield30y * 15)} r="4" fill="white" />}
                    
                    <text x="50" y="95" fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="middle">2Y</text>
                    <text x="150" y="95" fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="middle">10Y</text>
                    <text x="250" y="95" fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="middle">30Y</text>
                  </svg>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-text-dim font-bold justify-end">
                  <Calendar className="w-3 h-3" />
                  最新數據日期: {yieldsData.date}
                </div>
              </div>

              {/* 深度分析區塊 */}
              <div className="lg:col-span-12 mt-6 pt-6 border-t border-border-subtle/50 space-y-6">
                
                {/* 警示旗幟 */}
                {yieldsData.warningFlags?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {yieldsData.warningFlags.map((flag: string, i: number) => (
                      <span key={i} className="text-[10px] sm:text-xs px-3 py-1 rounded-full bg-card-bg border border-border-subtle text-text-dim font-medium">
                        {flag}
                      </span>
                    ))}
                  </div>
                )}

                {/* 絕對水位 + 股市壓力 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-card-bg/50 rounded-2xl p-4 border border-border-subtle">
                    <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-2 px-1">殖利率水位</div>
                    <div className={`text-sm font-bold mb-2 px-1 flex items-center gap-2 ${
                      yieldsData.absoluteLevel === 'very_high' ? 'text-rose-400' :
                      yieldsData.absoluteLevel === 'high' ? 'text-orange-400' :
                      yieldsData.absoluteLevel === 'moderate' ? 'text-yellow-400' : 'text-emerald-400'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        yieldsData.absoluteLevel === 'very_high' ? 'bg-rose-400' :
                        yieldsData.absoluteLevel === 'high' ? 'bg-orange-400' :
                        yieldsData.absoluteLevel === 'moderate' ? 'bg-yellow-400' : 'bg-emerald-400'
                      }`} />
                      {yieldsData.absoluteLevel === 'very_high' ? '極高 (Very High)' :
                       yieldsData.absoluteLevel === 'high' ? '偏高 (High)' :
                       yieldsData.absoluteLevel === 'moderate' ? '溫和 (Moderate)' : '偏低 (Low)'}
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed px-1">{yieldsData.absoluteLevelNote}</p>
                  </div>
                  <div className="bg-card-bg/50 rounded-2xl p-4 border border-border-subtle">
                    <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-2 px-1">股市估值壓力</div>
                    <div className={`text-sm font-bold mb-2 px-1 flex items-center gap-2 ${
                      yieldsData.pressureOnEquity === 'very_high' ? 'text-rose-400' :
                      yieldsData.pressureOnEquity === 'high' ? 'text-orange-400' :
                      yieldsData.pressureOnEquity === 'moderate' ? 'text-yellow-400' : 'text-emerald-400'
                    }`}>
                      <div className={`w-2 h-2 rounded-full ${
                        yieldsData.pressureOnEquity === 'very_high' ? 'bg-rose-400' :
                        yieldsData.pressureOnEquity === 'high' ? 'bg-orange-400' :
                        yieldsData.pressureOnEquity === 'moderate' ? 'bg-yellow-400' : 'bg-emerald-400'
                      }`} />
                      {yieldsData.pressureOnEquity === 'very_high' ? '極高壓力 (Extreme)' :
                       yieldsData.pressureOnEquity === 'high' ? '顯著壓力 (High)' :
                       yieldsData.pressureOnEquity === 'moderate' ? '中等壓力 (Moderate)' : '壓力輕微 (Low)'}
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed px-1">{yieldsData.pressureNote}</p>
                  </div>
                </div>

                {/* 分析師銳評 */}
                <div className="bg-brand/5 rounded-2xl p-5 border border-brand/20 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Activity className="w-12 h-12 text-brand" />
                  </div>
                  <div className="text-[10px] text-brand uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                    <Users className="w-3 h-3" />
                    量化分析師銳評 Analyst Take
                  </div>
                  <p className="text-sm text-text-bright leading-relaxed font-medium relative z-10">{yieldsData.analystTake}</p>
                </div>

                {/* 主要風險與機會 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {yieldsData.keyRisks?.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest px-1">⚠️ 主要風險 Risks</div>
                      <ul className="space-y-2">
                        {yieldsData.keyRisks.map((risk: string, i: number) => (
                          <li key={i} className="text-xs text-text-secondary flex gap-3 bg-card-bg/30 p-2 rounded-lg border border-border-subtle/30">
                            <span className="text-rose-400 font-bold">●</span>
                            <span>{risk}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {yieldsData.keyOpportunities?.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest px-1">✨ 潛在機會 Opportunities</div>
                      <ul className="space-y-2">
                        {yieldsData.keyOpportunities.map((opp: string, i: number) => (
                          <li key={i} className="text-xs text-text-secondary flex gap-3 bg-card-bg/30 p-2 rounded-lg border border-border-subtle/30">
                            <span className="text-emerald-400 font-bold">●</span>
                            <span>{opp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* 歷史比較區塊 */}
              {yieldsData.percentile20y !== null && (
                <div className="lg:col-span-12 mt-6 pt-6 border-t border-border-subtle/50 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 百分位視覺化 */}
                    <div className="bg-card-bg/30 rounded-xl p-5 border border-border-subtle">
                      <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-4 flex items-center gap-2">
                        <TrendingUp className="w-3 h-3" />
                        歷史水位比較 (近 20 年)
                      </div>
                      
                      <div className="relative mt-2">
                        <div className="h-2.5 bg-gradient-to-r from-emerald-500/20 via-yellow-500/20 to-rose-500/20 rounded-full overflow-hidden border border-white/5">
                          <div className="h-full bg-transparent relative">
                            <motion.div 
                              initial={{ left: '0%' }}
                              animate={{ left: `${yieldsData.percentile20y}%` }}
                              transition={{ duration: 1.5, ease: "easeOut" }}
                              className="absolute top-[-2px] bottom-[-2px] w-1 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] z-10"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] text-text-dim mt-2 font-medium">
                          <span>歷史低位</span>
                          <span className="font-bold text-text-bright">當前: {yieldsData.percentile20y}th percentile</span>
                          <span>歷史高位</span>
                        </div>
                      </div>
                      
                      <p className="text-xs text-text-secondary mt-4 leading-relaxed bg-white/5 p-3 rounded-lg border border-white/5 italic">
                        {yieldsData.percentileNote}
                      </p>
                    </div>

                    {/* 殖利率走勢對比圖 */}
                    {yieldsData.chartData?.dates?.length > 0 && (
                      <div className="bg-card-bg/30 rounded-xl p-5 border border-border-subtle">
                        <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                          <Activity className="w-3 h-3" />
                          美國公債殖利率走勢 (近 2 年)
                        </div>
                        
                        {/* 圖例 */}
                        <div className="flex gap-4 mb-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-0.5 bg-orange-500 rounded"></div>
                            <span className="text-[9px] text-text-secondary font-bold">2Y</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-0.5 bg-blue-500 rounded"></div>
                            <span className="text-[9px] text-text-secondary font-bold">10Y</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-4 h-0.5 bg-purple-500 rounded"></div>
                            <span className="text-[9px] text-text-secondary font-bold">30Y</span>
                          </div>
                        </div>
                        
                        <div className="h-32 w-full relative">
                          {(() => {
                            const { dates, yield2y, yield10y, yield30y } = yieldsData.chartData;
                            
                            // 計算整體 min/max（忽略 null 值）
                            const allValues = [...yield2y, ...yield10y, ...yield30y].filter(v => v !== null) as number[];
                            const minVal = Math.min(...allValues);
                            const maxVal = Math.max(...allValues);
                            const range = maxVal - minVal || 0.1;
                            const pad = range * 0.15;
                            const yMin = minVal - pad;
                            const yMax = maxVal + pad;
                            const yRange = yMax - yMin;

                            const toY = (v: number) => 100 - ((v - yMin) / yRange) * 100;
                            const toX = (i: number) => (i / (dates.length - 1)) * 400;

                            // 為每條線產生段落，遇到 null 時截斷多段（避免直線跳躍）
                            const buildSegments = (arr: (number | null)[]): string[] => {
                              const segments: string[] = [];
                              let current: string[] = [];
                              
                              arr.forEach((v, i) => {
                                if (v !== null) {
                                  current.push(`${toX(i)},${toY(v)}`);
                                } else {
                                  if (current.length >= 2) {
                                    segments.push(current.join(' '));
                                  } else if (current.length === 1) {
                                    segments.push(`${current[0]} ${current[0]}`);
                                  }
                                  current = [];
                                }
                              });
                              if (current.length >= 2) {
                                segments.push(current.join(' '));
                              } else if (current.length === 1) {
                                segments.push(`${current[0]} ${current[0]}`);
                              }
                              
                              return segments;
                            };

                            const segments2y  = buildSegments(yield2y);
                            const segments10y = buildSegments(yield10y);
                            const segments30y = buildSegments(yield30y);
                            
                            // 尋找最長 10Y 連續段落來繪製下方填充區
                            const longestSegment10y = segments10y.reduce((a, b) => a.split(' ').length > b.split(' ').length ? a : b, '');
                            let area10y = '';
                            if (longestSegment10y) {
                              const points = longestSegment10y.split(' ');
                              if (points.length > 0) {
                                const firstX = points[0].split(',')[0];
                                const lastX = points[points.length - 1].split(',')[0];
                                area10y = `${firstX},100 ${longestSegment10y} ${lastX},100`;
                              }
                            }

                            const lastNonNull = (arr: (number | null)[]) => {
                              for (let i = arr.length - 1; i >= 0; i--) {
                                if (arr[i] !== null) return { value: arr[i] as number, i };
                              }
                              return null;
                            };

                            const last2y = lastNonNull(yield2y);
                            const last10y = lastNonNull(yield10y);
                            const last30y = lastNonNull(yield30y);

                            return (
                              <svg viewBox="0 0 400 100" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                                <defs>
                                  <linearGradient id="chartFill" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                                  </linearGradient>
                                </defs>
                                
                                {area10y && <polygon points={area10y} fill="url(#chartFill)" />}
                                
                                {/* 30Y 紫線（虛線段） */}
                                {segments30y.map((pts, i) => (
                                  <polyline key={`30y-${i}`} points={pts} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4,2" />
                                ))}

                                {/* 10Y 藍線 */}
                                {segments10y.map((pts, i) => (
                                  <polyline key={`10y-${i}`} points={pts} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
                                ))}

                                {/* 2Y 橘線 */}
                                {segments2y.map((pts, i) => (
                                  <polyline key={`2y-${i}`} points={pts} fill="none" stroke="#f97316" strokeWidth="1.5" />
                                ))}
                                
                                {last2y && (
                                  <g>
                                    <circle cx={toX(last2y.i)} cy={toY(last2y.value)} r="3" fill="#f97316" />
                                    <text x={toX(last2y.i) - 5} y={toY(last2y.value) - 4} fontSize="8" fontWeight="bold" fill="#f97316" textAnchor="end">
                                      {(yieldsData.yield2y ?? last2y.value).toFixed(2)}%
                                    </text>
                                  </g>
                                )}
                                {last10y && (
                                  <g>
                                    <circle cx={toX(last10y.i)} cy={toY(last10y.value)} r="4" fill="#3b82f6" />
                                    <text x={toX(last10y.i)} y={toY(last10y.value) - 8} fontSize="9" fontWeight="bold" fill="#3b82f6" textAnchor="middle">
                                      {(yieldsData.yield10y ?? last10y.value).toFixed(2)}%
                                    </text>
                                  </g>
                                )}
                                {last30y && (
                                  <g>
                                    <circle cx={toX(last30y.i)} cy={toY(last30y.value)} r="3" fill="#a855f7" />
                                    <text x={toX(last30y.i) + 5} y={toY(last30y.value) - 4} fontSize="8" fontWeight="bold" fill="#a855f7" textAnchor="start">
                                      {(yieldsData.yield30y ?? last30y.value).toFixed(2)}%
                                    </text>
                                  </g>
                                )}
                              </svg>
                            );
                          })()}
                        </div>
                        
                        <div className="flex justify-between text-[9px] text-text-dim mt-4 font-mono">
                          <span>{yieldsData.chartData.dates[0]?.slice(0, 7)}</span>
                          <span className="text-text-secondary">Summary (2Y/10Y/30Y)</span>
                          <span>{yieldsData.chartData.dates[yieldsData.chartData.dates.length - 1]?.slice(0, 7)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 歷史情境對照 */}
                  {yieldsData.historicalContexts?.length > 0 && (
                    <div className="space-y-4">
                      <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest px-1 flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        🕰️ 歷史相似情境對照 Historical Proxy
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {yieldsData.historicalContexts.map((ctx: any, i: number) => (
                          <motion.div 
                            key={i} 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="bg-card-bg/50 rounded-2xl p-5 border border-border-subtle hover:border-brand/30 transition-colors relative group"
                          >
                            <div className="absolute top-4 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                              <AlertCircle className="w-10 h-10" />
                            </div>
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-text-bright tracking-tight">{ctx.period}</span>
                                <span className="text-[10px] text-brand font-bold uppercase tracking-wider">{ctx.years}</span>
                              </div>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${
                                ctx.similarity === 'identical' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' :
                                ctx.similarity === 'similar' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/20' :
                                'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                              }`}>
                                {ctx.similarity}
                              </span>
                            </div>
                            <div className="space-y-3">
                              <p className="text-[11px] text-text-secondary leading-relaxed">
                                <span className="text-yellow-500/80 font-bold block mb-1 uppercase tracking-tighter text-[9px]">Market Event</span>
                                {ctx.marketEvent}
                              </p>
                              <div className="h-px bg-border-subtle/30 w-full" />
                              <p className="text-[11px] text-text-dim leading-relaxed italic">
                                <span className="text-rose-500/80 font-bold block mb-1 uppercase tracking-tighter text-[9px]">Historical Outcome</span>
                                {ctx.outcome}
                              </p>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : yieldsError ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
               <AlertCircle className="w-8 h-8 text-rose-500/50" />
               <span className="text-text-dim text-sm font-medium">⚠️ {yieldsError}</span>
               <button 
                 onClick={fetchYields} 
                 className="text-brand text-xs font-bold uppercase tracking-widest hover:underline bg-brand/5 px-4 py-2 rounded-lg border border-brand/20"
               >
                 重新取得數據
               </button>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-text-dim italic text-sm">
              數據載入中...
            </div>
          )}
        </section>

        {/* Market Breadth Analysis */}
        <section className="sleek-card md:col-span-2 p-6 overflow-hidden relative">
          <div className="card-title">📊 市場寬度 (Market Breadth)</div>
          
          <div className="text-[9px] text-text-dim/60 mb-3">
            * 集中度溢價基於 QQQ vs RSP 近3個月報酬差；寬度評分基於 Top10 技術面加權計算
          </div>

          {breadthLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCcw className="w-6 h-6 animate-spin text-brand/40" />
            </div>
          ) : breadthData ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-4">
              <div className="lg:col-span-5 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1">寬度評分</span>
                    <span className={`text-xl font-mono font-bold ${
                      breadthData.concentration.breadthScore > 70 ? 'text-emerald-500' :
                      breadthData.concentration.breadthScore > 50 ? 'text-yellow-500' :
                      breadthData.concentration.breadthScore > 30 ? 'text-orange-500' : 'text-rose-500'
                    }`}>{breadthData.concentration.breadthScore}/100</span>
                    <span className="text-[9px] text-text-dim mt-0.5">越高越健康 (0-100)</span>
                  </div>
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1">集中度溢價</span>
                    <span className={`text-xl font-mono font-bold ${
                      breadthData.concentration.concentrationPremium !== null && breadthData.concentration.concentrationPremium !== undefined ? (
                        breadthData.concentration.concentrationTrend === 'extreme' ? 'text-rose-400' :
                        breadthData.concentration.concentrationTrend === 'high' ? 'text-orange-400' :
                        breadthData.concentration.concentrationTrend === 'moderate' ? 'text-yellow-400' :
                        breadthData.concentration.concentrationTrend === 'neutral' ? 'text-text-bright' :
                        'text-emerald-400'
                      ) : 'text-text-dim'
                    }`}>
                      {breadthData.concentration.concentrationPremium !== null && breadthData.concentration.concentrationPremium !== undefined ? 
                        `${breadthData.concentration.concentrationPremium > 0 ? '+' : ''}${breadthData.concentration.concentrationPremium.toFixed(1)}%` 
                        : '計算中...'}
                    </span>
                    <span className="text-[9px] text-text-dim mt-0.5">正值=集中，負值=分散</span>
                    {breadthData.concentration.concentrationPremiumLabel && (
                      <span className="text-[8px] text-text-dim/70 text-center mt-1 scale-90 leading-tight block">{breadthData.concentration.concentrationPremiumLabel}</span>
                    )}
                  </div>
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1 text-center">Top10 50MA以上</span>
                    <span className="text-xl font-mono font-bold text-text-bright">{breadthData.top10AboveMa50Pct ?? breadthData.sp500AboveMa50Estimate}%</span>
                  </div>
                  <div className="bg-card-bg/50 p-4 rounded-xl border border-border-subtle flex flex-col items-center">
                    <span className="text-[10px] font-bold text-text-dim uppercase mb-1 text-center">Top10 200MA以上</span>
                    <span className="text-xl font-mono font-bold text-text-bright">{typeof breadthData.top10AboveMa200Pct === 'number' ? `${breadthData.top10AboveMa200Pct}%` : '--'}</span>
                  </div>

                  {breadthData.concentration.top10WeightEstimate !== undefined && (
                    <div className="bg-card-bg/50 p-3 rounded-xl border border-border-subtle col-span-2 flex items-center justify-between">
                      <div className="flex flex-col text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider">Top 10 S&P 500 總權重</span>
                          {breadthData.concentration.top10WeightIsLive ? (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30 uppercase font-bold">
                              LIVE
                            </span>
                          ) : (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30 font-bold">
                              估算值
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-text-dim/80 mt-0.5 leading-tight">
                          前十強市值佔比，反映巨頭吸金程度與防禦力
                        </span>
                      </div>
                      <span className="text-xl font-mono font-bold text-amber-400 pl-2">
                        {breadthData.concentration.top10WeightEstimate}%
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 space-y-4">
                  <div className={`p-4 rounded-xl border-2 transition-all ${
                    breadthData.breadthSignal === 'healthy' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' :
                    breadthData.breadthSignal === 'narrowing' ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400' :
                    breadthData.breadthSignal === 'concentrated' ? 'border-orange-500/30 bg-orange-500/5 text-orange-400' :
                    'border-rose-500/30 bg-rose-500/5 text-rose-400'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <AlertCircle className="w-4 h-4" />
                      <span className="font-bold text-base">{breadthData.breadthLabel}</span>
                    </div>
                    <p className="text-xs font-medium opacity-90 leading-relaxed">
                      {breadthData.breadthSignal === 'healthy' ? '漲勢具廣泛參與基礎基礎，牛市結構穩健。' :
                       breadthData.breadthSignal === 'narrowing' ? '漲幅開始集中於少數巨頭，需持續觀察。' :
                       breadthData.breadthSignal === 'concentrated' ? '市場明顯集中，防禦性配置重要性提升。' :
                       '市場極端病態集中，歷史性修正風險上升。'}
                    </p>
                  </div>

                  <div className="relative h-2 bg-border-subtle rounded-full overflow-hidden mt-2">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${breadthData.concentration.breadthScore}%` }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      className={`h-full rounded-full ${
                        breadthData.concentration.breadthScore > 70 ? 'bg-emerald-400' :
                        breadthData.concentration.breadthScore > 50 ? 'bg-yellow-400' :
                        breadthData.concentration.breadthScore > 30 ? 'bg-orange-400' : 'bg-rose-400'
                      }`}
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="bg-card-bg/30 rounded-2xl p-5 border border-border-subtle h-full">
                  <div className="text-[10px] text-brand uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                    <Activity className="w-3 h-3" />
                    詳細分析 (Breadth Analysis)
                  </div>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6 font-medium">
                    {breadthData.breadthAnalysis}
                  </p>

                  <div className="space-y-3">
                    <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest px-1">Top 10 個股技術狀態 (依今日漲幅排序)</div>
                    <div className="space-y-1 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                      {[...(breadthData.topStocks || [])]
                        .sort((a, b) => b.changePercent1D - a.changePercent1D)
                        .map((stock: any) => (
                        <div key={stock.symbol} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 rounded-lg transition-colors">
                          <div className="flex flex-col w-20">
                            <span className="text-xs font-mono font-bold text-text-bright">{stock.symbol}</span>
                            <span className="text-[9px] text-text-dim truncate">{stock.name}</span>
                          </div>
                          <div className={`text-xs font-mono font-bold w-14 text-right ${stock.changePercent1D >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {stock.changePercent1D >= 0 ? '+' : ''}{stock.changePercent1D.toFixed(1)}%
                          </div>
                          <div className="flex gap-1">
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${stock.aboveMa50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>50MA</span>
                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${stock.aboveMa200 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>200MA</span>
                          </div>
                          <div className={`text-[10px] font-mono font-bold text-right w-16 ${stock.distanceFromHigh52w > -5 ? 'text-emerald-400' : stock.distanceFromHigh52w > -15 ? 'text-yellow-400' : 'text-rose-400'}`}>
                            {stock.distanceFromHigh52w.toFixed(1)}%
                            <span className="text-[8px] ml-1 opacity-60">ATH</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-text-dim italic text-sm">
              數據載入中...
            </div>
          )}
        </section>
      </div>

      <section className="sleek-card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="card-title m-0">關鍵經濟指標預告</div>
          <div className="flex items-center gap-2 text-[10px] text-brand font-bold uppercase tracking-widest bg-brand/10 px-3 py-1 rounded-full border border-brand/20">
            <Clock className="w-3 h-3" />
            Macro Forecast
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {indicators.map((indicator) => {
            const Icon = indicator.icon;
            return (
              <div 
                key={indicator.id}
                className="bg-dashboard-bg/50 border border-border-subtle p-5 rounded-xl hover:border-brand/40 transition-all group relative animate-fade-in"
              >
                {/* Status Badges */}
                <div className="absolute top-3 right-3 flex gap-1">
                  {macroLoading ? (
                    <div className="text-[8px] font-bold text-white/40 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded uppercase flex items-center gap-1 font-mono">
                      <span className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />
                      Loading
                    </div>
                  ) : indicator.isLive ? (
                    <div className="text-[8px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded uppercase flex items-center gap-1 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Data
                    </div>
                  ) : indicator.isPending ? (
                    <div className="text-[8px] font-bold text-text-dim/60 border border-border-subtle px-1.5 py-0.5 rounded uppercase font-mono">
                      Pending
                    </div>
                  ) : (
                    <div className="text-[8px] font-bold text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded uppercase font-mono">
                      Unreachable
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-brand/10 rounded-lg group-hover:bg-brand/20 transition-colors">
                    <Icon className="w-5 h-5 text-brand" />
                  </div>
                  <div className="text-[10px] font-bold text-text-dim/60 uppercase tracking-widest border-b border-border-subtle pb-1">
                    {indicator.isLive ? 'LIVE INDICATOR' : 'MACRO INDICATOR'}
                  </div>
                </div>
                
                <h3 className="text-sm font-bold text-text-bright mb-1 tracking-tight">{indicator.name}</h3>
                <p className="text-[10px] text-brand/80 font-bold uppercase tracking-wider mb-3">{indicator.label}</p>
                
                <p className="text-xs text-text-dim leading-relaxed mb-4 font-medium line-clamp-3">
                  {indicator.description}
                </p>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="bg-card-bg/40 p-2 rounded-lg border border-border-subtle/50 text-center">
                    <div className="text-[9px] text-text-dim/60 font-bold uppercase mb-1">Previous</div>
                    <div className="text-xs font-mono font-bold text-text-dim">
                      {macroLoading ? '...' : (indicator.previous ?? '--')}
                    </div>
                  </div>
                  <div className="bg-brand/5 p-2 rounded-lg border border-brand/20 text-center ring-1 ring-brand/10 relative overflow-hidden group-hover:ring-brand/40 transition-all font-mono">
                    <div className="text-[9px] text-brand/80 font-bold uppercase mb-1">Actual</div>
                    <div className="text-sm font-mono font-bold text-brand font-semibold">
                      {macroLoading ? '...' : (
                        indicator.pendingRelease ? (
                          <span className="text-[10px] text-blue-400 font-sans tracking-tight">
                            📅 今日 {indicator.nextRelease?.includes(' ') ? indicator.nextRelease.split(' ')[1] : indicator.nextRelease} 發布
                          </span>
                        ) : (
                          indicator.actual ?? '--'
                        )
                      )}
                    </div>
                  </div>
                  <div className="bg-card-bg/40 p-2 rounded-lg border border-border-subtle/50 text-center flex flex-col justify-center items-center">
                    <div className="text-[9px] text-text-dim/60 font-bold uppercase mb-1">Forecast</div>
                    <div className="text-xs font-mono font-bold text-text-bright">
                      {indicator.forecast ?? '--'}
                    </div>
                    {indicator.forecast && (
                      <div className="text-[8px] text-text-dim/40 font-mono mt-0.5 leading-none">
                        {indicator.forecastSource ?? '市場共識'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 py-2 px-3 bg-card-bg/30 border border-border-subtle/50 rounded-lg mb-6 min-h-[38px]">
                  {macroLoading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
                      <span className="text-[10px] text-text-dim/50 font-mono font-medium">載入中...</span>
                    </div>
                  ) : indicator.isLive ? (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_2px] shadow-emerald-400/40 animate-pulse" />
                        <span className="text-[10px] text-emerald-400 font-mono font-bold">
                          FRED Live · {indicator.dataDate?.slice(0, 7) ?? ''}
                        </span>
                      </div>
                      {(() => {
                        const actualNum = parseFloat(indicator.actual || '0');
                        const forecastNum = parseFloat(indicator.forecast || '0');

                        const isInflation = indicator.id === 'cpi' || indicator.id === 'ppi' || indicator.id === 'core_ppi';
                        const isJobs = indicator.id === 'nfp' || indicator.id === 'adp';
                        
                        let statusColor = 'text-yellow-500';
                        let bgColor = 'bg-yellow-500/10';
                        let analysis = '符合預期';

                        if (isInflation) {
                          const threshold = indicator.id === 'ppi' || indicator.id === 'core_ppi' ? 0.1 : 0.05;
                          if (actualNum < forecastNum - threshold) {
                            statusColor = 'text-emerald-500';
                            bgColor = 'bg-emerald-500/10';
                            analysis = indicator.id === 'ppi' ? '通膨回落' :
                                       indicator.id === 'core_ppi' ? '核心通膨回落' :
                                       '通膨降溫';
                          } else if (actualNum > forecastNum + threshold) {
                            statusColor = 'text-rose-500';
                            bgColor = 'bg-rose-500/10';
                            analysis = indicator.id === 'ppi' ? '通膨升溫' :
                                       indicator.id === 'core_ppi' ? '核心通膨升溫' :
                                       '通膨過熱';
                          }
                        } else if (isJobs) {
                          if (actualNum > forecastNum + 10) {
                            statusColor = 'text-emerald-500';
                            bgColor = 'bg-emerald-500/10';
                            analysis = '就業強勁';
                          } else if (actualNum < forecastNum - 10) {
                            statusColor = 'text-rose-500';
                            bgColor = 'bg-rose-500/10';
                            analysis = '勞動疲弱';
                          }
                        }

                        return (
                          <div className={`text-[9px] font-bold uppercase tracking-widest ${statusColor} py-0.5 px-2 rounded ${bgColor}`}>
                            {analysis}
                          </div>
                        );
                      })()}
                    </div>
                  ) : indicator.isPending ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-white/30" />
                      <span className="text-[10px] text-text-dim/60 font-mono font-medium">等待數據發布 (TBD)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500/60" />
                      <span className="text-[10px] text-amber-400 font-mono font-medium font-semibold">數據暫時無法取得</span>
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-2 mt-auto pt-4 border-t border-border-subtle">
                  <Calendar className="w-3.5 h-3.5 text-brand" />
                  <span className="text-[11px] font-mono font-bold text-text-bright">
                    {indicator.nextRelease}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 結構性系統風險雷達 */}
      {(() => {
        const sd = structuralData || {
          aiCapex: { hyOas: 310, hyOasHistory: [], prevMonthAvg: 302, signal: 'yellow' as const, signalLabel: '利差擴大警戒', isLive: false },
          geopolitical: { wtiPrice: 78.5, wtiWeeklyChangePct: 1.25, wtiHistory: [], importPriceYoY: 2.1, importPriceIsLive: false, signal: 'green' as const, signalLabel: '地緣震盪輕微', isLive: false },
          nbfi: { finStressIndex: 0.15, finStressHistory: [], creditCardDelinquency: 3.20, signal: 'yellow' as const, signalLabel: '影子槓桿上揚', isLive: false },
          kEconomy: { creditCardDelinquency: 3.20, autoDelinquency: 2.40, consumerSentiment: 67.4, consumerSentimentHistory: [], signal: 'yellow' as const, signalLabel: '消費雙軌撕裂', isLive: false },
          overallRisk: 'yellow' as const,
          updatedAt: new Date().toISOString(),
          dataSource: 'fallback'
        };

        const radarUpdateLabel = sd.updatedAt 
          ? new Date(sd.updatedAt).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit' }) 
          : '2026/05';

        const getSignalColorClass = (sig: 'green' | 'yellow' | 'red') => {
          if (sig === 'red') return { border: 'border-l-rose-500 hover:border-rose-500/30', badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20' };
          if (sig === 'yellow') return { border: 'border-l-amber-500 hover:border-amber-500/30', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
          return { border: 'border-l-emerald-500 hover:border-emerald-500/30', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
        };

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="sleek-card p-6 mt-8"
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                <h3 className="card-title text-text-bright font-bold m-0">結構性系統風險雷達</h3>
              </div>
              <div className="text-[10px] text-text-bright font-bold uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/10 flex items-center gap-2">
                <SignalLamp status={sd.overallRisk} label={sd.overallRisk === 'red' ? '⚠️ CRITICAL RISK' : sd.overallRisk === 'yellow' ? '⚠️ MEDIUM RISK' : '✅ LOW RISK'} />
                <span className="border-l border-white/10 pl-2 text-rose-400">STRUCTURAL RISK</span>
              </div>
            </div>
            <p className="text-xs text-text-dim mb-6">
              CPI/PPI 是表象指標，以下為底層結構性乾柴——任一引爆均可觸發骨牌效應
            </p>

            {/* 核心連鎖骨牌 */}
            <div className="flex flex-col lg:flex-row items-center justify-between gap-3 p-4 rounded-xl bg-dashboard-bg/30 border border-border-subtle/50 mb-6">
              {[
                { text: '地緣政治/關稅', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
                { text: '停滯性通膨', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20' },
                { text: '央行無法降息', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
                { text: '影子銀行/AI泡沫引爆', color: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
                { text: '系統性崩盤 💥', color: 'text-pink-400 bg-pink-500/20 border-pink-500/40 animate-pulse ring-1 ring-pink-500/30' }
              ].map((item, index, arr) => (
                <React.Fragment key={index}>
                  <div className={`px-4 py-2.5 rounded-lg border text-xs font-bold font-sans tracking-wide ${item.color} text-center flex-1 w-full lg:w-auto`}>
                    {item.text}
                  </div>
                  {index < arr.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-text-dim/40 shrink-0 lg:rotate-0 rotate-90 my-1 lg:my-0" />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* 四燈總覽橫向儀表板 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 bg-dashboard-bg/20 border border-border-subtle/50 rounded-xl p-3.5">
              <div className="flex items-center justify-between p-2 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                <div>
                  <span className="text-[9px] text-text-dim tracking-wider block uppercase font-mono">AI 信貸利差</span>
                  <span className="text-xs font-mono font-bold text-text-bright">{(sd.aiCapex.hyOas ?? 310).toFixed(0)} bps</span>
                </div>
                <SignalLamp status={sd.aiCapex.signal} />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                <div>
                  <span className="text-[9px] text-text-dim tracking-wider block uppercase font-mono">WTI 原油價格</span>
                  <span className="text-xs font-mono font-bold text-text-bright">${(sd.geopolitical.wtiPrice ?? 78.5).toFixed(1)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <SignalLamp status={sd.geopolitical.signal} />
                  <span className={`text-[8px] font-mono mt-0.5 ${sd.geopolitical.wtiWeeklyChangePct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {sd.geopolitical.wtiWeeklyChangePct >= 0 ? '+' : ''}{(sd.geopolitical.wtiWeeklyChangePct ?? 1.2).toFixed(1)}% (週)
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                <div>
                  <span className="text-[9px] text-text-dim tracking-wider block uppercase font-mono">金融壓力指數</span>
                  <span className="text-xs font-mono font-bold text-text-bright">{(sd.nbfi.finStressIndex ?? 0.15).toFixed(2)}</span>
                </div>
                <SignalLamp status={sd.nbfi.signal} />
              </div>

              <div className="flex items-center justify-between p-2 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                <div>
                  <span className="text-[9px] text-text-dim tracking-wider block uppercase font-mono">雙軌消費逾期</span>
                  <span className="text-xs font-mono font-bold text-text-bright">{(sd.kEconomy.creditCardDelinquency ?? 3.20).toFixed(2)}%</span>
                </div>
                <SignalLamp status={sd.kEconomy.signal} />
              </div>
            </div>

            {/* 四張卡片 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Card 1: AI Capex 泡沫幻滅 */}
              {(() => {
                const colors = getSignalColorClass(sd.aiCapex.signal);
                return (
                  <div className={`bg-dashboard-bg/30 hover:bg-dashboard-bg/50 border border-border-subtle ${colors.border} transition-all duration-300 rounded-xl p-5 border-l-4 flex flex-col justify-between relative group`}>
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="text-sm font-bold text-text-bright">AI Capex 泡沫幻滅</h4>
                          <span className="text-[10px] font-mono font-bold text-text-dim/60 block mt-0.5 uppercase tracking-wide">AI Investment ROI Bubble</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${colors.badge} tracking-wider`}>
                          {sd.aiCapex.signal === 'red' ? '🔴 CRITICAL' : sd.aiCapex.signal === 'yellow' ? '⚠️ HIGH RISK' : '🟢 SAFE'}
                        </span>
                      </div>

                      {/* 即時數據顯示 */}
                      <div className="flex items-center justify-between my-4 p-3 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                        <div>
                          <span className="text-[9px] text-text-dim font-mono tracking-wider block uppercase">CRA CREDIT SPREAD (BAMLH0A0HYM2)</span>
                          <span className="text-xl font-mono font-bold text-text-bright flex items-baseline gap-1">
                            {sd.aiCapex.hyOas.toFixed(0)}
                            <span className="text-[11px] text-text-dim font-normal">bps</span>
                          </span>
                          <span className="text-[9px] text-text-dim mt-0.5 block">
                            上月均值 {sd.aiCapex.prevMonthAvg ? `${sd.aiCapex.prevMonthAvg} bps` : '--'} ({sd.aiCapex.isLive ? 'FRED Live' : 'Fallback'})
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <SignalLamp status={sd.aiCapex.signal} label={sd.aiCapex.signalLabel} />
                          <MiniSparkline history={sd.aiCapex.hyOasHistory} color="#f97316" />
                        </div>
                      </div>

                      {/* FCF 監控 - 科技巨頭自由現金流健康度 */}
                      {sd.aiCapex.fcf && (
                        <div className="my-4 border-t border-border-subtle/30 pt-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-mono text-text-bright uppercase tracking-wider font-semibold">
                              Hyperscaler FCF Health（7 巨頭自由現金流）
                            </span>
                            <div className="flex items-center gap-2">
                              {sd.aiCapex.fcf.avgFcfYield !== null && (
                                <span className="text-[9px] font-mono text-text-dim">
                                  均 FCF Yield: <span className={`font-bold ${
                                    sd.aiCapex.fcf.avgFcfYield > 3.5 ? 'text-emerald-400' :
                                    sd.aiCapex.fcf.avgFcfYield > 1.5 ? 'text-amber-400' : 'text-rose-400'
                                  }`}>{sd.aiCapex.fcf.avgFcfYield.toFixed(1)}%</span>
                                </span>
                              )}
                              <SignalLamp
                                status={sd.aiCapex.fcf.compositeSignal}
                                label={
                                  sd.aiCapex.fcf.compositeSignal === 'red' ? '造血能力惡化' :
                                  sd.aiCapex.fcf.compositeSignal === 'yellow' ? 'Capex 侵蝕 FCF' : 'FCF 健全'
                                }
                              />
                            </div>
                          </div>

                          {/* 7 巨頭橫向格子（手機 2x4 或 4 行，桌機 7 列） */}
                          <div className="grid grid-cols-4 lg:grid-cols-7 gap-1.5">
                            {sd.aiCapex.fcf.stocks.map((stock: any) => {
                              const dotColor = stock.signal === 'red' ? 'bg-rose-500' :
                                stock.signal === 'yellow' ? 'bg-amber-400' : 'bg-emerald-400';
                              const textColor = stock.signal === 'red' ? 'text-rose-400' :
                                stock.signal === 'yellow' ? 'text-amber-400' : 'text-emerald-400';
                              const borderColor = stock.signal === 'red' ? 'border-rose-500/30' :
                                stock.signal === 'yellow' ? 'border-amber-400/30' : 'border-emerald-400/20';
                              return (
                                <div key={stock.symbol}
                                  title={`${stock.symbol}（${stock.name}）`}
                                  className={`p-2 rounded-lg bg-card-bg/20 border ${borderColor} flex flex-col items-center gap-1`}>
                                  <div className={`w-2 h-2 rounded-full ${dotColor} ${stock.signal === 'red' ? 'animate-pulse' : ''}`} />
                                  <span className="text-[9px] font-mono font-bold text-text-dim">{stock.symbol}</span>
                                  <span className={`text-[10px] font-mono font-bold ${textColor}`}>
                                    {stock.fcfYield !== null ? `${stock.fcfYield.toFixed(1)}%` : '--'}
                                  </span>
                                  <span className="text-[8px] text-text-dim/40 font-mono">FCF Yield</span>
                                </div>
                              );
                            })}
                          </div>

                          {/* 最嚴重的個股展開（如果有紅燈，展示詳細資訊） */}
                          {sd.aiCapex.fcf.redCount > 0 && (
                            <div className="mt-2 p-2.5 rounded-lg bg-rose-500/5 border border-rose-500/20">
                              <div className="text-[9px] text-rose-400 font-mono font-bold mb-1.5">
                                ⚠️ {sd.aiCapex.fcf.redCount}/{sd.aiCapex.fcf.stocks.length} 家巨頭 FCF 健康亮紅燈
                              </div>
                              <div className="space-y-1">
                                {sd.aiCapex.fcf.stocks
                                  .filter((s: any) => s.signal === 'red')
                                  .map((s: any) => (
                                    <div key={s.symbol} className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                                      <span className="text-rose-400 font-bold">{s.symbol}</span>
                                      <span className="text-text-dim">
                                        Yield {s.fcfYield !== null ? `${s.fcfYield.toFixed(1)}%` : '--'}
                                      </span>
                                      <span className="text-text-dim">
                                        Capex {s.capexRatio !== null ? `${s.capexRatio.toFixed(0)}%↑` : '--'}
                                      </span>
                                      {s.fcfMargin !== null && (
                                        <span className={s.fcfMargin < 10 ? 'text-rose-400' : 'text-text-dim'}>
                                          Margin {s.fcfMargin.toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                  ))
                                }
                              </div>
                            </div>
                          )}

                          {/* 燈號門檻說明 */}
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                            {[
                              { label: 'FCF Yield', green: '>3.5%', yellow: '1.5-3.5%', red: '<1.5%' },
                              { label: 'Capex/OCF', green: '<40%', yellow: '40-65%', red: '>65%' },
                              { label: 'FCF Margin', green: '>20%', yellow: '10-20%', red: '<10%' },
                            ].map(t => (
                              <div key={t.label} className="flex items-center gap-1 text-[8px] font-mono text-text-dim/40">
                                <span>{t.label}:</span>
                                <span className="text-emerald-400/50">{t.green}</span>
                                <span className="text-amber-400/50">{t.yellow}</span>
                                <span className="text-rose-400/50">{t.red}</span>
                              </div>
                            ))}
                            <div className="text-[8px] font-mono text-text-dim/30 ml-auto">
                              {sd.aiCapex.fcf.isLive ? '● Yahoo Finance Live' : '● Fallback 估算'}
                            </div>
                            <div className="text-[8.5px] text-text-dim/25 font-mono mt-1 w-full leading-normal">
                              ※ AAPL FCF Yield 受高市值影響偏低屬正常，ORCL 以 Capex/OCF 為主要參考指標
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3 text-xs font-sans text-text-dim">
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-orange-400 font-bold mb-1">
                            <Zap className="w-3.5 h-3.5 shrink-0" />
                            <span>雪崩觸發點</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            {`2026年中，全球 AI 基建投入主力（微軟、Google、Amazon、Meta、Oracle 雲端擴張）以及消費端 AI 試金石（Apple Intelligence）若無法在財報中展現 ROI，將引發市場對科技股的系統性重新定價。`}
                            {sd.aiCapex.fcf?.avgCapexRatio != null && (
                              <span className={`block mt-1 text-[10px] font-mono font-bold ${
                                (sd.aiCapex.fcf.avgCapexRatio ?? 0) > 65 ? 'text-rose-400' :
                                (sd.aiCapex.fcf.avgCapexRatio ?? 0) > 40 ? 'text-amber-400' : 'text-emerald-400'
                              }`}>
                                ⚡ 當前 {sd.aiCapex.fcf.stocks.length} 巨頭平均 Capex/OCF 比率：{sd.aiCapex.fcf.avgCapexRatio.toFixed(1)}%
                                {(sd.aiCapex.fcf.avgCapexRatio ?? 0) > 65 ? '（已超危險線 65%）' :
                                 (sd.aiCapex.fcf.avgCapexRatio ?? 0) > 40 ? '（接近警戒線 65%）' : '（尚在安全範圍）'}
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-text-secondary font-bold mb-1">
                            <Link className="w-3.5 h-3.5 shrink-0" />
                            <span>連鎖反應</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            整個半導體供應鏈、伺服器代工、AI 晶片巨頭集體估值「雙殺」——獲利下滑（EPS↓）加估值修正（P/E↓），科技權值股面臨集體崩盤壓力。
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-border-subtle/40">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-orange-400 mb-2">
                        <Eye className="w-3.5 h-3.5" />
                        <span>關鍵監控指標</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          "Hyperscaler FCF Yield",
                          "Capex / 營業現金流比",
                          "FCF YoY 成長率",
                          "AI 企業採用率",
                          "NVDA 毛利率趨勢",
                          "雲端收入 YoY"
                        ].map(tag => (
                          <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-dim font-mono">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {"      "}{/* Card 2: 地緣政治碎裂化 */}
              {(() => {
                const colors = getSignalColorClass(sd.geopolitical.signal);
                return (
                  <div className={`bg-dashboard-bg/30 hover:bg-dashboard-bg/50 border border-border-subtle ${colors.border} transition-all duration-300 rounded-xl p-5 border-l-4 flex flex-col justify-between relative group`}>
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="text-sm font-bold text-text-bright">地緣政治碎裂化</h4>
                          <span className="text-[10px] font-mono font-bold text-text-dim/60 block mt-0.5 uppercase tracking-wide">Geoeconomic Fragmentation & Supply Chain</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${colors.badge} tracking-wider`}>
                          {sd.geopolitical.signal === 'red' ? '🔴 CRITICAL' : sd.geopolitical.signal === 'yellow' ? '⚠️ ELEVATED' : '🟢 SAFE'}
                        </span>
                      </div>

                      {/* 即時數據顯示 */}
                      <div className="flex items-center justify-between my-4 p-3 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                        <div>
                          <span className="text-[9px] text-text-dim font-mono tracking-wider block uppercase">WTI CRUDE OIL (DCOILWTICO)</span>
                          <span className="text-xl font-mono font-bold text-text-bright flex items-baseline gap-1">
                            ${sd.geopolitical.wtiPrice.toFixed(1)}
                            <span className="text-[11px] text-text-dim font-normal">/ bbl</span>
                            <span className={`text-xs ml-1 font-sans ${sd.geopolitical.wtiWeeklyChangePct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              ({sd.geopolitical.wtiWeeklyChangePct >= 0 ? '↑' : '↓'}{Math.abs(sd.geopolitical.wtiWeeklyChangePct).toFixed(1)}% 週)
                            </span>
                          </span>
                          <span className="text-[9px] text-text-dim mt-0.5 block">
                            進口價格 YoY: {sd.geopolitical.importPriceYoY > 0 ? '+' : ''}{sd.geopolitical.importPriceYoY.toFixed(1)}% ({sd.geopolitical.importPriceIsLive ? 'FRED Live' : 'Fallback'})
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <SignalLamp status={sd.geopolitical.signal} label={sd.geopolitical.signalLabel} />
                          <MiniSparkline history={sd.geopolitical.wtiHistory} color="#f59e0b" />
                        </div>
                      </div>

                      <div className="space-y-3 text-xs font-sans text-text-dim">
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-amber-400 font-bold mb-1">
                            <Zap className="w-3.5 h-3.5 shrink-0" />
                            <span>雪崩觸發點</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            ① 中東衝突擴大至能源基礎設施（油田、海峽航道）實質毀損 → 油價暴漲；② 全面性高關稅貿易戰升級 → 成本轉嫁形成「停滯性通膨（Stagflation）」。
                          </p>
                        </div>
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-text-secondary font-bold mb-1">
                            <Link className="w-3.5 h-3.5 shrink-0" />
                            <span>市場盲點</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            當前美股風險溢酬（Risk Premium）處於歷史低位，市場幾乎沒有對「半導體+能源雙斷鏈」進行任何風險定價，一旦定價修正將極為劇烈。
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-border-subtle/40">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 mb-2">
                        <Eye className="w-3.5 h-3.5" />
                        <span>關鍵監控指標</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["WTI 油價", "波斯灣航運指數", "美中關稅清單", "CHIPS Act 執行進度"].map(tag => (
                          <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-dim font-mono">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {"      "}{/* Card 3: NBFI 影子銀行流動性炸彈 */}
              {(() => {
                const colors = getSignalColorClass(sd.nbfi.signal);
                return (
                  <div className={`bg-dashboard-bg/30 hover:bg-dashboard-bg/50 border border-border-subtle ${colors.border} transition-all duration-300 rounded-xl p-5 border-l-4 flex flex-col justify-between relative group`}>
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="text-sm font-bold text-text-bright">NBFI 影子銀行流動性炸彈</h4>
                          <span className="text-[10px] font-mono font-bold text-text-dim/60 block mt-0.5 uppercase tracking-wide">Non-Bank Financial Institutions Leverage Risk</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${colors.badge} tracking-wider`}>
                          {sd.nbfi.signal === 'red' ? '🔴 CRITICAL' : sd.nbfi.signal === 'yellow' ? '⚠️ HIGH RISK' : '🟢 SAFE'}
                        </span>
                      </div>

                      {/* 即時數據顯示 */}
                      <div className="flex items-center justify-between my-4 p-3 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                        <div>
                          <span className="text-[9px] text-text-dim font-mono tracking-wider block uppercase">FED FINANCIAL STRESS INDEX (STLFSI2)</span>
                          <span className="text-xl font-mono font-bold text-text-bright flex items-baseline gap-1">
                            {sd.nbfi.finStressIndex.toFixed(2)}
                            <span className="text-[11px] text-text-dim font-normal">pts</span>
                          </span>
                          <span className="text-[9px] text-text-dim mt-0.5 block">信用卡逾期率: {sd.nbfi.creditCardDelinquency.toFixed(2)}% ({sd.nbfi.isLive ? 'FRED Live' : 'Fallback'})</span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <SignalLamp status={sd.nbfi.signal} label={sd.nbfi.signalLabel} />
                          <MiniSparkline history={sd.nbfi.finStressHistory} color="#f43f5e" />
                        </div>
                      </div>

                      <div className="space-y-3 text-xs font-sans text-text-dim">
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-rose-400 font-bold mb-1">
                            <Zap className="w-3.5 h-3.5 shrink-0" />
                            <span>雪崩觸發點</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            「Higher for Longer」高利率維持超預期久，大量中型企業的私有信貸（Private Credit）違約率默默飆升。影子銀行缺乏聯準會直接流動性支持。
                          </p>
                        </div>
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-text-secondary font-bold mb-1">
                            <Link className="w-3.5 h-3.5 shrink-0" />
                            <span>連鎖反應</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            一旦大型對沖基金或私有信貸基金因「Crowded Trades + 高槓桿」爆倉，被迫變現（Forced Deleveraging）。為籌現金，將優先拋售流動性最好的資產——美股科技龍頭、台股權值股——觸發「資產越好越被砸盤」的金融海嘯式雪崩。
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-border-subtle/40">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-rose-400 mb-2">
                        <Eye className="w-3.5 h-3.5" />
                        <span>關鍵監控指標</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["Private Credit 違約率", "高收益債 OAS 利差", "對沖基金槓桿率", "Repo Market 壓力"].map(tag => (
                          <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-dim font-mono">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {"      "}{/* Card 4: K 型經濟撕裂與消費斷崖 */}
              {(() => {
                const colors = getSignalColorClass(sd.kEconomy.signal);
                return (
                  <div className={`bg-dashboard-bg/30 hover:bg-dashboard-bg/50 border border-border-subtle ${colors.border} transition-all duration-300 rounded-xl p-5 border-l-4 flex flex-col justify-between relative group`}>
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="text-sm font-bold text-text-bright">K 型經濟撕裂與消費斷崖</h4>
                          <span className="text-[10px] font-mono font-bold text-text-dim/60 block mt-0.5 uppercase tracking-wide">K-shaped Economy & Consumer Credit Fracture</span>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${colors.badge} tracking-wider`}>
                          {sd.kEconomy.signal === 'red' ? '🔴 CRITICAL' : sd.kEconomy.signal === 'yellow' ? '⚠️ WATCH' : '🟢 SAFE'}
                        </span>
                      </div>

                      {/* 即時數據顯示 */}
                      <div className="flex items-center justify-between my-4 p-3 rounded-lg bg-card-bg/20 border border-border-subtle/30">
                        <div>
                          <span className="text-[9px] text-text-dim font-mono tracking-wider block uppercase">CC DELINQUENCY & SENTIMENT (UMCSENT)</span>
                          <span className="text-xl font-mono font-bold text-text-bright flex items-baseline gap-1.5">
                            {sd.kEconomy.creditCardDelinquency.toFixed(2)}%
                            <span className="text-[11px] font-normal text-text-dim">逾期</span>
                            <span className="border-l border-white/10 pl-2 ml-1 text-text-bright text-[13px] font-normal font-sans">
                              信心指數: {sd.kEconomy.consumerSentiment.toFixed(1)}
                            </span>
                          </span>
                          <span className="text-[9px] text-text-dim mt-0.5 block">消費性貸款逾期率 (DRCCLOBS): {sd.kEconomy.autoDelinquency.toFixed(2)}% ({sd.kEconomy.isLive ? 'FRED Live' : 'Fallback'})</span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <SignalLamp status={sd.kEconomy.signal} label={sd.kEconomy.signalLabel} />
                          <MiniSparkline history={sd.kEconomy.consumerSentimentHistory} color="#a855f7" />
                        </div>
                      </div>

                      <div className="space-y-3 text-xs font-sans text-text-dim">
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-purple-400 font-bold mb-1">
                            <Zap className="w-3.5 h-3.5 shrink-0" />
                            <span>核心矛盾</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            頂端 20% 靠股市資產膨脹持續消費，但底層 80% 正被高居住成本、信用卡與汽車貸款利率榨乾，形成深度撕裂。
                          </p>
                        </div>
                        <div className="bg-card-bg/25 p-3 rounded-lg border border-border-subtle/30">
                          <div className="flex items-center gap-1.5 text-text-secondary font-bold mb-1">
                            <Link className="w-3.5 h-3.5 shrink-0" />
                            <span>雪崩觸發點</span>
                          </div>
                          <p className="leading-relaxed text-[11px]">
                            信用卡與汽車貸款違約率已升至警戒線。一旦寒氣傳導至頂端，全美零售消費（佔 GDP 70%）出現斷崖式下滑，市場將從定價「軟著陸」瞬間轉為定價「硬著陸/衰退」。
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-border-subtle/40">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-purple-400 mb-2">
                        <Eye className="w-3.5 h-3.5" />
                        <span>關鍵監控指標</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {["信用卡逾期率 (Fed Z.1)", "消費性貸款逾期率", "消費者信心指數", "Target/Walmart 同店銷售"].map(tag => (
                          <span key={tag} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-text-dim font-mono">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 核心總結欄 */}
            <div className="mt-5 p-4 rounded-xl bg-rose-500/5 border border-border-subtle border-l-4 border-l-rose-500 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1">
                <h5 className="text-xs font-bold text-rose-400 flex items-center gap-2 mb-1.5">
                  <span>🎯</span> 最高機率雪崩劇本（骨牌路徑）
                </h5>
                <p className="text-[11px] leading-relaxed text-text-dim">
                  CPI/PPI 是表象的數據指標，底層結構性乾柴的引爆順序最可能為：
                  地緣政治/關稅衝擊（引發停滯性通膨） → 迫使央行無法降息（Higher for Longer 超預期） →
                  最終引爆影子銀行槓桿爆倉或 AI Capex 泡沫破裂 → 系統性資產殺盤。
                  任何單一觸發點的嚴重程度，取決於其他風險因子的累積程度——這是一個相互強化的脆弱系統。
                </p>
              </div>
              <div className="text-[9px] text-text-dim/40 font-mono self-end md:self-center shrink-0">
                分析更新：{radarUpdateLabel} ({sd.dataSource === 'fred' ? 'Live FRED API' : 'Fallback Data'})
              </div>
            </div>
          </motion.div>
        );
      })()}

      <div className="sleek-card border-dashed bg-transparent items-center text-center">
        <p className="text-xs text-text-dim leading-relaxed max-w-lg">
          宏觀經濟指標是市場波動的主要驅動力。大非農與 CPI 對利率預期有決定性影響，建議在數據發布前後保持機動艙位管理。
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 flex items-center gap-2 px-4 py-2 hover:bg-white/5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
        >
          <RefreshCcw className="w-3 h-3" />
          Synchronize Data
        </button>
      </div>

      {/* 日圓套利交易風險監控 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="sleek-card mt-8"
      >
        {/* 1. 標題列 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-subtle pb-4 mb-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 animate-pulse" />
            <h3 className="card-title text-text-bright font-bold">日圓套利交易風險監控 (Yen Carry Trade)</h3>
          </div>
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
            </span>
            <span className="text-[10px] uppercase tracking-widest font-mono font-bold text-yellow-500 py-0.5 px-2 bg-yellow-500/10 rounded">
              MONITORING
            </span>
          </div>
        </div>

        {/* 2. 利差儀表板 (grid 3 欄) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* 卡片A: 聯準會利率 */}
          <div className="p-4 rounded-xl border border-rose-500/10 bg-rose-500/5 hover:border-rose-500/20 transition-all">
            <div className="flex justify-between items-center mb-1">
              <div className="text-xs text-rose-400 font-bold">聯準會利率</div>
              {carryData?.fedIsLive ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                  FRED LIVE
                </span>
              ) : carryData ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30">
                  估算值
                </span>
              ) : null}
            </div>
            <div className="text-2xl font-mono font-bold text-rose-500">
              {carryData ? carryData.fedRateRange : (
                <span className="inline-block w-24 h-6 bg-white/10 rounded animate-pulse" />
              )}
            </div>
            <div className="text-[11px] text-text-dim mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              {fedLabel}
            </div>
          </div>

          {/* 卡片B: 日銀利率 */}
          <div className="p-4 rounded-xl border border-blue-500/10 bg-blue-500/5 hover:border-blue-500/20 transition-all">
            <div className="flex justify-between items-center mb-1">
              <div className="text-xs text-blue-400 font-bold font-sans">日銀利率</div>
              {carryData?.bojIsLive ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                  FRED LIVE
                </span>
              ) : carryData ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30">
                  估算值
                </span>
              ) : null}
            </div>
            <div className="text-2xl font-mono font-bold text-blue-400">
              {carryData ? `${carryData.bojRate.toFixed(2)}%` : (
                <span className="inline-block w-24 h-6 bg-white/10 rounded animate-pulse" />
              )}
            </div>
            <div className="text-[11px] text-text-dim mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              {bojLabel}
            </div>
          </div>

          {/* 卡片C: 名目利差 */}
          <div className="p-4 rounded-xl border border-brand/10 bg-brand/5 hover:border-brand/20 transition-all">
            <div className="text-xs text-brand font-bold mb-1">名目利差</div>
            <div className="text-2xl font-mono font-bold text-brand">
              {carryData ? `${carryData.nominalSpread.toFixed(2)}%` : (
                <span className="inline-block w-24 h-6 bg-white/10 rounded animate-pulse" />
              )}
            </div>
            <p className="text-[11px] text-text-dim mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-brand"></span>
              實質利差 ≈ {carryData ? `${carryData.realSpread.toFixed(1)}%` : (
                <span className="inline-block w-16 h-4 bg-white/10 rounded animate-pulse ml-1" />
              )}
            </p>
            {carryData && (
              <p className="text-[9px] text-text-dim/50 mt-1 font-mono">
                通膨差 {carryData.inflationDiff?.toFixed(1) ?? '1.5'}%
                {carryData.inflationDiff ? 
                  <span className="text-emerald-500/70 ml-1">● FRED Live</span> : 
                  <span className="text-text-dim/40 ml-1">● 估算值</span>
                }
              </p>
            )}
          </div>
        </div>

        {/* 3. 兩個臨界點警示 (左右 2 欄 grid) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 臨界點一 */}
          <div className="p-4 rounded-xl border border-border-subtle bg-card-bg/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-yellow-500 py-0.5 px-2 bg-yellow-500/10 rounded-md">
                  THRESHOLD 01
                </span>
                <span className="text-xs text-text-dim flex items-center gap-1">
                  危險臨界值: <span className="font-mono font-bold text-yellow-500">3.5%</span>
                </span>
              </div>
              <h4 className="text-sm font-bold text-text-bright mb-3">實質利差縮小臨界</h4>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-3xl font-mono font-bold text-yellow-500">
                  {carryData ? `${carryData.realSpread.toFixed(2)}%` : (
                    <span className="inline-block w-24 h-8 bg-white/10 rounded animate-pulse" />
                  )}
                </span>
                <span className="text-xs text-text-secondary">
                  距警戒線 3.5% (差距 {carryData ? (carryData.realSpread - 3.5).toFixed(2) : (
                    <span className="inline-block w-8 h-4 bg-white/10 rounded animate-pulse" />
                  )}%)
                </span>
              </div>
            </div>
            
            <div>
              {/* 進度條 */}
              <div className="mb-4">
                <div className="h-1.5 w-full bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${carryData ? Math.min(carryData.realSpreadProgress, 100) : 0}%` }}
                    transition={{ duration: 1.5 }}
                    className="h-full bg-yellow-500 rounded-full"
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-text-dim">安全</span>
                  <span className="text-[10px] text-yellow-500 font-bold">
                    {carryData ? `接近臨界點 (${Math.min(carryData.realSpreadProgress, 100).toFixed(0)}%)` : (
                      <span className="inline-block w-16 h-3 bg-white/10 rounded animate-pulse" />
                    )}
                  </span>
                </div>
              </div>
              <div className="p-2.5 rounded bg-yellow-500/5 border border-yellow-500/10 text-[11px] text-yellow-400 leading-relaxed flex gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>觸發後影響：</strong>對沖基金開始評估日元套利部位盈虧平衡點，觸發程序性平倉訊號。
                </span>
              </div>
            </div>
          </div>

          {/* 臨界點二 */}
          <div className="p-4 rounded-xl border border-border-subtle bg-card-bg/40 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold text-emerald-500 py-0.5 px-2 bg-emerald-500/10 rounded-md">
                    THRESHOLD 02
                  </span>
                  {carryData?.usdJpyIsLive ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                      LIVE
                    </span>
                  ) : carryData ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono border border-amber-500/30">
                      估算值
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-text-dim flex items-center gap-1">
                  危險臨界值: USD/JPY <span className="text-rose-400 font-bold font-sans">下跌</span> 3–5%
                </span>
              </div>
              <h4 className="text-sm font-bold text-text-bright mb-3">USD/JPY 單周暴跌臨界 (日圓暴升)</h4>
              <div className="flex items-baseline gap-2 flex-wrap mb-4">
                <span className={`text-3xl font-mono font-bold ${usdJpyColor.text}`}>
                  {USDJPY_WEEKLY_CHANGE >= 0 ? '+' : ''}{USDJPY_WEEKLY_CHANGE}%
                </span>
                <span className="text-xs text-text-secondary">
                  週漲幅 (距警戒線 3–5%)
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                  USDJPY_WEEKLY_CHANGE >= 0 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }`}>
                  {USDJPY_WEEKLY_CHANGE >= 0 ? '日圓貶值 ↓ 安全' : '日圓升值 ↑ 危險'}
                </span>
              </div>
            </div>

            <div>
              {/* 進度條 */}
              <div className="mb-4">
                <div className="h-1.5 w-full bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${usdJpyProgress}%` }}
                    transition={{ duration: 1.5 }}
                    className={`h-full rounded-full ${usdJpyColor.bar}`}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-text-dim">安全</span>
                  <span className={`text-[10px] font-bold ${usdJpyColor.text}`}>{usdJpyColor.label}</span>
                </div>
                {/* 閾值說明 */}
                <div className="flex justify-between text-[9px] text-text-dim/50 mt-1 font-mono">
                  <span>不危險</span>
                  <span className="text-yellow-500/70 py-0.5 px-1 rounded bg-yellow-500/5 border border-yellow-500/10">黃燈 下跌 2.5%</span>
                  <span className="text-rose-500/70 py-0.5 px-1 rounded bg-rose-500/5 border border-rose-500/10">紅燈 下跌 3.5%</span>
                  <span>極危險</span>
                </div>
              </div>
              <div className={`p-2.5 rounded text-[11px] leading-relaxed flex gap-1.5 border ${usdJpyColor.border} ${usdJpyColor.bg} ${usdJpyColor.text}`}>
                <Activity className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 animate-pulse" />
                <span>
                  <strong>觸發後影響：</strong>日圓不理性暴漲 → 持有美元資產的套利方匯損放大 → 強制平倉賣美股買回日圓。
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. 傳導鏈 (Contagion Chain) 視覺化 */}
        <div className="mb-6">
          <div className="text-xs font-bold text-text-secondary mb-3 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-rose-500" />
            日圓套利交易平倉傳導鏈 (Contagion Chain)
          </div>
          <div className="p-4 rounded-xl border border-rose-500/10 bg-rose-500/5">
            <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-3 text-center">
              <div className="flex-1 min-w-[120px] bg-card-bg/60 border border-border-subtle rounded-lg px-3 py-2">
                <div className="text-[10px] text-text-dim mb-0.5">STEP 1</div>
                <div className="text-xs font-bold text-text-bright">美股下跌</div>
              </div>
              <div className="text-rose-500 font-bold select-none text-sm md:text-base animate-pulse">→</div>
              
              <div className="flex-1 min-w-[120px] bg-card-bg/60 border border-border-subtle rounded-lg px-3 py-2">
                <div className="text-[10px] text-text-dim mb-0.5">STEP 2</div>
                <div className="text-xs font-bold text-text-bright">虧損擴大</div>
              </div>
              <div className="text-rose-500 font-bold select-none text-sm md:text-base animate-pulse">→</div>

              <div className="flex-1 min-w-[120px] bg-card-bg/60 border border-border-subtle rounded-lg px-3 py-2">
                <div className="text-[10px] text-text-dim mb-0.5">STEP 3</div>
                <div className="text-xs font-bold text-text-bright">保證金追繳</div>
              </div>
              <div className="text-rose-500 font-bold select-none text-sm md:text-base animate-pulse">→</div>

              <div className="flex-1 min-w-[120px] bg-card-bg/60 border border-border-subtle rounded-lg px-3 py-2">
                <div className="text-[10px] text-text-dim mb-0.5">STEP 4</div>
                <div className="text-xs font-bold text-text-bright">強制拋售美股</div>
              </div>
              <div className="text-rose-500 font-bold select-none text-sm md:text-base animate-pulse">→</div>

              <div className="flex-1 min-w-[120px] bg-card-bg/60 border border-border-subtle rounded-lg px-3 py-2">
                <div className="text-[10px] text-text-dim mb-0.5">STEP 5</div>
                <div className="text-xs font-bold text-text-bright">買回日圓還債</div>
              </div>
            </div>
          </div>
        </div>

        {/* 5. 日圓投機空單部位監控 */}
        <div className="bg-card-bg/20 rounded-2xl border border-border-subtle p-5 space-y-4 mb-6">
          {/* 標題列 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {isNewPeak || isDanger ? (
                <TrendingUp className="w-4 h-4 text-rose-400 animate-pulse" />
              ) : (
                <TrendingDown className="w-4 h-4 text-emerald-400" />
              )}
              <span className="text-sm font-bold text-text-bright">
                日圓投機空單部位 (JPY Speculative Short)
              </span>
              <span className={cotBadgeStyle}>
                {cotBadgeText}
              </span>
              {cotData?.isLive ? (
                <span className="text-[9px] font-bold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded uppercase tracking-widest">
                  {cotData.dataSource === 'nasdaq' ? 'CFTC · Nasdaq' : 'CFTC Live'}
                </span>
              ) : (
                <span className="text-[9px] font-bold text-yellow-500/70 border border-yellow-500/20 bg-yellow-500/5 px-1.5 py-0.5 rounded uppercase tracking-widest">
                  ⚠ 估算數據
                </span>
              )}
            </div>
            <div className="text-[9px] text-text-dim/60 font-mono">
              來源：CFTC COT 報告 · 每周五更新
            </div>
          </div>

          {/* 主體：左側儀表 + 右側圖表 */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* 左側 lg:col-span-5 */}
            <div className="lg:col-span-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* 當前部位卡片 */}
                <div className={`p-5 rounded-xl border transition-colors duration-500 ${currentShortCardBorder}`}>
                  <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${currentShortLabelColor}`}>
                    當前空單部位
                  </div>
                  <div className={currentShortTextColor}>
                    {(CURRENT_SHORT / 10000).toFixed(1)} <span className="text-lg">萬口</span>
                  </div>
                  <div className="text-[10px] text-text-dim mt-1">{(CURRENT_SHORT).toLocaleString()} contracts · {cotData?.isLive ? "最新 COT 報告" : "2026年5月"}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${currentShortBadgeStyle}`}>
                      {changeDirectionSymbol} {changeDirectionLabel} {displayReductionPct.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* 歷史峰值卡片 */}
                <div className="bg-card-bg/50 p-5 rounded-xl border border-rose-500/20">
                  <div className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">
                    歷史峰值（最危險時）
                  </div>
                  <div className="text-3xl font-mono font-bold text-rose-400">
                    {(PEAK_SHORT / 10000).toFixed(1)} <span className="text-lg">萬口</span>
                  </div>
                  <div className="text-[10px] text-text-dim mt-1">{(PEAK_SHORT).toLocaleString()} contracts · {cotData?.peakDate ? cotData.peakDate.replace('-', '年') + '月' : '2024年8月'}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[9px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full">
                      {cotData?.isNewAllTimeHigh
                        ? '⚠️ 最新歷史新高峰值'
                        : isHistoricAug2024
                          ? '2024年8月暴跌導火線'
                          : `${peakDateLabel}歷史高位`
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* 殘留風險進度條 */}
              <div className="bg-card-bg/30 p-4 rounded-xl border border-border-subtle">
                <div className="flex justify-between text-[10px] mb-2">
                  <span className="text-text-dim font-bold uppercase tracking-wider">踩踏風險殘留</span>
                  <span className={`font-mono font-bold ${isNewPeak || isDanger ? 'text-rose-400' : isWarning ? 'text-yellow-400' : 'text-emerald-400'}`}>{riskFromPeak}% / 峰值</span>
                </div>
                <div className="h-2 bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(riskFromPeak, 100)}%` }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                    className={`h-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500 ${isNewPeak || isDanger ? 'animate-pulse' : ''}`}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-text-dim/50 mt-1 font-mono">
                  <span>0% 完全平倉</span>
                  <span className="text-yellow-500/70">警戒 {(WARNING_THRESHOLD/10000).toFixed(0)}萬口</span>
                  <span className="text-rose-500/70">危險 {(DANGER_THRESHOLD/10000).toFixed(0)}萬口</span>
                  <span>峰值 {(PEAK_SHORT/10000).toFixed(1)}萬口</span>
                </div>
              </div>

              {/* 結論文字框 */}
              <div className={`p-4 rounded-xl border transition-all duration-300 ${cotCardBorder} ${cotCardBg}`}>
                <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5 ${cotCardLabelColor}`}>
                  <Activity className="w-3 h-3" />
                  風險評估結論
                </div>
                <p className={`text-xs leading-relaxed font-semibold whitespace-pre-line ${cotCardTextColor}`}>
                  {dynamicConclusionText}
                </p>
                <div className="mt-2.5 text-[10px] leading-relaxed text-text-bright/90 font-medium">
                  {monitoringText}
                </div>

                {/* 歷史事件回顧對照 */}
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-[10px] text-text-dim mb-2 leading-relaxed">
                    ※ 以下為 <span className="text-amber-400">2024年8月</span> 套利崩盤的歷史案例，作為當前風險評估的參照基準
                    {!isHistoricAug2024 && (
                      <span className="text-rose-400">（⚠️ 當前峰值已超越該歷史事件，參考意義請結合 {peakDateLabel} 新峰值判讀）</span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-text-bright uppercase tracking-wider mb-2.5">
                    <Clock className="w-3.5 h-3.5 text-rose-400" />
                    <span>2024年8月｜歷史參考：日圓套利崩盤「市場衝擊與修復歷程」</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className="bg-black/25 p-2 rounded border border-white/5 flex flex-col justify-between">
                      <span className="text-text-dim font-medium">日經 225 指數</span>
                      <span className="text-rose-400 font-bold font-mono text-xs my-1">修正跌幅 -25.5%</span>
                      <span className="text-text-bright/70 text-[9px] leading-tight">單日狂瀉 12.4%<br/>花費約 <span className="text-yellow-400 font-bold font-mono">2 個月</span> 震盪修復</span>
                    </div>
                    <div className="bg-black/25 p-2 rounded border border-white/5 flex flex-col justify-between">
                      <span className="text-text-dim font-medium">那斯達克 (Nasdaq)</span>
                      <span className="text-rose-400 font-bold font-mono text-xs my-1">修正跌幅 -13.1%</span>
                      <span className="text-text-bright/70 text-[9px] leading-tight">科技巨幅估值洗牌<br/>大約 <span className="text-yellow-400 font-bold font-mono">1.5 個月</span> 重返牛市</span>
                    </div>
                    <div className="bg-black/25 p-2 rounded border border-white/5 flex flex-col justify-between">
                      <span className="text-text-dim font-medium">標普 500 (S&P 500)</span>
                      <span className="text-rose-400 font-bold font-mono text-xs my-1">修正跌幅 -8.5%</span>
                      <span className="text-text-bright/70 text-[9px] leading-tight">V型強勢收復<br/>僅用 <span className="text-emerald-400 font-bold font-mono">17 天</span> 創歷史新高</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-text-dim/85 mt-2.5 leading-relaxed">
                    💡 <span className="font-bold text-text-bright">數據啟示</span>：日圓套利平倉引發的爆發性修正具備「短線殺力極其猛烈、多殺多見底訊號快」之特徵。由於其本質並非實體經濟衰退，而是純保證金流動性踩踏，故在平倉動能釋放完畢後，<span className="text-emerald-400 font-semibold">美股大約在 1.5 個月內便可完全重新踏上牛市軌道</span>（標普更創神速17天收復紀錄），日經則需 2 個月完成底部的修復與橫盤。
                  </p>
                </div>

                {!cotData?.isLive && (
                  <div className="mt-2.5 p-2 rounded bg-yellow-500/5 border border-yellow-500/10 text-[9px] text-yellow-500/70 leading-relaxed">
                    ⚠ 歷史數據為市場估算值，非 CFTC 官方原始數字。如需精確數據，請至 
                    <a href="https://data.nasdaq.com/data/CFTC/097741_FO_ALL_CR" target="_blank" rel="noopener" className="underline ml-1">
                      Nasdaq Data Link
                    </a> 查閱（免費，需 API Key）。
                  </div>
                )}
              </div>
            </div>

            {/* 右側 lg:col-span-7 */}
            <div className="lg:col-span-7">
              {(() => {
                const W = 400, H = 160;
                const PAD = { top: 20, right: 20, bottom: 30, left: 50 };
                const chartW = W - PAD.left - PAD.right;
                const chartH = H - PAD.top - PAD.bottom;
                
                const maxVal = 200000;
                const minVal = 0;
                
                const toX = (i: number) => PAD.left + (i / (COT_DATA.length - 1)) * chartW;
                const toY = (v: number) => PAD.top + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;
                
                const points = COT_DATA.map((d, i) => `${toX(i)},${toY(d.contracts)}`).join(' ');
                const areaPoints = `${PAD.left},${PAD.top + chartH} ${points} ${toX(COT_DATA.length - 1)},${PAD.top + chartH}`;
                
                const dangerY = toY(DANGER_THRESHOLD);
                const warningY = toY(WARNING_THRESHOLD);
                const currentY = toY(CURRENT_SHORT);
                
                return (
                  <div className="bg-card-bg/30 rounded-xl border border-border-subtle p-4 h-full flex flex-col">
                    <div className="text-[10px] text-text-dim uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                      <BarChart3 className="w-3 h-3" />
                      JPY 投機空單歷史趨勢 (CFTC COT)
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full flex-1" preserveAspectRatio="xMidYMid meet">
                      <defs>
                        <linearGradient id="cotFill" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      
                      {/* 危險線 */}
                      <line x1={PAD.left} y1={dangerY} x2={W - PAD.right} y2={dangerY}
                        stroke="#f43f5e" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
                      <text x={W - PAD.right + 2} y={dangerY + 3} fontSize="7" fill="#f43f5e" opacity="0.8">危險</text>
                      
                      {/* 警戒線 */}
                      <line x1={PAD.left} y1={warningY} x2={W - PAD.right} y2={warningY}
                        stroke="#eab308" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
                      <text x={W - PAD.right + 2} y={warningY + 3} fontSize="7" fill="#eab308" opacity="0.8">警戒</text>
                      
                      {/* 面積填充 */}
                      <polygon points={areaPoints} fill="url(#cotFill)" />
                      
                      {/* 折線 (已驗證與估算分段繪製) */}
                      {COT_DATA.map((d, i) => {
                        if (i === 0) return null;
                        const prev = COT_DATA[i-1];
                        const x1 = toX(i-1);
                        const y1 = toY(prev.contracts);
                        const x2 = toX(i);
                        const y2 = toY(d.contracts);
                        const isSegmentVerified = prev.isVerified && d.isVerified;
                        
                        return (
                          <line 
                            key={i}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={isSegmentVerified ? "#f97316" : "rgba(255,255,255,0.4)"}
                            strokeWidth="2.5"
                            strokeDasharray={isSegmentVerified ? "none" : "3,3"}
                            strokeLinecap="round"
                          />
                        );
                      })}
                      
                      {/* 各歷史數據端端點 */}
                      {COT_DATA.map((d, i) => {
                        if (i === 0 || i === COT_DATA.length - 1) return null;
                        return (
                          <circle 
                            key={i}
                            cx={toX(i)}
                            cy={toY(d.contracts)}
                            r="3"
                            fill={d.isVerified ? "#f97316" : "rgba(255,255,255,0.4)"}
                            stroke="#1e293b"
                            strokeWidth="1"
                          />
                        );
                      })}
                      
                      {/* 最新點（綠色） */}
                      <circle cx={toX(COT_DATA.length - 1)} cy={currentY} r="5" fill="#10b981" />
                      <circle cx={toX(COT_DATA.length - 1)} cy={currentY} r="9" fill="#10b981" opacity="0.2" />
                      <text x={toX(COT_DATA.length - 1) - 5} y={currentY - 10} fontSize="8" fill="#10b981" fontWeight="bold" textAnchor="middle">{(CURRENT_SHORT / 10000).toFixed(1)}萬口</text>
                      
                      {/* 峰值點（紅色） */}
                      <circle cx={toX(0)} cy={toY(PEAK_SHORT)} r="4" fill="#f43f5e" />
                      <text x={toX(0)} y={toY(PEAK_SHORT) - 7} fontSize="8" fill="#f43f5e" fontWeight="bold" textAnchor="middle">{(PEAK_SHORT / 10000).toFixed(1)}萬</text>
                      
                      {/* Y軸刻度 */}
                      {[0, 50000, 100000, 150000, 200000].map(v => (
                        <g key={v}>
                          <text x={PAD.left - 4} y={toY(v) + 3} fontSize="7" fill="rgba(255,255,255,0.3)" textAnchor="end">
                            {v === 0 ? '0' : `${v/10000}萬`}
                          </text>
                          <line x1={PAD.left - 2} y1={toY(v)} x2={PAD.left} y2={toY(v)} stroke="rgba(255,255,255,0.2)" />
                        </g>
                      ))}
                      
                      {/* X軸時間標籤（只顯示首尾和最新）*/}
                      <text x={toX(0)} y={H - 5} fontSize="7" fill="rgba(255,255,255,0.3)" textAnchor="middle">2024/08</text>
                      <text x={toX(COT_DATA.length - 1)} y={H - 5} fontSize="7" fill="#10b981" textAnchor="middle" fontWeight="bold">{COT_DATA[COT_DATA.length - 1].date.replace('-', '/')}</text>
                    </svg>
                    
                    {/* 圖例 */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[9px] text-text-dim/60 font-mono w-full">
                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-orange-500 inline-block"></span>空單口數</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-rose-500 border-dashed inline-block opacity-60"></span>危險閾值 {(DANGER_THRESHOLD/10000).toFixed(0)}萬</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-yellow-500 inline-block opacity-60"></span>警戒閾值 {(WARNING_THRESHOLD/10000).toFixed(0)}萬</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"></span>當前</span>
                      {cotData?.updatedAt && (
                        <span className="ml-auto text-[8px] text-text-dim/40 font-mono">
                          更新：{new Date(cotData.updatedAt).toLocaleString('zh-TW', {
                            timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 6. BOJ會議風險卡片 (全寬二代動態) */}
        <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/20 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-3 lg:max-w-[40%] font-sans w-full">
              <Calendar className="w-5 h-5 text-rose-500 mt-1 flex-shrink-0" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-sm font-bold text-rose-400">{bojMeetingTitle}</h5>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-widest ${bojRiskColor}`}>
                    {bojRiskLevel} RISK
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xs text-text-bright font-bold">最高風險催化劑</span>
                  <span className="text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30 px-1.5 py-0.2 rounded font-mono font-medium">{bojMeetingShortLabel}</span>
                </div>
                <p className="text-[11px] text-text-dim mt-1.5">
                  {nextBoj ? (
                    <>
                      市場高度緊盯日本央行於 <span className="text-rose-400/90 font-bold border-b border-rose-500/30 pb-0.5 font-sans">{nextBoj.label}</span> 召開的決策會議，若政策立場轉鷹，可能提早引發大規模的資金匯回。
                    </>
                  ) : (
                    <>
                      市場持續緊盯日本央行下次政策會議，若政策立場轉鷹，可能引發大規模的資金匯回。
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 lg:pl-6 lg:border-l lg:border-border-subtle/50">
              {/* 升息機率 */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <span className="text-text-secondary font-bold">升息機率</span>
                  <span className="font-mono font-bold text-orange-400">
                    {carryData ? (
                      `${carryData.bojHikeProb}%`
                    ) : (
                      <span className="inline-block w-8 h-4 bg-white/10 rounded animate-pulse" />
                    )}
                    {carryData && (
                      <span className="text-[8px] text-text-dim/60 font-normal ml-1 border border-border-subtle px-1 rounded bg-card-bg/50">
                        {carryData?.bojProbIsEnvOverride ? 'ENV 覆寫' : 'OIS 隱含'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${carryData ? carryData.bojHikeProb : 0}%` }}
                    transition={{ duration: 1.5 }}
                    className="h-full bg-orange-500 rounded-full"
                  />
                </div>
              </div>

              {/* 升息 + QT 同步機率 */}
              <div>
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <span className="text-text-secondary font-bold">「升息 + QT」同步宣佈機率</span>
                  <span className="font-mono font-bold text-rose-400">
                    {carryData ? (
                      `${carryData.bojQtProb}%`
                    ) : (
                      <span className="inline-block w-8 h-4 bg-white/10 rounded animate-pulse" />
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-border-subtle rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${carryData ? carryData.bojQtProb : 0}%` }}
                    transition={{ duration: 1.5 }}
                    className="h-full bg-rose-500 rounded-full"
                  />
                </div>
              </div>
            </div>
          </div>
          
          <div className="mt-4 pt-3 border-t border-rose-500/10 text-[11px] text-rose-400/90 leading-relaxed flex items-start gap-1.5">
            <Zap className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
            <span>
              若 BOJ 同時宣佈升息與縮減購債（QT），將同步衝擊兩個臨界點，套利交易崩解速度將以小時計，對美股造成突發性拋壓。
            </span>
          </div>
        </div>

        {/* 7. 底部免責聲明 */}
        <div className="text-[9px] text-text-dim/40 font-mono mt-2 mb-1.5 flex flex-col sm:flex-row sm:items-center gap-1 border-b border-border-subtle/30 pb-2">
          <span>⏱ 機率來源：OIS 市場隱含 / Bloomberg 共識</span>
          <div className="sm:ml-auto flex gap-3">
            <span>機率更新：{carryData?.bojProbUpdated ?? '2026-05-25'}</span>
            {carryData && (
              <span>匯率更新：{new Date(carryData.updatedAt).toLocaleString('zh-TW', {
                timeZone: 'Asia/Taipei', 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit'
              })}</span>
            )}
          </div>
        </div>
        <div className="text-[11px] text-text-dim flex items-center gap-1">
          <span>* 套利交易規模估計逾 4 兆美元，平倉速度取決於市場流動性與波動率。本監控僅供參考，不構成投資建議。</span>
        </div>
      </motion.div>
    </div>
  );
}
