import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Zap, Shield, TrendingUp, PieChart, Info, X, Activity, Radio, Database, Cpu, Thermometer, Boxes, Bot, Cloud, Satellite, Battery, Wind, Atom } from 'lucide-react';
import { STOCK_NAMES } from '../constants';

const factorReasons: Record<string, Record<string, string>> = {
  '動能因子 (Momentum)': {
    'NVDA': '受惠於資料中心強勁需求與 AI 晶片的領先地位，展現極強的價格延續性。',
    'AVGO': '半導體與網路基礎設施領頭羊，合併收益與增長動能獲市場青睞。',
    'MSFT': '雲端運算領導地位與 Copilot 整合應用，維持穩健的高增長動能。',
    'AMD': '在資料中心 CPU 與 GPU 市場份額持續擴張，受惠於 AI 運算成長紅利。',
    'TSM': '全球晶圓代工龍頭，握有最先進製程技術，是所有 AI 晶片公司的核心夥伴。'
  },
  '價值因子 (Value)': {
    'INTC': '處於轉型期的半導體巨頭，股價跌破淨值比使其具備高度邊際安全性與重估潛力。',
    'CSCO': '網路設備領導者，擁有穩定的訂閱服務收入與極具吸引力的低市盈率。',
    'IBM': '轉型混合雲與 AI 諮詢服務有成，具備強大的自由現金流與穩定的股息回報。',
    'ORCL': '資料庫與雲端基礎設施擴展迅速，其企業級服務的護城河使其估值相當穩健。',
    'MU': '記憶體市場循環性低點已過，其高頻寬記憶體 (HBM) 技術在 AI 時代極具價值。'
  },
  '質量因子 (Quality)': {
    'AAPL': '極高的股東權益報酬率 (ROE) 與強大的消費者生態系統，獲利能力領先同業。',
    'MSFT': '軟體服務的高毛利與穩定的訂閱制收入，造就其極佳的盈餘質量。',
    'GOOGL': '搜尋引擎的壟斷地位與健康的現金儲備，長年維持穩定的資本回報。',
    'ASML': '獨佔全球 EUV 光刻機市場，其技術門檻與毛利使其成為優質的首選。',
    'ADBE': '數位內容創作軟體的絕對領導者，高粘著度的訂閱模式帶來穩定的獲利結構。'
  },
  'GPU / 加速運算': {
    'NVDA': 'AI 算力的絕對壟斷者，其 H100/B200 晶片是訓練大型模型的標準。',
    'AMD': 'MI300 系列展現強大競爭力，是雲端業者追求備選方案的最佳選擇。',
    'TSM': '全球 AI 晶片的唯一代工核心，掌握先進製程，通吃所有廠商訂單。',
    'AVGO': '與多家雲端巨頭合作開發 ASIC，並提供關鍵的高速互連技術。',
    'MRVL': '深耕雲端 ASIC 與分散式算力結構，其網路晶片是構建 AI 集群的關鍵。'
  },
  'CPU / 系統算力': {
    'AMD': 'EPYC 處理器在資料中心市場持續擴張，擁有極佳的效能功耗比。',
    'INTC': '透過 IDM 2.0 戰略重塑代工競爭力，受惠於美國本土晶片法案支持。',
    'ARM': '其低功耗架構在雲端自研晶片佔有率飆升，受惠於節能趨勢。',
    'AAPL': 'M 系列晶片整合強大 NPU，在個人電腦端引領 AI 推理變革。',
    'DELL': '全球伺服器龍頭，正受惠於企業端爆發式的 AI 機架升級需求。',
    'QCOM': 'Snapdragon X Elite 平台在 AI PC 市場展現強代競爭力。',
    'HPE': '提供端到端的 AI 運算解決方案，協助企業快速佈署本地 AI 環境。'
  },
  '光通訊 / Data Center': {
    'COHR': '全球光通訊元件領袖，受惠於 800G 光模組需求爆發，是互聯關鍵。',
    'LITE': '專注於高階光雷射技術，在 AI 伺服器的高速傳輸中扮演核心角色。',
    'FN': '頂尖光電製造服務商，為輝達等大廠代工關鍵組件，營運動能強勁。',
    'AVGO': '交換機晶片 Tomahawk 系列佔據市場主導，支撐了數據中心的資料流。',
    'ANET': '其 400G/800G 交換機在 AI 資料中心市佔率攀繁，解決頻寬瓶頸。',
    'AXTI': '專業化合物半導體基板商，提供 800G/1.6T 高速雷射晶片的核心底層材料。'
  },
  '記憶體 / 存儲': {
    'MU': '美股唯一 HBM 核心標的，其 HBM3E 產品已深受輝達等大廠採用。',
    'WDC': '收購 SanDisk 後成為快閃記憶體龍頭，其 Enterprise SSD 是 AI 模型的骨幹。',
    'STX': '在海量數據的長期存儲中具備成本優勢，受惠於 AI 模型數據的存檔需求。',
    'PSTG': '領先的全閃存存儲解決方案，其軟硬體整合極大化了 AI 運算效率。',
    'NTAP': '專注於混合雲數據管理，提供 AI 時代所需的跨雲存儲架構。',
    'TER': '半導體自動測試設備龍頭，HBM 晶片出貨前需其高階設備嚴苛測試。',
    'HPE': '提供混合遺產與全閃存存儲方案，協助企業在本地與雲端間高效管理 AI 數據。'
  },
  '電力與散熱基礎設施': {
    'VRT': '冷卻系統全球領導者，液冷技術是解決高功耗伺服器散熱的唯一途徑。',
    'EATN': '提供關鍵電力管理與備援系統，解決 AI 算力中心對電網的壓力。',
    'SMCI': '伺服器機櫃整合專家，其模組化設計能快速部署大規模 AI 集群。',
    'MOD': '深耕熱交換技術，轉型資料中心散熱有成，在精密冷卻領域具優勢。',
    'NVT': '生產資料中心專用 PDU 與機櫃，確保極高功率密度下的運行安全。'
  },
  '客製化 AI 晶片 (ASIC) 與 IP': {
    'MRVL': '雲端公司客製晶片首選合作夥伴，專精於高速計算與傳輸線路設計。',
    'CDNS': '提供 EDA 工具，所有先進製程晶片設計階段皆需其軟體支持。',
    'SNPS': '全球 EDA 與 IP 領導者，加速了企業開發專屬 AI 晶片的時程。',
    'AVGO': '憑藉 SerDes IP 與晶片設計能力，在雲端自研晶片市場地位鞏固。',
    'KLAC': '製程控管龍頭， AI 晶片的高質量要求使其檢測設備需求火熱。',
    'ARM': '提供低功耗架構 IP，是當前眾多 AI 手機、AI PC 與雲端自研晶片的首選底層指令集。'
  },
  '邊緣AI 與 工業 4.0': {
    'NXPI': '汽車與工業嵌入式處理器龍頭，將 AI 算力推向自動駕駛與工廠終端。',
    'ADI': '領先的類比信號處理技術，是感測器與 AI 決策信息的關鍵橋樑。',
    'ARM': '終端設備最核心架構商，低功耗設計是 AI 在移動設備運行的標準。',
    'TXN': '全球最大模擬晶片商，其處理實體訊號能力是邊緣 AI 的基石。',
    'ON': '在智能感知與功率元件領先，支撐了邊緣 AI 的效能提升。',
    'ISRG': '手術機器人領航者，透過 AI 數據反饋提升手術精準度。',
    'BSX': '致力於植入式智慧設備，利用 AI 監測數據將算力推向生活第一線。',
    'QCOM': '邊緣算力龍頭，引領 AI 手機與 AI PC 時代的晶片架構標準。'
  },
  'AI 基建與平台': {
    'AMZN': 'AWS 提供最廣泛的雲端 AI 基建，其自研晶片具有強大成本優勢。',
    'PLTR': '數據分析平台領導者，協助企業與政府將 AI 模型轉化為決策力。',
    'SNOW': '數據倉庫龍頭，為企業提供標準化的 AI 數據存取與管理環境。',
    'MSFT': 'Azure 與 OpenAI 深度整合，已成為企業部署 AI 應用的首選。',
    'GOOGL': '其雲端平台提供 TPU 算力與 Gemini 生態，具備原生 AI 創新實力。',
    'NOW': '將生成式 AI 整合進流程管理，大幅提升企業日常營運效率。',
    'CRM': 'AI 賦能客戶關係管理，Einstein 平台實現了精準的智慧互動。'
  },
  '低軌衛星 (LEO)': {
    'ASTS': '全球首家開發天基蜂窩寬帶網絡的公司，能讓一般智能手機直接連接衛星，解決偏遠地區 AI 數據傳輸問題。',
    'RKLB': '領先的小型火箭發送商，提供從發射到衛星部件的端到端服務，是構建 AI 全球網絡的實力標桿。',
    'GSAT': '提供穩定的衛星物聯網與通訊服務，與 Apple 的衛星求救服務深度綁定，具備成熟商業落實。',
    'LHX': '掌握國防與民用衛星通訊的關鍵技術，是 AI 時代地緣政治下衛星基建的安全保障。'
  },
  '能源與電池技術': {
    'ALB': '全球鋰礦產能龍頭，其鋰產品是電動車與資料中心備援電池系統最核心的原料。',
    'ENPH': '提供全球領先的小型太陽能逆變器與家庭蓄能系統，展現分佈式能源與 AI 智能調度的潛力。',
    'FSLR': '專注於碲化鎘薄膜太陽能技術，其在大規模太陽能電廠的部署是 AI 數據中心清潔能源轉型的重臣。',
    'PLUG': '氫能基礎設施的開拓者，氫燃料電池是 AI 資料中心實現零排放、全天候備援電力的長期解方。',
    'TSLA': '其 Megapack 儲能系統正在全球廣泛部署，解決了再生能源不穩定性對 AI 電網的負擔。'
  },
  '電力與智能電網': {
    'BE': 'Bloom Energy 提供固態氧化物燃料電池技術，為 AI 資料中心提供穩定且高效的清潔電力分佈式電源。',
    'OKLO': 'Oklo 開發小型模組化反應爐 (SMR)，是滿足 AI 算力長期巨大能源需求的次世代核能解方。',
    'SMR': 'NuScale Power 是首個獲美國核管會認證的 SMR 設計商，其技術是資料中心能源脫碳的關鍵。',
    'GEV': 'GE Vernova 掌握全球領先的燃氣輪機與電網現代化技術，支撐了 AI 時代電力供應的數位化轉型。',
    'PWR': 'Quanta Services 是電力設施建設領袖，直接受惠於全美電網升級與 AI 資料中心大規模併網的需求。'
  },
  '量子計算': {
    'IONQ': '量子計算領域的標竿企業，其離子阱技術在保真度與擴展性上具有優勢，預示了 AI 運算效率的跨代飛躍。',
    'RGTI': '致力於超導量子處理器的研發，其混合量子雲服務正探索量子力學與現代 AI 模型訓練的結合。',
    'QBTS': 'D-Wave 是量子退火技術的先驅，其商用量子系統在處理複雜組合優化問題上展現實力。',
    'IBM': '全球量子計算的領路人，其量子發展藍圖正逐步將量子算力整合進 AI 模型，實現算力霸權。',
    'HON': 'Honeywell 的 Quantinuum 子公司在保真度上領跑，是實現容錯量子計算的強力競爭者。'
  }
};

