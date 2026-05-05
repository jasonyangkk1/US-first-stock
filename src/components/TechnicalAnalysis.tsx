import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Search, TrendingUp, TrendingDown, ArrowUpRight, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { STOCK_NAMES } from '../constants';

interface StockData {
  symbol: string;
  currentPrice: number;
  data: {
    date: string;
    close: number;
    ma50: number | null;
    ma200: number | null;
  }[];
}

export default function TechnicalAnalysis({ initialSymbol = 'AAPL' }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Update internal symbol if prop changes
  useEffect(() => {
    if (initialSymbol && initialSymbol !== symbol) {
      setSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  const fetchStock = (s: string) => {
    if (!s) return;
    setLoading(true);
    setError(null);
    const ticker = s.toUpperCase();
    
    // Using direct Yahoo Finance chart API (v8) - Switching to query2 for better CORS compatibility
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
    
    fetch(`/api/stock/${ticker}`)
      .then(res => {
        if (!res.ok) throw new Error('API Error');
        return res.json();
      })
      .then(data => {
        if (!data || !data.data || data.data.length === 0) {
          // If we have no chart data, try the quote fallback immediately
          return fetch(`/api/quote/${ticker}`).then(q => q.json()).then(quoteData => {
            setStockData({
              symbol: ticker,
              currentPrice: quoteData.currentPrice,
              data: [] // Empty chart
            });
            setError('圖表資料暫不支援，顯示即時報價。');
            setSymbol(ticker);
            setLoading(false);
          });
        }
        
        setStockData(data);
        setSymbol(ticker);
        setLoading(false);
        setSearchQuery('');
      })
      .catch(async (err) => {
        console.warn(`Fetch error for ${ticker}, attempting quote fallback:`, err);
        try {
          const quoteRes = await fetch(`/api/quote/${ticker}`);
          if (quoteRes.ok) {
            const quoteData = await quoteRes.json();
            setStockData({
              symbol: ticker,
              currentPrice: quoteData.currentPrice,
              data: [] 
            });
            setError('圖表資料載入失敗，顯示即時報價。');
          } else {
            throw new Error('Quote fallback failed');
          }
        } catch (fallbackErr) {
          console.error('Final fallback failed:', fallbackErr);
          setError(`無法取得 ${ticker} 的資料，請稍後再試。`);
          setStockData(null);
        }
        setSymbol(ticker);
        setLoading(false);
        setSearchQuery('');
      });
  };

  useEffect(() => {
    fetchStock(symbol);
  }, [symbol]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery) fetchStock(searchQuery);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card-bg border border-border-subtle p-3 rounded-lg shadow-2xl backdrop-blur-md">
          <p className="text-text-dim text-[10px] uppercase tracking-wider mb-2">{new Date(label).toLocaleDateString()}</p>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between gap-4">
              <span className="text-xs text-text-bright">Price:</span>
              <span className="text-xs font-bold text-text-bright">${payload[0].value.toFixed(2)}</span>
            </div>
            {payload[1] && (
              <div className="flex justify-between gap-4">
                <span className="text-xs text-blue-400">50MA:</span>
                <span className="text-xs font-bold text-blue-400">${payload[1].value.toFixed(2)}</span>
              </div>
            )}
            {payload[2] && (
              <div className="flex justify-between gap-4">
                <span className="text-xs text-brand">200MA:</span>
                <span className="text-xs font-bold text-brand">${payload[2].value.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Search Bar */}
      <div className="flex flex-col gap-2">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 relative group mt-2 sm:mt-0">
          <div className="relative flex-1">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ENTER SYMBOL (E.G. NVDA)"
              className="w-full bg-card-bg border border-border-subtle rounded-xl py-4 pl-12 pr-4 text-text-bright placeholder:text-text-dim/30 focus:outline-none focus:border-brand/50 transition-all text-sm font-medium tracking-tight"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim transition-colors group-focus-within:text-brand" />
          </div>
          <button type="submit" className="w-full sm:w-auto px-6 py-4 sm:py-2 bg-brand hover:bg-brand/80 text-white text-[10px] font-bold rounded-xl transition-colors uppercase tracking-widest sm:absolute sm:right-3 sm:top-1/2 sm:-translate-y-1/2">
            Analytic
          </button>
        </form>
        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="text-[10px] text-red-400 pl-4 font-bold uppercase tracking-wider"
          >
            {error}
          </motion.div>
        )}
      </div>

      {loading ? (
        <div className="h-[400px] bg-card-bg border border-border-subtle rounded-xl animate-pulse flex items-center justify-center">
          <Activity className="w-8 h-8 text-text-dim/20 animate-spin" />
        </div>
      ) : (stockData && Array.isArray(stockData.data) && stockData.data.length > 0) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-2 sleek-card">
            <div className="card-title">Trend Technical Analysis</div>
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stockData.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="close" stroke="#f8fafc" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#3b82f6' }} />
                  <Line type="monotone" dataKey="ma50" stroke="#60a5fa" strokeWidth={1} dot={false} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="ma200" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-4 sm:gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-text-bright" />
                <span className="text-[10px] text-text-dim font-bold uppercase tracking-wider">Price</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-blue-400 border-dashed border-t border-blue-400" />
                <span className="text-[10px] text-text-dim font-bold uppercase tracking-wider">50MA</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-0.5 bg-brand" />
                <span className="text-[10px] text-text-dim font-bold uppercase tracking-wider">200MA</span>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <div className="sleek-card flex-1">
              <div className="card-title">Market Quote</div>
              <div className="flex flex-col items-center justify-center h-full py-4">
                <span className="text-4xl font-light tracking-tighter">${stockData.currentPrice.toFixed(2)}</span>
                <span className="text-[10px] font-bold text-brand mt-1">{STOCK_NAMES[stockData.symbol] || stockData.symbol}</span>
                <span className="text-[9px] font-medium text-text-dim/60 uppercase tracking-widest">{stockData.symbol} / USD</span>
              </div>
            </div>
            <div className="sleek-card flex-1">
              <div className="card-title">Continuity Index</div>
              <div className="flex flex-col gap-4 mt-2">
                <div className="flex justify-between items-center bg-dashboard-bg p-3 rounded-lg border border-border-subtle">
                  <span className="text-[10px] text-text-dim font-bold uppercase">Short Term</span>
                  <div className={`status-pill ${stockData.currentPrice > (stockData.data[stockData.data.length-1].ma50 || 0) ? 'pill-green' : 'pill-amber'}`}>
                    {stockData.currentPrice > (stockData.data[stockData.data.length-1].ma50 || 0) ? 'Bullish' : 'Neutral'}
                  </div>
                </div>
                <div className="flex justify-between items-center bg-dashboard-bg p-3 rounded-lg border border-border-subtle">
                  <span className="text-[10px] text-text-dim font-bold uppercase">Long Term</span>
                  <div className={`status-pill ${stockData.currentPrice > (stockData.data[stockData.data.length-1].ma200 || 0) ? 'pill-green' : 'pill-amber'}`}>
                    {stockData.currentPrice > (stockData.data[stockData.data.length-1].ma200 || 0) ? 'Strong Trend' : 'Testing'}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-20 sleek-card border-dashed">
          <p className="text-text-dim italic">Enter a ticker symbol to begin terminal analysis</p>
        </div>
      )}
    </div>
  );
}
