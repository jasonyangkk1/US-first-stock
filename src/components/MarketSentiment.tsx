import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Gauge, Activity, AlertCircle, RefreshCcw, TrendingDown, TrendingUp, Users, ShoppingBag, Clock, Calendar } from 'lucide-react';

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
  const [loading, setLoading] = useState(true);
  const [macroLoading, setMacroLoading] = useState(true);
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

    fetchSentiment();
    fetchMacro();
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
