import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Gauge, Activity, AlertCircle, RefreshCcw, TrendingDown, TrendingUp, Users, ShoppingBag, Clock, Calendar, BarChart3 } from 'lucide-react';

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
  nextRelease: string;
  icon: React.ElementType;
  previous: string;
  actual: string;
  forecast: string;
}

const ECONOMIC_INDICATORS: EconomicIndicator[] = [
  {
    id: 'adp',
    name: '小非農 (ADP)',
    label: 'ADP Employment',
    description: '衡量美國私營部門就業人數的變化。由 ADP 研究院公布，通常在官方非農報告前兩天發布，被視為市場先行指標。',
    nextRelease: '2026-06-03 20:15 (TPE)',
    icon: Users,
    previous: '184K',
    actual: '109K',
    forecast: '150K'
  },
  {
    id: 'nfp',
    name: '大非農 (NFP)',
    label: 'Non-Farm Payrolls',
    description: '美國非農業就業人數及失業率報告。這是衡量美國經濟健康狀況最重要的宏觀指標之一，直接影響聯準會的利率政策。',
    nextRelease: '2026-06-05 20:30 (TPE)',
    icon: Activity,
    previous: '185K',
    actual: '115K',
    forecast: '145K'
  },
  {
    id: 'cpi',
    name: '消費者物價指數 (CPI)',
    label: 'US Consumer Price Index',
    description: '衡量美國通膨壓力的核心數據。反映消費者購買商品和服務的價格變化，高於預計的 CPI 通常會強化市場對升息的預期。',
    nextRelease: '2026-06-10 20:30 (TPE)',
    icon: ShoppingBag,
    previous: '3.5%',
    actual: '3.3%',
    forecast: '3.4%'
  }
];

