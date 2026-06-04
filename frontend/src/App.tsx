import { useState, useEffect } from 'react';
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  RefreshCw, 
  Database, 
  Sliders, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  ExternalLink, 
  Sparkles, 
  Zap, 
  Info,
  Briefcase,
  History
} from 'lucide-react';

// API Configuration
const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

interface Signal {
  id: number;
  symbol: string;
  direction: string; // 'UP', 'DOWN', 'OPEN_UP', 'OPEN_DOWN'
  ref_price: number;
  current_price: number;
  diff_pct: number;
  polymarket_slug: string | null;
  polymarket_price: number | null;
  quant_probability: number | null;
  edge_pct: number | null;
  confidence_level: string;
  confidence_stars: string;
  status: string;
  created_at: string;
}

interface Tuning {
  symbol: string;
  bet_type: string;
  lookback_days: number;
  minutes_left_threshold: number;
  min_expected_yield: number;
  updated_at: string;
}

interface AgentLog {
  id: number;
  log_type: string; // 'Tuning', 'Decision', 'Info'
  summary: string;
  details: string;
  created_at: string;
}

interface Portfolio {
  balance: number;
  equity: number;
  open_positions_value: number;
  risk_profile: string; // 'CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'
  risk_justification: string;
}

interface VirtualTrade {
  id: number;
  symbol: string;
  direction: string;
  ref_price: number;
  entry_price: number;
  size_usd: number;
  shares: number;
  status: string; // 'open', 'won', 'lost'
  profit: number;
  polymarket_slug: string | null;
  created_at: string;
  resolved_at: string | null;
}

