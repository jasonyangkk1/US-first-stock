import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, TrendingUp, Cpu, Gauge, Search, Bell, Menu } from 'lucide-react';
import EarningsTracker from './components/EarningsTracker';
import TechnicalAnalysis from './components/TechnicalAnalysis';
import FactorInvesting from './components/FactorInvesting';
import MarketSentiment from './components/MarketSentiment';

type Tab = 'earnings' | 'technical' | 'algo' | 'sentiment';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('earnings');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const handleStockClick = (symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('technical');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'earnings': return <EarningsTracker onSelectStock={handleStockClick} />;
      case 'technical': return <TechnicalAnalysis initialSymbol={selectedSymbol || 'AAPL'} />;
      case 'algo': return <FactorInvesting onJumpToAnalysis={handleStockClick} />;
      case 'sentiment': return <MarketSentiment />;
      default: return <EarningsTracker onSelectStock={handleStockClick} />;
    }
  };

  const navItems = [
    { id: 'earnings', label: '財報追蹤', icon: Calendar },
    { id: 'technical', label: '趨勢分析', icon: TrendingUp },
    { id: 'algo', label: '演算法', icon: Cpu },
    { id: 'sentiment', label: '市場情緒', icon: Gauge },
  ];

  return (
    <div className="min-h-screen bg-dashboard-bg text-text-bright font-sans selection:bg-brand/30 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-72 flex-col bg-card-bg border-r border-border-subtle p-6 fixed inset-y-0">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight uppercase">MAG7 QUANT</span>
        </div>

        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as Tab)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium ${
                  isActive 
                    ? 'bg-border-subtle text-white' 
                    : 'text-text-dim hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-brand' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto p-4 bg-gradient-to-br from-blue-900/40 to-brand/20 rounded-xl border border-blue-500/20">
          <p className="text-[10px] uppercase font-bold text-blue-400 tracking-widest">Market Status</p>
          <p className="text-xl font-bold mt-1">OPEN</p>
          <p className="text-[10px] text-white/50 mt-1">Next Event: NVDA 10-Q (2d)</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:ml-72">
        {/* Header (Top Bar) */}
        <header className="sticky top-0 z-50 bg-dashboard-bg/80 backdrop-blur-md border-b border-border-subtle px-6 h-16 flex items-center justify-between">
          <h2 className="text-lg font-medium md:hidden">MAG7 QUANT</h2>
          <h2 className="text-lg font-medium hidden md:block">Market Terminal</h2>
          <div className="flex items-center gap-4 text-xs text-text-dim">
            <span className="hidden sm:block">SPX: 5,728.32 (+0.4%)</span>
            <span className="hidden sm:block">NDX: 20,011.84 (+0.8%)</span>
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <Search className="w-5 h-5" />
              </button>
              <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <Bell className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Content View */}
        <main className="flex-1 p-6 max-w-5xl mx-auto w-full pb-24 md:pb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card-bg/90 backdrop-blur-xl border-t border-border-subtle pb-safe">
        <div className="flex justify-around items-center h-16 px-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as Tab)}
                className={`flex flex-col items-center justify-center flex-1 gap-1 transition-all ${
                  isActive ? 'text-brand' : 'text-text-dim'
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-[10px] font-medium tracking-wide">
                  {item.label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute bottom-0 w-12 h-0.5 bg-brand rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