const aiSectors = [
  {
    title: 'GPU / 加速運算',
    icon: Zap,
    color: 'text-orange-400',
    bg: 'bg-orange-400/5',
    stocks: ['NVDA', 'AMD', 'TSM', 'AVGO', 'MRVL'],
    description: 'AI 時代的核心引擎，處理海量數據運算的關鍵架構商。'
  },
  {
    title: 'CPU / 系統算力',
    icon: Activity,
    color: 'text-blue-400',
    bg: 'bg-blue-400/5',
    stocks: ['AMD', 'INTC', 'ARM', 'AAPL', 'DELL', 'QCOM', 'HPE'],
    description: '通用計算基礎，負責 AI 模型流程控制與大數據預處理。'
  },
  {
    title: '光通訊 / Data Center',
    icon: Radio,
    color: 'text-cyan-400',
    bg: 'bg-cyan-400/5',
    stocks: ['COHR', 'LITE', 'FN', 'AVGO', 'ANET', 'AXTI'],
    description: '驅動數據中心內部高速互聯，解決頻寬瓶頸的不可或缺技術。'
  },
  {
    title: '記憶體 / 存儲',
    icon: Database,
    color: 'text-purple-400',
    bg: 'bg-purple-400/5',
    stocks: ['MU', 'WDC', 'PSTG', 'NTAP', 'TER', 'STX', 'HPE'],
    description: '受惠於 HBM 技術爆發，存儲是 AI 模型處理效率與海量數據存放的核心門戶。'
  },
  {
    title: '電力與散熱基礎設施',
    icon: Thermometer,
    color: 'text-red-400',
    bg: 'bg-red-400/5',
    stocks: ['VRT', 'EATN', 'SMCI', 'MOD', 'NVT'],
    description: '解決伺服器高耗能與散熱痛點，是資料中心擴張的實體基礎。'
  },
  {
    title: '客製化 AI 晶片 (ASIC) 與 IP',
    icon: Boxes,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/5',
    stocks: ['MRVL', 'CDNS', 'SNPS', 'AVGO', 'KLAC', 'ARM'],
    description: '企業級自研晶片的背後推手，掌握電子設計自動化 (EDA) 與架構關鍵。'
  },
  {
    title: '邊緣AI 與 工業 4.0',
    icon: Bot,
    color: 'text-indigo-400',
    bg: 'bg-indigo-400/5',
    stocks: ['NXPI', 'ADI', 'ARM', 'TXN', 'ON', 'ISRG', 'BSX', 'QCOM'],
    description: '將智慧算力從雲端延伸至工廠、汽車與終端裝置，實現即時反應。'
  },
  {
    title: 'AI 基建與平台',
    icon: Cloud,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/5',
    stocks: ['AMZN', 'PLTR', 'SNOW', 'MSFT', 'GOOGL', 'NOW', 'CRM'],
    description: '提供大規模雲端算力租賃與數據處理平台，支撐 AI 軟體應用落地。'
  },
  {
    title: '低軌衛星 (LEO)',
    icon: Satellite,
    color: 'text-blue-300',
    bg: 'bg-blue-300/5',
    stocks: ['ASTS', 'RKLB', 'GSAT', 'LHX'],
    description: '解決地面基建無法覆蓋的通訊缺口，為 AI 邊緣端提供全時域連接。'
  },
  {
    title: '能源與電池技術',
    icon: Battery,
    color: 'text-green-400',
    bg: 'bg-green-400/5',
    stocks: ['ALB', 'ENPH', 'FSLR', 'PLUG', 'TSLA'],
    description: 'AI 算力競賽的終極制約在於電力，高效蓄能與清潔能源是可持續發展的基石。'
  },
  {
    title: '電力與智能電網',
    icon: Wind,
    color: 'text-yellow-600',
    bg: 'bg-yellow-600/5',
    stocks: ['BE', 'OKLO', 'SMR', 'GEV', 'PWR'],
    description: '分散式電源與電網現代化，確保 AI 資料中心獲取 24/7 不間斷的高品質能源。'
  },
  {
    title: '量子計算',
    icon: Atom,
    color: 'text-indigo-300',
    bg: 'bg-indigo-300/5',
    stocks: ['IONQ', 'RGTI', 'QBTS', 'IBM', 'HON'],
    description: '超越傳統半導體物理極限的運算方式，是未來處理超大型 AI 模型運算的核心力量。'
  }
];