function App() {
  const [activeTab, setActiveTab] = useState<'signals' | 'tunings' | 'logs' | 'portfolio'>('signals');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tunings, setTunings] = useState<Tuning[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [virtualTrades, setVirtualTrades] = useState<VirtualTrade[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<{ equity: number; balance: number; recorded_at: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  // Fetch all data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [signalsRes, tuningsRes, logsRes, portfolioRes, tradesRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/api/signals`),
        fetch(`${API_BASE}/api/tunings`),
        fetch(`${API_BASE}/api/logs`),
        fetch(`${API_BASE}/api/portfolio`),
        fetch(`${API_BASE}/api/trades/virtual`),
        fetch(`${API_BASE}/api/portfolio/history`)
      ]);

      if (signalsRes.ok) setSignals(await signalsRes.json());
      if (tuningsRes.ok) setTunings(await tuningsRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (portfolioRes.ok) setPortfolio(await portfolioRes.json());
      if (tradesRes.ok) setVirtualTrades(await tradesRes.json());
      if (historyRes.ok) setPortfolioHistory(await historyRes.json());
    } catch (error) {
      console.error("Error fetching data from backend API:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto refresh data every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const triggerScan = async () => {
    setIsScanning(true);
    setScanMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/scan-now`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setScanMessage(data.message || 'Scan completed successfully!');
        await fetchData();
      } else {
        setScanMessage(`Error: ${data.detail || 'Failed to scan'}`);
      }
    } catch (error) {
      setScanMessage('Failed to connect to the backend server.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  const triggerReset = async () => {
    if (!window.confirm("Portföy geçmişini ve işlemleri sıfırlamak istediğinize emin misiniz? (Gerçek bakiyeniz sıfırlanmaz, sadece işlem geçmişi temizlenir.)")) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-portfolio`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setScanMessage(data.message || 'Portföy başarıyla sıfırlandı!');
        await fetchData();
      } else {
        setScanMessage(`Error: ${data.detail || 'Failed to reset portfolio'}`);
      }
    } catch (error) {
      setScanMessage('Failed to connect to the backend server.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  // Helper formatting functions
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('tr-TR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      return isoString;
    }
  };

  const getDirectionBadge = (dir: string) => {
    const isUp = dir.includes('UP');
    const label = dir.replace('OPEN_', 'AÇILIŞ ');
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
        isUp 
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/35 shadow-[0_0_12px_rgba(16,185,129,0.15)]' 
          : 'bg-rose-500/10 text-rose-400 border border-rose-500/35 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
      }`}>
        {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {label}
      </span>
    );
  };

  const getConfidenceBadge = (level: string) => {
    switch (level) {
      case 'ÇOK GÜVENLİ':
        return <span className="px-2.5 py-1 text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md">🚀 {level}</span>;
      case 'GÜVENLİ':
        return <span className="px-2.5 py-1 text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-md">🛡️ {level}</span>;
      case 'ORTA RİSKLİ':
        return <span className="px-2.5 py-1 text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-md">⚠️ {level}</span>;
      default:
        return <span className="px-2.5 py-1 text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-md">🎰 {level}</span>;
    }
  };

  const filteredSignals = signals.filter(s => 
    s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.direction.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.confidence_level.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTunings = tunings.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.bet_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLogs = logs.filter(l => 
    l.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.log_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resolvedTrades = virtualTrades.filter(t => t.status !== 'open');
  const winCount = resolvedTrades.filter(t => t.status === 'won').length;
  const winRate = resolvedTrades.length > 0 ? Math.round((winCount / resolvedTrades.length) * 100) : 0;

  const renderBalanceChart = () => {
    if (portfolioHistory.length === 0) return null;

    let points = [...portfolioHistory];
    if (points.length === 1) {
      const p0 = points[0];
      const baseDate = new Date(p0.recorded_at);
      baseDate.setMinutes(baseDate.getMinutes() - 10);
      points = [
        { equity: 1000.0, balance: 1000.0, recorded_at: baseDate.toISOString() },
        p0
      ];
    }

    const equities = points.map(p => p.equity);
    const minVal = Math.min(...equities, 990.0) * 0.995;
    const maxVal = Math.max(...equities, 1010.0) * 1.005;
    const valRange = maxVal - minVal || 1.0;

    const width = 600;
    const height = 180;
    const paddingLeft = 45;
    const paddingRight = 15;
    const paddingTop = 15;
    const paddingBottom = 20;

    const getX = (index: number) => {
      return paddingLeft + (index / (points.length - 1)) * (width - paddingLeft - paddingRight);
    };

    const getY = (val: number) => {
      return height - paddingBottom - ((val - minVal) / valRange) * (height - paddingTop - paddingBottom);
    };

    // Generate SVG path string
    let pathD = `M ${getX(0)} ${getY(points[0].equity)}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${getX(i)} ${getY(points[i].equity)}`;
    }

    // Generate area path string (closes the polygon to bottom)
    const areaD = `${pathD} L ${getX(points.length - 1)} ${height - paddingBottom} L ${getX(0)} ${height - paddingBottom} Z`;

    return (
      <div className="bg-neutral-900/40 border border-neutral-850 rounded-2xl p-5 backdrop-blur-sm">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-purple-400" />
          Bakiye ve Net Portföy Grafiği (Sanal)
        </h3>
        <div className="relative w-full h-48 bg-neutral-950/60 rounded-xl p-3 border border-neutral-850/80 flex flex-col justify-between">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(139, 92, 246)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            
            {/* Grid horizontal lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
              const val = minVal + ratio * valRange;
              const y = getY(val);
              return (
                <g key={idx}>
                  <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  <text x={paddingLeft - 8} y={y + 3} textAnchor="end" className="fill-neutral-500 text-[8px] font-mono">${val.toFixed(0)}</text>
                </g>
              );
            })}

            {/* Area under the line */}
            <path d={areaD} fill="url(#chartGrad)" />

            {/* Sparkline */}
            <path d={pathD} fill="none" stroke="rgb(139, 92, 246)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Circles at data points */}
            {points.map((p, idx) => (
              <circle 
                key={idx} 
                cx={getX(idx)} 
                cy={getY(p.equity)} 
                r={points.length > 20 ? "1.5" : "2.5"} 
                className="fill-purple-400 stroke-purple-600 stroke-[1]"
              />
            ))}
          </svg>
        </div>
        <div className="flex justify-between text-[10px] text-neutral-500 font-mono mt-2 px-1">
          <span>{formatDate(points[0].recorded_at)}</span>
          <span>Son Değer: ${points[points.length - 1].equity.toFixed(2)}</span>
          <span>{formatDate(points[points.length - 1].recorded_at)}</span>
        </div>
      </div>
    );
  };

  const filteredVirtualTrades = virtualTrades.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.direction.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-purple-500/30 selection:text-purple-200">
      {/* Top Premium Navbar */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-purple-600 to-indigo-600 rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.4)] animate-pulse">
              <Brain className="text-white" size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
                  Poly AI Quant Agent
                </h1>
                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase">
                  Beta v1.0
                </span>
              </div>
              <p className="text-xs text-neutral-400">Autonomously Scan Polymarket Contracts & Optimize Strategy</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="p-2.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 hover:text-white rounded-xl border border-neutral-700/50 transition duration-200 flex items-center justify-center"
              title="Yenile"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={triggerReset}
              disabled={isLoading}
              className="px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-rose-400 hover:text-rose-350 border border-neutral-800 hover:border-rose-500/20 rounded-xl font-medium transition duration-200 flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              Portföyü Sıfırla
            </button>

            <button
              onClick={triggerScan}
              disabled={isScanning}
              className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl shadow-lg hover:shadow-purple-500/10 hover:border-purple-400/30 border border-purple-500/20 font-medium transition duration-200 flex items-center gap-2 disabled:opacity-50 text-sm"
            >
              <Zap size={15} className={isScanning ? 'animate-bounce' : ''} />
              {isScanning ? 'Taranıyor...' : 'Şimdi Tara'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        
        {/* Status Toast */}
        {scanMessage && (
          <div className={`mb-6 p-4 rounded-xl border text-sm flex items-center gap-3 animate-fade-in ${
            scanMessage.startsWith('Error') 
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            <Info size={16} />
            <span>{scanMessage}</span>
          </div>
        )}

        {/* Top Status Cards */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm group hover:border-neutral-700/50 transition">
            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-600/5 rounded-full blur-2xl group-hover:bg-purple-600/10 transition duration-300"></div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-neutral-400 text-sm font-medium">Aktif Sinyaller</span>
              <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg"><Sparkles size={16} /></div>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight">{signals.length}</div>
            <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1 font-medium">
              <span>●</span> Bulunan Arbitraj & Fırsat
            </p>
          </div>

          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm group hover:border-neutral-700/50 transition">
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl group-hover:bg-indigo-600/10 transition duration-300"></div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-neutral-400 text-sm font-medium">Portföy Değeri (Net)</span>
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg"><Briefcase size={16} /></div>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight">
              ${portfolio ? portfolio.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
            </div>
            <p className="text-xs text-indigo-400 mt-2 flex items-center gap-1 font-medium">
              <span>●</span> Nakit: ${portfolio ? portfolio.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
            </p>
          </div>

          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm group hover:border-neutral-700/50 transition">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-600/5 rounded-full blur-2xl group-hover:bg-emerald-600/10 transition duration-300"></div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-neutral-400 text-sm font-medium">AI Risk Stansı</span>
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg"><Brain size={16} /></div>
            </div>
            <div className="text-2xl font-bold text-white tracking-tight uppercase">
              {portfolio ? portfolio.risk_profile : 'MODERATE'}
            </div>
            <p className="text-xs text-neutral-400 mt-2 truncate">
              {portfolio ? portfolio.risk_justification : 'Başlangıç dengeli mod.'}
            </p>
          </div>

          <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-5 relative overflow-hidden backdrop-blur-sm group hover:border-neutral-700/50 transition">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-600/5 rounded-full blur-2xl group-hover:bg-amber-600/10 transition duration-300"></div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-neutral-400 text-sm font-medium">Sanal Başarı Oranı</span>
              <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg"><History size={16} /></div>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight">%{winRate}</div>
            <p className="text-xs text-neutral-400 mt-2">
              Toplam {virtualTrades.length} İşlem / {resolvedTrades.length} Sonuçlanan
            </p>
          </div>
        </section>

        {/* Tab Controls and Search */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-6 border-b border-neutral-800/60 pb-5">
          <div className="flex p-1 bg-neutral-900 border border-neutral-800 rounded-xl max-w-md w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setActiveTab('signals')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'signals'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Zap size={14} />
              Fırsat Sinyalleri
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'portfolio'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Briefcase size={14} />
              Sanal Portföy
            </button>
            <button
              onClick={() => setActiveTab('tunings')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'tunings'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Sliders size={14} />
              AI Parametreleri
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'logs'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Brain size={14} />
              Ajan Günlüğü
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-72">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-neutral-500">
              <Search size={16} />
            </span>
            <input
              type="text"
              placeholder="Ara (Sembol, yön, seviye...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 focus:border-neutral-700 rounded-xl py-2 pl-10 pr-4 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition"
            />
          </div>
        </div>

        {/* Tab Contents */}
        {isLoading && signals.length === 0 && tunings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="h-10 w-10 text-purple-500 animate-spin mb-4" />
            <p className="text-neutral-400">Veriler yükleniyor...</p>
          </div>
        ) : (
          <>
            {/* Tab: Signals */}
            {activeTab === 'signals' && (
              <div className="space-y-4">
                {filteredSignals.length === 0 ? (
                  <div className="bg-neutral-900/20 border border-neutral-800/80 rounded-2xl p-12 text-center">
                    <Zap className="h-12 w-12 text-neutral-600 mx-auto mb-4" />
                    <h3 className="text-base font-semibold text-neutral-300">Aktif Fırsat Sinyali Bulunmamaktadır</h3>
                    <p className="text-sm text-neutral-500 max-w-md mx-auto mt-2">
                      Ajan şu anda piyasaları izliyor. Yeni bir fiyat uyuşmazlığı tespit edildiğinde burada gösterilecektir.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {filteredSignals.map((signal) => {
                      const quantPercent = signal.quant_probability ? Math.round(signal.quant_probability * 100) : 0;
                      const polyPercent = signal.polymarket_price ? Math.round(signal.polymarket_price * 100) : 0;
                      const edgePercent = signal.edge_pct ? Math.round(signal.edge_pct * 100) : 0;

                      return (
                        <div 
                          key={signal.id} 
                          className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-5 hover:border-neutral-700/60 transition duration-300 shadow-md flex flex-col justify-between"
                        >
                          <div>
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div className="flex items-center gap-3">
                                <div className="px-3.5 py-2 bg-neutral-800 rounded-xl border border-neutral-700/50">
                                  <span className="text-lg font-bold text-white tracking-wider">{signal.symbol}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {getDirectionBadge(signal.direction)}
                                  <span className="text-[10px] text-neutral-400 font-mono">
                                    {formatDate(signal.created_at)}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                {getConfidenceBadge(signal.confidence_level)}
                                <span className="text-xs font-mono text-neutral-400">{signal.confidence_stars}</span>
                              </div>
                            </div>

                            {/* Prices details */}
                            <div className="grid grid-cols-3 gap-3 bg-neutral-950/60 rounded-xl p-3.5 border border-neutral-800/80 mb-5 text-sm">
                              <div>
                                <div className="text-[10px] text-neutral-500 uppercase font-semibold">Son Fiyat</div>
                                <div className="font-semibold text-neutral-200 mt-1">${signal.current_price.toLocaleString('en-US')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-neutral-500 uppercase font-semibold">Ref Fiyat</div>
                                <div className="font-semibold text-neutral-400 mt-1">${signal.ref_price.toLocaleString('en-US')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] text-neutral-500 uppercase font-semibold">Değişim</div>
                                <div className={`font-bold mt-1 ${signal.diff_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {signal.diff_pct >= 0 ? '+' : ''}{signal.diff_pct.toFixed(2)}%
                                </div>
                              </div>
                            </div>

                            {/* Probability bars */}
                            <div className="space-y-4 mb-5">
                              {/* Quant Win Rate */}
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-neutral-400 flex items-center gap-1"><Brain size={12} className="text-purple-400" /> Quant Başarı İhtimali</span>
                                  <span className="font-bold text-purple-400 font-mono">{quantPercent}%</span>
                                </div>
                                <div className="h-2 bg-neutral-850 rounded-full overflow-hidden border border-neutral-800">
                                  <div 
                                    className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full shadow-[0_0_8px_rgba(139,92,246,0.5)]" 
                                    style={{ width: `${quantPercent}%` }}
                                  ></div>
                                </div>
                              </div>

                              {/* Polymarket price */}
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-neutral-400">🛒 Polymarket İhtimali (Fiyat)</span>
                                  <span className="font-bold text-sky-400 font-mono">{polyPercent}% ({polyPercent}¢)</span>
                                </div>
                                <div className="h-2 bg-neutral-850 rounded-full overflow-hidden border border-neutral-800">
                                  <div 
                                    className="h-full bg-sky-500 rounded-full" 
                                    style={{ width: `${polyPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Edge comparison and Polymarket link */}
                          <div className="pt-4 border-t border-neutral-800/80 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-neutral-400">Fiyat Farkı (Kenar):</span>
                              <span className="text-base font-extrabold text-emerald-400 font-mono bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20">
                                +{edgePercent}%
                              </span>
                            </div>

                            {signal.polymarket_slug && (
                              <a
                                href={`https://polymarket.com/event/${signal.polymarket_slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition"
                              >
                                Polymarket'te Gör
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab: Tunings */}
            {activeTab === 'tunings' && (
              <div className="bg-neutral-900/40 border border-neutral-850 rounded-2xl overflow-hidden backdrop-blur-sm">
                <div className="p-5 border-b border-neutral-800 flex justify-between items-center">
                  <div>
                    <h3 className="text-base font-bold text-white">AI Parametre Ayarları</h3>
                    <p className="text-xs text-neutral-400 mt-0.5">Ajan tarafından dinamik olarak optimize edilen lookback günleri ve verim parametreleri.</p>
                  </div>
                  <span className="text-xs text-neutral-400 font-mono">Toplam Model: {filteredTunings.length}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-800 text-neutral-400 text-xs font-semibold uppercase bg-neutral-950/40">
                        <th className="py-4 px-6">Sembol</th>
                        <th className="py-4 px-6">Bahis Türü</th>
                        <th className="py-4 px-6">Geriye Bakış (Gün)</th>
                        <th className="py-4 px-6">Min Beklenen Verim</th>
                        <th className="py-4 px-6">Kapanış Eşiği (Dk)</th>
                        <th className="py-4 px-6 text-right">Son Güncelleme</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800/60 text-sm">
                      {filteredTunings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 px-6 text-center text-neutral-500">
                            Eşleşen parametre ayarı bulunamadı.
                          </td>
                        </tr>
                      ) : (
                        filteredTunings.map((t, idx) => (
                          <tr key={idx} className="hover:bg-neutral-900/25 transition">
                            <td className="py-3.5 px-6 font-bold text-white">{t.symbol}</td>
                            <td className="py-3.5 px-6">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${
                                t.bet_type === 'open' 
                                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                                  : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                              }`}>
                                {t.bet_type === 'open' ? 'Açılış' : 'Kapanış'}
                              </span>
                            </td>
                            <td className="py-3.5 px-6 font-mono text-neutral-300">{t.lookback_days} Gün</td>
                            <td className="py-3.5 px-6 font-mono text-emerald-400">%{t.min_expected_yield.toFixed(1)}</td>
                            <td className="py-3.5 px-6 font-mono text-neutral-400">{t.minutes_left_threshold} dk</td>
                            <td className="py-3.5 px-6 text-right text-neutral-400 text-xs font-mono">{formatDate(t.updated_at)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab: Portfolio */}
            {activeTab === 'portfolio' && (
              <div className="space-y-6">
                
                {/* Risk Profile & Justification card */}
                <div className="bg-gradient-to-tr from-neutral-900/60 to-purple-950/10 border border-purple-500/20 rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm shadow-md">
                  <div className="absolute top-0 right-0 w-36 h-36 bg-purple-500/5 rounded-full blur-3xl"></div>
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
                      <Brain size={24} className="animate-pulse" />
                    </div>
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">Aktif Risk Profili:</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                          portfolio?.risk_profile === 'CONSERVATIVE'
                            ? 'bg-blue-500/10 text-blue-400 border border-blue-500/35'
                            : portfolio?.risk_profile === 'AGGRESSIVE'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/35'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/35'
                        }`}>
                          {portfolio ? portfolio.risk_profile : 'MODERATE'}
                        </span>
                      </div>
                      <p className="text-sm text-neutral-300 leading-relaxed italic">
                        "{portfolio ? portfolio.risk_justification : 'Veriler yükleniyor...'}"
                      </p>
                      <p className="text-xs text-neutral-500">
                        * Ajan son işlemlerin başarı oranını ve kâr/zarar durumunu inceleyerek bu risk stansını otonom olarak ayarlar.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Balance & Net Equity Sparkline */}
                {renderBalanceChart()}

                {/* Open Positions Grid */}
                <div className="bg-neutral-900/40 border border-neutral-850 rounded-2xl p-5 backdrop-blur-sm">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <Zap size={16} className="text-indigo-400" />
                    Açık Sanal Pozisyonlar ({filteredVirtualTrades.filter(t => t.status === 'open').length})
                  </h3>

                  {filteredVirtualTrades.filter(t => t.status === 'open').length === 0 ? (
                    <p className="text-sm text-neutral-500 py-6 text-center">Aktif açık pozisyon bulunmamaktadır.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredVirtualTrades.filter(t => t.status === 'open').map((trade) => {
                        // Find live price from signals if available
                        const sig = signals.find(s => s.symbol === trade.symbol && s.direction === trade.direction && s.status === 'active');
                        const livePrice = sig?.polymarket_price ?? trade.entry_price;
                        const currentValue = trade.shares * livePrice;
                        const uPnL = currentValue - trade.size_usd;

                        return (
                          <div key={trade.id} className="bg-neutral-950/40 border border-neutral-800 rounded-xl p-4 flex flex-col justify-between hover:border-neutral-700 transition text-left">
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-bold text-white text-base">{trade.symbol}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                trade.direction.includes('UP') 
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}>
                                {trade.direction}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs border-b border-neutral-850 pb-3 mb-3">
                              <div>
                                <span className="text-neutral-500 block">Giriş Fiyatı:</span>
                                <span className="font-mono text-neutral-300">${trade.entry_price.toFixed(2)} ({Math.round(trade.entry_price * 100)}¢)</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">Adet (Pay):</span>
                                <span className="font-mono text-neutral-300">{trade.shares.toFixed(2)} Pay</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">Yatırım Tutarı:</span>
                                <span className="font-mono text-neutral-300">${trade.size_usd.toFixed(2)}</span>
                              </div>
                              <div>
                                <span className="text-neutral-500 block">Mevcut Değer:</span>
                                <span className="font-mono text-neutral-300">${currentValue.toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-neutral-400 font-mono text-[10px]">{formatDate(trade.created_at)}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-neutral-500">Kâr/Zarar:</span>
                                <span className={`font-mono font-bold ${uPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {uPnL >= 0 ? '+' : ''}${uPnL.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Closed Positions History */}
                <div className="bg-neutral-900/40 border border-neutral-850 rounded-2xl overflow-hidden backdrop-blur-sm">
                  <div className="p-5 border-b border-neutral-800 flex justify-between items-center">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <History size={16} className="text-amber-400" />
                      Sonuçlanan Sanal İşlemler ({filteredVirtualTrades.filter(t => t.status !== 'open').length})
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-800 text-neutral-400 text-xs font-semibold uppercase bg-neutral-950/40">
                          <th className="py-4 px-6">Varlık</th>
                          <th className="py-4 px-6">Yön</th>
                          <th className="py-4 px-6">Yatırım</th>
                          <th className="py-4 px-6">Giriş</th>
                          <th className="py-4 px-6">Durum</th>
                          <th className="py-4 px-6">Kâr/Zarar</th>
                          <th className="py-4 px-6 text-right">Tarih</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800/60 text-sm">
                        {filteredVirtualTrades.filter(t => t.status !== 'open').length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 px-6 text-center text-neutral-500">
                              Sonuçlanan sanal işlem geçmişi bulunmamaktadır.
                            </td>
                          </tr>
                        ) : (
                          filteredVirtualTrades.filter(t => t.status !== 'open').map((trade, idx) => (
                            <tr key={idx} className="hover:bg-neutral-900/25 transition">
                              <td className="py-3.5 px-6 font-bold text-white">{trade.symbol}</td>
                              <td className="py-3.5 px-6">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  trade.direction.includes('UP') 
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {trade.direction}
                                </span>
                              </td>
                              <td className="py-3.5 px-6 font-mono text-neutral-300">${trade.size_usd.toFixed(1)}</td>
                              <td className="py-3.5 px-6 font-mono text-neutral-400">${trade.entry_price.toFixed(2)}</td>
                              <td className="py-3.5 px-6">
                                <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${
                                  trade.status === 'won' 
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}>
                                  {trade.status === 'won' ? 'KAZANDI' : 'KAYBETTİ'}
                                </span>
                              </td>
                              <td className={`py-3.5 px-6 font-mono font-bold ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                              </td>
                              <td className="py-3.5 px-6 text-right text-neutral-400 text-xs font-mono">
                                {trade.resolved_at ? formatDate(trade.resolved_at) : formatDate(trade.created_at)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Logs */}
            {activeTab === 'logs' && (
              <div className="space-y-4">
                <div className="p-4 bg-neutral-900/40 border border-neutral-850 rounded-xl flex items-center justify-between text-xs text-neutral-400">
                  <div className="flex items-center gap-2">
                    <Info size={14} className="text-purple-400" />
                    <span>Ajan tarafından verilen optimizasyon ve trade kararlarının listesi.</span>
                  </div>
                  <span className="font-mono">Son {filteredLogs.length} Günlük</span>
                </div>

                <div className="space-y-3">
                  {filteredLogs.length === 0 ? (
                    <div className="bg-neutral-900/20 border border-neutral-850 rounded-2xl p-12 text-center text-neutral-500 text-sm">
                      Kayıtlı ajan günlüğü bulunmamaktadır.
                    </div>
                  ) : (
                    filteredLogs.map((log) => {
                      const isExpanded = expandedLogId === log.id;

                      return (
                        <div 
                          key={log.id}
                          className="bg-neutral-900/40 border border-neutral-850 rounded-xl overflow-hidden hover:border-neutral-800 transition"
                        >
                          {/* Log Header Row */}
                          <div 
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3">
                              <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
                                log.log_type === 'Tuning' 
                                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' 
                                  : log.log_type === 'Decision'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'
                              }`}>
                                {log.log_type}
                              </span>
                              <h4 className="text-sm font-semibold text-white truncate max-w-[280px] sm:max-w-md md:max-w-xl">
                                {log.summary}
                              </h4>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-neutral-400">
                              <span className="font-mono text-[10px] hidden md:inline">{formatDate(log.created_at)}</span>
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </div>
                          </div>

                          {/* Expanded Details */}
                          {isExpanded && (
                            <div className="px-4 pb-5 pt-2 border-t border-neutral-800 bg-neutral-950/40 text-sm space-y-4">
                              <div className="text-xs text-neutral-400 font-mono block md:hidden mb-2">
                                Tarih: {formatDate(log.created_at)}
                              </div>
                              <div 
                                className="text-neutral-300 leading-relaxed text-sm whitespace-pre-wrap py-2"
                                dangerouslySetInnerHTML={{ __html: log.details }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-neutral-800/80 bg-neutral-900/30 py-6 text-center text-xs text-neutral-500 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Traders Entertainment. Tüm Hakları Saklıdır.</p>
          <div className="flex items-center gap-4 text-neutral-400">
            <span className="flex items-center gap-1"><Database size={12} className="text-purple-400" /> SQLite DB</span>
            <span>•</span>
            <span className="flex items-center gap-1"><Brain size={12} className="text-indigo-400" /> Llama 3.3 Optimizer</span>
            <span>•</span>
            <span className="flex items-center gap-1"><Sparkles size={12} className="text-emerald-400" /> Pyth Network Prices</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
