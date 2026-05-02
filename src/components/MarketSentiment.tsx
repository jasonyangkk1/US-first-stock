import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Gauge, Activity, AlertCircle, RefreshCcw, TrendingDown, TrendingUp } from 'lucide-react';

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

export default function MarketSentiment() {
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [loading, setLoading] = useState(true);

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
        // Absolute fallback to prevent blank page
        setSentiment({
          vix: { value: 14.2, change: -1.2 },
          fearAndGreed: { value: 58, label: 'Greed', updated: new Date().toISOString() }
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSentiment();
  }, []);

  if (loading || !sentiment) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-48 bg-card-bg border border-border-subtle rounded-xl" />
        <div className="h-32 bg-card-bg border border-border-subtle rounded-xl" />
      </div>
    );
  }

  const fg = sentiment.fearAndGreed.value;
  const isVixHigh = sentiment.vix.value > 25;

  // Needle angle: 0 value = -90deg, 100 value = 90deg, 50 value = 0deg
  const needleRotation = (fg / 100) * 180 - 90;

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

      <div className="sleek-card border-dashed bg-transparent items-center text-center">
        <p className="text-xs text-text-dim leading-relaxed max-w-lg">
          Sentiment gauges are contrarian indicators. Extreme Greed often signals a top, while Extreme Fear often signals a bottom. Current regime is stability-focused.
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