const factors = [
  {
    title: '動能因子 (Momentum)',
    description: '挑選過去 6-12 個月表現優異、趨勢仍向上的科技領頭個股。',
    icon: Zap,
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    stocks: ['NVDA', 'AVGO', 'MSFT', 'AMD', 'TSM'],
    etf: 'MTUM'
  },
  {
    title: '價值因子 (Value)',
    description: '尋找本益比偏低、現金流穩定且具備重估價值的科技基礎設施公司。',
    icon: Wallet,
    color: 'text-green-400',
    bg: 'bg-green-400/10',
    stocks: ['INTC', 'CSCO', 'IBM', 'ORCL', 'MU'],
    etf: 'VLUE'
  },
  {
    title: '質量因子 (Quality)',
    description: '專注於高 ROE、強大技術護城河與獲利結構穩定的頂尖科技企業。',
    icon: Shield,
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    stocks: ['AAPL', 'MSFT', 'GOOGL', 'ASML', 'ADBE'],
    etf: 'QUAL'
  }
];

function Wallet(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

export default function FactorInvesting({ onJumpToAnalysis }: { onJumpToAnalysis?: (symbol: string) => void }) {
  const [selectedStock, setSelectedStock] = useState<{ symbol: string, factor: string } | null>(null);

  const [sectorPerf, setSectorPerf] = useState<any[]>([]);
  const [sectorLoading, setSectorLoading] = useState(true);
  const [sectorError, setSectorError] = useState(false);

  useEffect(() => {
    fetch('/api/sector-performance')
      .then(r => {
        if (!r.ok) throw new Error('API failed');
        return r.json();
      })
      .then(data => {
        // 接受任何有效陣列（包含靜態 fallback）
        if (Array.isArray(data) && data.length > 0) {
          setSectorPerf(data);
        } else {
          setSectorError(true);
        }
      })
      .catch(() => setSectorError(true))
      .finally(() => setSectorLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {factors.map((factor, index) => {
          const percentages = [92, 78, 14];
          const pct = percentages[index % 3];
          
          return (
            <motion.div
              key={factor.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="sleek-card"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="card-title !mb-0">{factor.title}</div>
                <span className="text-[10px] font-bold text-text-dim px-2 py-0.5 bg-dashboard-bg border border-border-subtle rounded uppercase tracking-widest">ETF: {factor.etf}</span>
              </div>
              
              <div className="flex flex-col gap-4">
                <p className="text-xs text-text-dim leading-relaxed h-12 overflow-hidden">
                  {factor.description}
                </p>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-text-dim">
                    <span>Intensity Score</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-2 bg-dashboard-bg rounded-full border border-border-subtle overflow-hidden">
                    <motion.div 
                      className={`h-full ${pct > 80 ? 'bg-gradient-to-r from-blue-600 to-brand' : pct < 20 ? 'bg-red-500' : 'bg-brand'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 1, delay: 0.5 }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {factor.stocks.map((stock) => (
                    <button 
                      key={stock} 
                      onClick={() => setSelectedStock({ symbol: stock, factor: factor.title })}
                      className="px-2 py-1 bg-dashboard-bg border border-border-subtle rounded text-[10px] font-bold text-text-dim hover:text-white hover:border-brand/40 hover:bg-brand/5 transition-all"
                    >
                      {stock}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          );
        })}

      </div>

      {/* 類群供需概況 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-text-bright uppercase tracking-widest flex items-center gap-2">
              📡 類群供需概況 Sector Supply & Demand
            </h2>
            <p className="text-[10px] text-text-dim mt-0.5">
              基於代表股即時報價與技術面，判斷各類群的資金動向與供需狀態
            </p>
          </div>
          {!sectorLoading && (
            <span className="text-[9px] text-text-dim/50">
              每 5 分鐘更新
            </span>
          )}
        </div>
        
        {sectorLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array(9).fill(0).map((_, i) => (
              <div key={i} className="h-24 bg-card-bg border border-border-subtle rounded-xl animate-pulse" />
            ))}
          </div>
        ) : sectorError ? (
          <div className="p-4 text-text-dim/50 text-sm text-center">數據載入失敗，請稍後重試</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sectorPerf.map((s) => {
              const isPositive = s.avgChange1D >= 0;
              const signalColors: Record<string, string> = {
                supply_surge:    'border-emerald-400/40 bg-emerald-400/5',
                accumulating:    'border-blue-400/30 bg-blue-400/5',
                balanced:        'border-border-subtle bg-card-bg',
                distributing:    'border-orange-400/30 bg-orange-400/5',
                demand_collapse: 'border-rose-400/40 bg-rose-400/5',
              };
              const changeColors: Record<string, string> = {
                supply_surge: 'text-emerald-400',
                accumulating: 'text-blue-400',
                balanced: 'text-text-dim',
                distributing: 'text-orange-400',
                demand_collapse: 'text-rose-400',
              };
              
              return (
                <div
                  key={s.sector}
                  className={`p-4 rounded-xl border ${signalColors[s.supplyDemandSignal] || 'border-border-subtle bg-card-bg'} transition-all relative`}
                >
                  {s.isStatic && (
                    <span className="absolute top-2 right-2 text-[7px] px-1 py-0.5 bg-text-dim/10 text-text-dim/40 border border-text-dim/20 rounded font-bold">
                      STATIC
                    </span>
                  )}
                  {/* 標題行 */}
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-bold text-text-bright leading-tight">{s.sector}</span>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className={`text-sm font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPositive ? '+' : ''}{s.avgChange1D.toFixed(2)}%
                      </div>
                      <div className="text-[8px] text-text-dim/50">今日均值</div>
                    </div>
                  </div>
                  
                  {/* 供需訊號 */}
                  <div className={`text-[10px] font-bold mb-1 ${changeColors[s.supplyDemandSignal] || 'text-text-dim'}`}>
                    {s.signalLabel}
                  </div>
                  <p className="text-[9px] text-text-dim/70 leading-relaxed mb-2">{s.signalDesc}</p>
                  
                  {/* 個股漲跌小圓點 */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {s.stocks.map((stock: any) => (
                      <div
                        key={stock.symbol}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-mono ${
                          stock.change1D >= 0
                            ? 'bg-emerald-400/10 text-emerald-400'
                            : 'bg-rose-400/10 text-rose-400'
                        }`}
                        title={`${stock.symbol}: ${stock.change1D.toFixed(2)}%，${stock.aboveMa50 ? '▲50MA' : '▼50MA'}，距高點 ${stock.distanceFromHigh.toFixed(1)}%`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${stock.aboveMa50 ? 'bg-current' : 'bg-current opacity-40'}`} />
                        {stock.symbol}
                        <span>{stock.change1D >= 0 ? '+' : ''}{stock.change1D.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* 50MA 以上比例 */}
                  <div className="mt-2 pt-2 border-t border-border-subtle/30 flex items-center justify-between">
                    <span className="text-[8px] text-text-dim/50">50MA 以上</span>
                    <div className="flex items-center gap-1">
                      <div className="w-16 h-1 bg-border-subtle rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            s.aboveMa50Count / s.totalCount >= 0.6 ? 'bg-emerald-400' :
                            s.aboveMa50Count / s.totalCount >= 0.4 ? 'bg-yellow-400' : 'bg-rose-400'
                          }`}
                          style={{ width: `${(s.aboveMa50Count / s.totalCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[8px] text-text-dim">
                        {s.aboveMa50Count}/{s.totalCount}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        
        {/* 說明 */}
        <div className="mt-3 p-3 bg-card-bg/50 rounded-xl border border-border-subtle/30">
          <p className="text-[9px] text-text-dim/50 leading-relaxed">
            📌 供需訊號基於代表股今日漲跌幅均值與 50 日均線位置。
            <span className="text-emerald-400/70"> 🔥 供不應求</span>（類群均漲 &gt;2%，多數在均線上）→
            <span className="text-rose-400/70"> ❄️ 供過於求</span>（類群均跌 &gt;2%，多數跌破均線）。
            僅供輔助判斷，非投資建議。
          </p>
        </div>
      </div>

      {/* AI Industry Recommendations */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 px-1">
          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
            <Cpu className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">AI 關鍵產業推薦 Key AI Sectors</h2>
            <p className="text-[10px] text-text-dim/60 font-medium uppercase tracking-widest">Industry Deep-Dive & Hardware Infrastructure</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {aiSectors.map((sector) => {
            const Icon = sector.icon;
            return (
              <div key={sector.title} className="sleek-card p-5 group flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-2 rounded-lg ${sector.bg}`}>
                      <Icon className={`w-5 h-5 ${sector.color}`} />
                    </div>
                    <span className="text-[8px] font-bold text-text-dim/40 uppercase tracking-widest">Sector Focus</span>
                  </div>
                  <h3 className="text-xs font-bold text-white mb-2">{sector.title}</h3>
                  <p className="text-[10px] text-text-dim leading-relaxed mb-6">
                    {sector.description}
                  </p>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {sector.stocks.map((stock) => (
                    <button 
                      key={stock}
                      onClick={() => setSelectedStock({ symbol: stock, factor: sector.title })}
                      className="px-2 py-1 bg-dashboard-bg border border-border-subtle rounded text-[9px] font-bold text-text-dim hover:text-white hover:border-brand/40 hover:bg-brand/5 transition-all"
                    >
                      {stock}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reasoning Modal */}
      <AnimatePresence>
        {selectedStock && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedStock(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-card-bg border border-border-subtle shadow-2xl"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center text-brand font-bold">
                      {selectedStock.symbol}
                    </div>
                    <div>
                      <h3 className="font-bold text-white">{selectedStock.symbol}</h3>
                      <p className="text-[10px] font-bold text-brand">{STOCK_NAMES[selectedStock.symbol] || ''}</p>
                      <p className="text-[9px] font-medium text-text-dim/60 uppercase tracking-wider">{selectedStock.factor}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setSelectedStock(null)}
                    className="p-2 hover:bg-white/5 rounded-lg transition-colors text-text-dim hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-dashboard-bg/50 rounded-xl border border-border-subtle">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1 h-3 bg-brand rounded-full" />
                      <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">選中理由 Selection Logic</span>
                    </div>
                    <p className="text-sm text-text-bright leading-relaxed">
                      {factorReasons[selectedStock.factor]?.[selectedStock.symbol] || '目前暫無詳細數據說明。'}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setSelectedStock(null)}
                      className="flex-1 py-3 bg-dashboard-bg border border-border-subtle text-text-dim text-xs font-bold uppercase tracking-widest rounded-xl hover:text-white hover:bg-white/5 transition-all"
                    >
                      關閉
                    </button>
                    {onJumpToAnalysis && (
                      <button 
                        onClick={() => {
                          onJumpToAnalysis(selectedStock.symbol);
                          setSelectedStock(null);
                        }}
                        className="flex-1 py-3 bg-brand text-white text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-brand/90 transition-all shadow-lg shadow-brand/20 flex items-center justify-center gap-2"
                      >
                        及時技術分析
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