export default function MarketSentiment() {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [macroData, setMacroData] = useState<any>(null);
  const [yieldsData, setYieldsData] = useState<any>(null);
  const [breadthData, setBreadthData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [macroLoading, setMacroLoading] = useState(true);
  const [yieldsLoading, setYieldsLoading] = useState(true);
  const [breadthLoading, setBreadthLoading] = useState(true);
  const [yieldsError, setYieldsError] = useState<string | null>(null);
  const [error, setError] = useState(false);

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
      } finally {
        setMacroLoading(false);
      }
    };

    const fetchYields = async () => {
      setYieldsLoading(true);
      setYieldsError(null);
      try {
        const res = await fetch('/api/yields');
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
        setYieldsError('連線失敗，請檢查網路');
      } finally {
        setYieldsLoading(false);
      }
    };

    const fetchBreadth = async () => {
      setBreadthLoading(true);
      try {
        const res = await fetch('/api/breadth');
        const data = await res.json();
        if (data.concentration?.breadthScore !== undefined) {
          setBreadthData(data);
        } else {
          console.warn('[breadth] Unexpected data shape:', data);
        }
      } catch (e) {
        console.error('Error fetching breadth:', e);
      } finally {
        setBreadthLoading(false);
      }
    };

    fetchSentiment();
    fetchMacro();
    fetchYields();
    fetchBreadth();
  }, []);

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
    if (!macroData) return { ...ind, isStatic: true };
    const dynamic = macroData[ind.id];
    if (!dynamic || !dynamic.actual) return { ...ind, isStatic: true };
    return {
      ...ind,
      actual: dynamic.actual,
      previous: dynamic.previous || ind.previous,
      nextRelease: dynamic.nextRelease || ind.nextRelease,
      isStatic: false
    };
  });

  return (
    <div className="flex flex-col gap-6">
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

                            // 為每條線產生 polyline points（跳過 null）
                            const buildPoints = (arr: (number | null)[]) =>
                              arr
                                .map((v, i) => v !== null ? `${toX(i)},${toY(v)}` : null)
                                .filter(v => v !== null)
                                .join(' ');

                            const points2y = buildPoints(yield2y);
                            const points10y = buildPoints(yield10y);
                            const points30y = buildPoints(yield30y);
                            
                            const area10y = `0,100 ${points10y} 400,100`;

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
                                
                                <polygon points={area10y} fill="url(#chartFill)" />
                                
                                <polyline points={points30y} fill="none" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4,2" />
                                <polyline points={points10y} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
                                <polyline points={points2y} fill="none" stroke="#f97316" strokeWidth="1.5" />
                                
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
                 onClick={() => {
                   // Inside useEffect we don't have a direct handle, but we can trigger a re-fetch if we expose it or use a key
                   // For simplicity in this component, let's just reload the page or use a state trigger
                   window.location.reload(); 
                 }} 
                 className="text-brand text-xs font-bold uppercase tracking-widest hover:underline bg-brand/5 px-4 py-2 rounded-lg border border-brand/20"
               >
                 重新整理頁面
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
                className="bg-dashboard-bg/50 border border-border-subtle p-5 rounded-xl hover:border-brand/40 transition-all group relative"
              >
                {indicator.isStatic && (
                  <div className="absolute top-3 right-3 text-[8px] font-bold text-text-dim/40 border border-border-subtle px-1.5 py-0.5 rounded uppercase">
                    Static
                  </div>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div className="p-2 bg-brand/10 rounded-lg group-hover:bg-brand/20 transition-colors">
                    <Icon className="w-5 h-5 text-brand" />
                  </div>
                  <div className="text-[10px] font-bold text-text-dim/60 uppercase tracking-widest border-b border-border-subtle pb-1">
                    Upcoming
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
                    <div className="text-xs font-mono font-bold text-text-dim">{indicator.previous}</div>
                  </div>
                  <div className="bg-brand/5 p-2 rounded-lg border border-brand/20 text-center ring-1 ring-brand/10 relative overflow-hidden group-hover:ring-brand/40 transition-all">
                    <div className="text-[9px] text-brand/80 font-bold uppercase mb-1">Actual</div>
                    <div className="text-sm font-mono font-bold text-brand">
                      {macroLoading ? '...' : indicator.actual}
                    </div>
                  </div>
                  <div className="bg-card-bg/40 p-2 rounded-lg border border-border-subtle/50 text-center">
                    <div className="text-[9px] text-text-dim/60 font-bold uppercase mb-1">Forecast</div>
                    <div className="text-xs font-mono font-bold text-text-bright">{indicator.forecast}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 py-2 px-3 bg-card-bg/30 border border-border-subtle/50 rounded-lg mb-6">
                  {(() => {
                    const actualNum = parseFloat(indicator.actual || '0');
                    const forecastNum = parseFloat(indicator.forecast || '0');
                    const isCPI = indicator.id === 'cpi';
                    
                    let status = 'neutral';
                    let statusColor = 'text-yellow-500';
                    let bgColor = 'bg-yellow-500/10';
                    let analysis = '符合預期';

                    if (indicator.actual && indicator.forecast) {
                      if (isCPI) {
                        // CPI: Lower is better (Green), Higher is risky (Red)
                        if (actualNum < forecastNum - 0.05) {
                          status = 'positive';
                          statusColor = 'text-emerald-500';
                          bgColor = 'bg-emerald-500/10';
                          analysis = '通膨降溫 (利多)';
                        } else if (actualNum > forecastNum + 0.05) {
                          status = 'negative';
                          statusColor = 'text-rose-500';
                          bgColor = 'bg-rose-500/10';
                          analysis = '通膨過熱 (利空)';
                        }
                      } else {
                        // Jobs: Higher is better (Green), Lower is risky (Red)
                        if (actualNum > forecastNum + 10) {
                          status = 'positive';
                          statusColor = 'text-emerald-500';
                          bgColor = 'bg-emerald-500/10';
                          analysis = '就業強勁 (利多)';
                        } else if (actualNum < forecastNum - 10) {
                          status = 'negative';
                          statusColor = 'text-rose-500';
                          bgColor = 'bg-rose-500/10';
                          analysis = '衰退疑慮 (利空)';
                        }
                      }
                    }

                    return (
                      <>
                        <div className={`w-2 h-2 rounded-full ${statusColor.replace('text-', 'bg-')} animate-pulse`} />
                        <div className={`text-[10px] font-bold uppercase tracking-widest ${statusColor} py-0.5 px-2 rounded ${bgColor}`}>
                          {analysis}
                        </div>
                      </>
                    );
                  })()}
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
    </div>
  );
}
