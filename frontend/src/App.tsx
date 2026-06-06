import { useState, useEffect, useRef, useCallback } from 'react';
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
  History,
  XCircle,
  Loader2,
  LayoutGrid,
  MessageSquare,
  Send,
  BookOpen,
  User,
  ArrowLeft,
  Activity,
} from 'lucide-react';

import type {
  Signal, Tuning, AgentLog, Portfolio, VirtualTrade,
  ChatMessage, Restrictions, EquityPoint,
  TabKey, PortfolioView, AppView
} from './types';

import { formatDate, formatMarkdown, generateDiaryEntries, formatCurrency } from './utils/formatters';
import HeroSection from './components/landing/HeroSection';

// ─── API Configuration ──────────────────────────────────────────
const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

// ═════════════════════════════════════════════════════════════════
//  APP COMPONENT
// ═════════════════════════════════════════════════════════════════

function App() {
  // ─── View State ─────────────────────────────────────────────
  const [appView, setAppView] = useState<AppView>('landing');

  // ─── Tab & UI State ─────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>('terminal');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [portfolioView, setPortfolioView] = useState<PortfolioView>('virtual');
  const [isFirstLoad, setIsFirstLoad] = useState(true);

  // ─── Data State ─────────────────────────────────────────────
  const [signals, setSignals] = useState<Signal[]>([]);
  const [tunings, setTunings] = useState<Tuning[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [virtualTrades, setVirtualTrades] = useState<VirtualTrade[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<EquityPoint[]>([]);

  // ─── Loading/Action State ───────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [closingTradeId, setClosingTradeId] = useState<number | null>(null);
  const [closeResult, setCloseResult] = useState<string | null>(null);

  // ─── Restrictions State ─────────────────────────────────────
  const [restrictions, setRestrictions] = useState<Restrictions>({
    block_stocks_down: false,
    block_commodities_down: false,
    trading_ban_enabled: false,
    trading_ban_start: '22:00',
    trading_ban_end: '08:00',
  });
  const [isSavingRestrictions, setIsSavingRestrictions] = useState(false);

  // ─── Chat State ─────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'Merhaba! Ben Poly AI Quant Algoritman. Polymarket üzerindeki aktif pozisyonları, fırsat sinyallerini ve kısıtlama kararlarını takip ediyorum. Bana risk seviyeni güncelleyebilir, DOWN bahislerine kısıtlama getirmek istediğini söyleyebilir ya da belirli saatler için işlem yasağı koyabilirsin!',
      timestamp: new Date(),
    },
  ]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ═══════════════════════════════════════════════════════════
  //  DATA FETCHING
  // ═══════════════════════════════════════════════════════════

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [signalsRes, tuningsRes, logsRes, portfolioRes, tradesRes, historyRes, restrictionsRes] = await Promise.all([
        fetch(`${API_BASE}/api/signals`),
        fetch(`${API_BASE}/api/tunings`),
        fetch(`${API_BASE}/api/logs`),
        fetch(`${API_BASE}/api/portfolio`),
        fetch(`${API_BASE}/api/trades/virtual`),
        fetch(`${API_BASE}/api/portfolio/history`),
        fetch(`${API_BASE}/api/restrictions`).catch(() => null),
      ]);

      if (signalsRes.ok) setSignals(await signalsRes.json());
      if (tuningsRes.ok) setTunings(await tuningsRes.json());
      if (logsRes.ok) setLogs(await logsRes.json());
      if (portfolioRes.ok) {
        const pData = await portfolioRes.json();
        setPortfolio(pData);
        if (isFirstLoad) {
          setPortfolioView(pData.trading_mode === 'REAL' ? 'real' : 'virtual');
          setIsFirstLoad(false);
        }
      }
      if (tradesRes.ok) setVirtualTrades(await tradesRes.json());
      if (historyRes.ok) setPortfolioHistory(await historyRes.json());
      if (restrictionsRes && restrictionsRes.ok) {
        setRestrictions(await restrictionsRes.json());
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isFirstLoad]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab === 'chat') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [chatMessages, activeTab]);

  // ═══════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════

  const saveRestrictions = async (updatedRestrictions = restrictions) => {
    setIsSavingRestrictions(true);
    try {
      const res = await fetch(`${API_BASE}/api/restrictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedRestrictions),
      });
      if (res.ok) {
        setRestrictions(updatedRestrictions);
        fetchData();
      }
    } catch (err) {
      console.error('Error saving restrictions:', err);
    } finally {
      setIsSavingRestrictions(false);
    }
  };

  const toggleRestriction = (key: keyof Restrictions) => {
    const newVal = !restrictions[key];
    const updated = { ...restrictions, [key]: newVal };
    setRestrictions(updated);
    saveRestrictions(updated);
  };

  const sendChatMessage = async (msgText: string) => {
    if (!msgText.trim() || isSendingMessage) return;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: msgText,
      timestamp: new Date(),
    };
    setChatMessages(prev => [...prev, userMsg]);
    setCurrentMessage('');
    setIsSendingMessage(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msgText }),
      });
      const data = await res.json();
      if (res.ok) {
        setChatMessages(prev => [...prev, {
          id: `agent-${Date.now()}`,
          sender: 'agent',
          text: data.response || 'Bir hata oluştu veya boş bir yanıt döndü.',
          timestamp: new Date(),
        }]);
      } else {
        setChatMessages(prev => [...prev, {
          id: `agent-err-${Date.now()}`,
          sender: 'agent',
          text: `Hata: ${data.detail || 'Sohbet sunucusundan hata döndü.'}`,
          timestamp: new Date(),
        }]);
      }
    } catch {
      setChatMessages(prev => [...prev, {
        id: `agent-err-${Date.now()}`,
        sender: 'agent',
        text: 'Sunucuya bağlanılamadı. Lütfen backend servisinizin çalıştığından emin olun.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsSendingMessage(false);
    }
  };

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
    } catch {
      setScanMessage('Failed to connect to the backend server.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  const closeTrade = async (tradeId: number, symbol: string) => {
    const password = window.prompt('Güvenlik Onayı: Lütfen pozisyonu kapatmak için şifreyi girin:');
    if (password === null) return;
    if (password !== 'allah') {
      window.alert('Hatalı şifre! Pozisyon kapatma işlemi iptal edildi.');
      return;
    }
    if (!window.confirm(`${symbol} pozisyonunu kapatmak istediğinize emin misiniz?`)) return;
    setClosingTradeId(tradeId);
    setCloseResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/trades/${tradeId}/close?password=${encodeURIComponent(password)}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCloseResult(data.message || 'Pozisyon başarıyla kapatıldı!');
        await fetchData();
      } else {
        setCloseResult(`Hata: ${data.detail || 'Pozisyon kapatılamadı'}`);
      }
    } catch {
      setCloseResult('Sunucuya bağlanılamadı.');
    } finally {
      setClosingTradeId(null);
      setTimeout(() => setCloseResult(null), 8000);
    }
  };

  const triggerReset = async () => {
    const password = window.prompt('Güvenlik Onayı: Portföyü sıfırlamak için lütfen şifreyi girin:');
    if (password === null) return;
    if (password !== 'allah') {
      window.alert('Hatalı şifre! Portföy sıfırlama işlemi iptal edildi.');
      return;
    }
    if (!window.confirm('Portföy geçmişini ve işlemleri sıfırlamak istediğinize emin misiniz?')) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset-portfolio?password=${encodeURIComponent(password)}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setScanMessage(data.message || 'Portföy başarıyla sıfırlandı!');
        await fetchData();
      } else {
        setScanMessage(`Error: ${data.detail || 'Failed to reset portfolio'}`);
      }
    } catch {
      setScanMessage('Failed to connect to the backend server.');
    } finally {
      setIsLoading(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  // ═══════════════════════════════════════════════════════════
  //  COMPUTED VALUES
  // ═══════════════════════════════════════════════════════════

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

  const currentTrades = virtualTrades.filter(t =>
    portfolioView === 'real' ? t.trade_type === 'real' : t.trade_type !== 'real'
  );
  const filteredCurrentTrades = currentTrades.filter(t =>
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.direction.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.status.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const resolvedTrades = currentTrades.filter(t => t.status !== 'open');
  const winCount = resolvedTrades.filter(t => t.status === 'won').length;
  const winRate = resolvedTrades.length > 0 ? Math.round((winCount / resolvedTrades.length) * 100) : 0;

  // ═══════════════════════════════════════════════════════════
  //  HELPER RENDERERS
  // ═══════════════════════════════════════════════════════════

  const getDirectionBadge = (dir: string) => {
    const isUp = dir.includes('UP');
    const label = dir.replace('OPEN_', 'AÇILIŞ ');
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
        isUp
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
          : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
      }`}>
        {isUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {label}
      </span>
    );
  };

  const getConfidenceBadge = (level: string) => {
    const styles: Record<string, string> = {
      'ÇOK GÜVENLİ': 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25',
      'GÜVENLİ': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
      'ORTA RİSKLİ': 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    };
    const emojis: Record<string, string> = {
      'ÇOK GÜVENLİ': '🚀',
      'GÜVENLİ': '🛡️',
      'ORTA RİSKLİ': '⚠️',
    };
    const s = styles[level] || 'bg-rose-500/15 text-rose-300 border-rose-500/25';
    const e = emojis[level] || '🎰';
    return <span className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg ${s}`}>{e} {level}</span>;
  };

  const renderBalanceChart = () => {
    if (portfolioHistory.length === 0) return null;
    let points = [...portfolioHistory];
    if (points.length === 1) {
      const p0 = points[0];
      const baseDate = new Date(p0.recorded_at);
      baseDate.setMinutes(baseDate.getMinutes() - 10);
      points = [{ equity: 1000.0, balance: 1000.0, recorded_at: baseDate.toISOString() }, p0];
    }
    const equities = points.map(p => p.equity);
    const minVal = Math.min(...equities, 990.0) * 0.995;
    const maxVal = Math.max(...equities, 1010.0) * 1.005;
    const valRange = maxVal - minVal || 1.0;
    const width = 600, height = 180;
    const pl = 45, pr = 15, pt = 15, pb = 20;
    const getX = (i: number) => pl + (i / (points.length - 1)) * (width - pl - pr);
    const getY = (v: number) => height - pb - ((v - minVal) / valRange) * (height - pt - pb);
    let pathD = `M ${getX(0)} ${getY(points[0].equity)}`;
    for (let i = 1; i < points.length; i++) pathD += ` L ${getX(i)} ${getY(points[i].equity)}`;
    const areaD = `${pathD} L ${getX(points.length - 1)} ${height - pb} L ${getX(0)} ${height - pb} Z`;

    return (
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-purple-400" />
          Bakiye ve Net Portföy Grafiği ({portfolioView === 'real' ? 'Gerçek' : 'Sanal'})
        </h3>
        <div className="relative w-full h-48 bg-[rgba(6,6,11,0.5)] rounded-xl p-3 border border-white/[0.04]">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(139, 92, 246)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
              const val = minVal + ratio * valRange;
              const y = getY(val);
              return (
                <g key={idx}>
                  <line x1={pl} y1={y} x2={width - pr} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                  <text x={pl - 8} y={y + 3} textAnchor="end" className="fill-neutral-600 text-[8px] font-mono">${val.toFixed(0)}</text>
                </g>
              );
            })}
            <path d={areaD} fill="url(#chartGrad)" />
            <path d={pathD} fill="none" stroke="rgb(139, 92, 246)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, idx) => (
              <circle key={idx} cx={getX(idx)} cy={getY(p.equity)} r={points.length > 20 ? '1.5' : '2.5'} className="fill-purple-400 stroke-purple-600 stroke-[1]" />
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

  // ═══════════════════════════════════════════════════════════
  //  LANDING PAGE VIEW
  // ═══════════════════════════════════════════════════════════

  if (appView === 'landing') {
    return (
      <HeroSection
        onEnterDashboard={() => setAppView('dashboard')}
        stats={{
          totalTrades: currentTrades.length,
          winRate,
          activeSignals: signals.length,
          equity: portfolio ? (portfolioView === 'real' ? portfolio.real.equity : portfolio.virtual.equity) : 1000,
        }}
      />
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  DASHBOARD VIEW
  // ═══════════════════════════════════════════════════════════

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'terminal', label: 'Terminal', icon: <LayoutGrid size={14} /> },
    { key: 'chat', label: 'AI Sohbet', icon: <MessageSquare size={14} /> },
    { key: 'signals', label: 'Sinyaller', icon: <Zap size={14} />, count: filteredSignals.length },
    { key: 'portfolio', label: 'Portföy', icon: <Briefcase size={14} /> },
    { key: 'tunings', label: 'Parametreler', icon: <Sliders size={14} />, count: filteredTunings.length },
    { key: 'logs', label: 'Günlük', icon: <Brain size={14} />, count: filteredLogs.length },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-neutral-100 flex flex-col font-sans">

      {/* ═══ PREMIUM NAVBAR ═══ */}
      <header className="navbar-glass sticky top-0 z-50 px-5 sm:px-6 py-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          {/* Left — Logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAppView('landing')}
              className="p-2 hover:bg-white/5 rounded-xl transition-colors mr-1 group"
              title="Ana Sayfa"
            >
              <ArrowLeft size={18} className="text-neutral-500 group-hover:text-white transition-colors" />
            </button>
            <div className="relative">
              <div className="p-2.5 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl animate-pulse-glow">
                <Brain className="text-white" size={20} />
              </div>
              {/* Live indicator dot */}
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[var(--bg-primary)] animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-bold tracking-tight text-white">Poly AI Quant</h1>
                <span className="bg-gradient-to-r from-purple-500/20 to-indigo-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full text-[9px] font-semibold tracking-wider uppercase">
                  LIVE
                </span>
              </div>
              <p className="text-[10px] text-neutral-500 hidden sm:block font-medium tracking-wide">Autonomous Polymarket Trading Engine</p>
            </div>
          </div>

          {/* Right — Actions */}
          <div className="flex items-center gap-2">
            <a
              href="https://polymarket.com/@financebot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:inline-flex items-center gap-2 px-3.5 py-2 text-[12px] text-neutral-400 hover:text-white bg-white/[0.03] border border-white/[0.06] hover:border-purple-500/25 hover:bg-purple-500/5 rounded-xl transition-all duration-300"
            >
              <ExternalLink size={12} className="text-purple-400" />
              Polymarket Profili
            </a>
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="p-2.5 hover:bg-white/5 text-neutral-500 hover:text-white rounded-xl border border-white/[0.06] transition-all disabled:opacity-30"
              title="Yenile"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={triggerReset}
              disabled={isLoading}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-[12px] text-rose-400/80 hover:text-rose-300 bg-rose-500/5 border border-rose-500/10 hover:border-rose-500/25 rounded-xl transition-all disabled:opacity-30"
            >
              <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
              Sıfırla
            </button>
            <button
              onClick={triggerScan}
              disabled={isScanning}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl shadow-[0_4px_20px_rgba(139,92,246,0.25)] hover:shadow-[0_4px_28px_rgba(139,92,246,0.35)] border border-purple-500/30 font-semibold transition-all duration-300 flex items-center gap-2 disabled:opacity-50 text-[13px]"
            >
              <Zap size={14} className={isScanning ? 'animate-bounce' : ''} />
              {isScanning ? 'Taranıyor...' : 'Hızlı Tara'}
            </button>
          </div>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 relative">
        {/* Decorative background orbs */}
        <div className="orb orb-purple w-[500px] h-[500px] -top-40 -left-60 fixed" />
        <div className="orb orb-indigo w-[400px] h-[400px] top-1/2 -right-40 fixed" />

        {/* Toast */}
        {scanMessage && (
          <div className={`mb-5 p-4 rounded-xl border text-sm flex items-center gap-3 animate-fade-in backdrop-blur-sm ${
            scanMessage.startsWith('Error')
              ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          }`}>
            <Info size={16} />
            <span>{scanMessage}</span>
          </div>
        )}

        {/* ── STATUS CARDS ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          {/* Card 1: Aktif Sinyaller */}
          <div className="stat-card purple animate-fade-in-up stagger-1 group">
            <div className="orb orb-purple w-32 h-32 -top-10 -right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-neutral-400 text-[11px] font-medium uppercase tracking-wider">Aktif Sinyaller</span>
              <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Sparkles size={15} />
              </div>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-1 relative z-10">{signals.length}</div>
            <p className="text-[11px] text-emerald-400/80 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Bulunan Arbitraj & Fırsat
            </p>
          </div>

          {/* Card 2: Net Varlık */}
          <div className="stat-card indigo animate-fade-in-up stagger-2 group">
            <div className="orb orb-indigo w-32 h-32 -top-10 -right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-neutral-400 text-[11px] font-medium uppercase tracking-wider">Net Varlık ({portfolioView === 'real' ? 'Gerçek' : 'Sanal'})</span>
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Briefcase size={15} />
              </div>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-1 relative z-10 font-mono">
              ${portfolio ? formatCurrency(portfolioView === 'real' ? portfolio.real.equity : portfolio.virtual.equity) : '1,000.00'}
            </div>
            <p className="text-[11px] text-indigo-400/80 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              Nakit: ${portfolio ? formatCurrency(portfolioView === 'real' ? portfolio.real.balance : portfolio.virtual.balance) : '1,000.00'}
            </p>
          </div>

          {/* Card 3: AI Risk */}
          <div className="stat-card emerald animate-fade-in-up stagger-3 group">
            <div className="orb orb-emerald w-32 h-32 -top-10 -right-10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-neutral-400 text-[11px] font-medium uppercase tracking-wider">AI Risk Stansı</span>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Brain size={15} />
              </div>
            </div>
            <div className="relative z-10">
              <span className={`inline-block text-lg sm:text-xl font-black uppercase tracking-wider px-3 py-1 rounded-lg ${
                portfolio?.risk_profile === 'CONSERVATIVE' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : portfolio?.risk_profile === 'AGGRESSIVE' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {portfolio ? portfolio.risk_profile : 'MODERATE'}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 font-medium mt-2 truncate leading-relaxed">
              {portfolio ? portfolio.risk_justification.substring(0, 60) + '...' : 'Başlangıç dengeli mod.'}
            </p>
          </div>

          {/* Card 4: Başarı */}
          <div className="stat-card amber animate-fade-in-up stagger-4 group">
            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-neutral-400 text-[11px] font-medium uppercase tracking-wider">{portfolioView === 'real' ? 'Gerçek' : 'Sanal'} Başarı</span>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <History size={15} />
              </div>
            </div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-1 relative z-10">%{winRate}</div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-neutral-500 font-medium">{currentTrades.length} İşlem</span>
              <span className="text-neutral-600">•</span>
              <span className="text-neutral-500 font-medium">{resolvedTrades.length} Sonuçlanan</span>
            </div>
          </div>
        </section>

        {/* ── TAB CONTROLS ── */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-6">
          <div className="section-divider hidden sm:block w-full absolute left-0 right-0" />
          <div className="flex p-1 bg-[rgba(10,10,18,0.7)] border border-white/[0.06] rounded-xl overflow-x-auto backdrop-blur-sm">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all duration-250 flex items-center justify-center gap-2 whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'tab-active'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key
                      ? 'bg-purple-500/30 text-purple-200'
                      : 'bg-white/[0.06] text-neutral-500'
                  }`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-600 pointer-events-none" />
            <input
              type="text"
              placeholder="Ara..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[rgba(10,10,18,0.6)] border border-white/[0.06] focus:border-purple-500/25 rounded-xl py-2 pl-9 pr-4 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:ring-1 focus:ring-purple-500/15 transition"
            />
          </div>
        </div>

        {/* ── LOADING STATE ── */}
        {isLoading && signals.length === 0 && tunings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="h-10 w-10 text-purple-500 animate-spin mb-4" />
            <p className="text-neutral-400">Veriler yükleniyor...</p>
          </div>
        ) : (
          <>
            {/* ═══════════════════════════════════════════════════
                TAB: TERMINAL
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'terminal' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start animate-fade-in text-left">
                {/* Left Column */}
                <div className="xl:col-span-4 space-y-5">
                  {/* Portfolio Card */}
                  <div className="glass-card p-5 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition-all duration-500" />
                    <div className="flex items-center justify-between mb-4 border-b border-white/[0.04] pb-3">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Briefcase size={15} className="text-purple-400" />
                        Portföy ({portfolioView === 'real' ? 'Gerçek' : 'Sanal'})
                      </h4>
                      <div className="flex p-0.5 bg-[rgba(6,6,11,0.6)] border border-white/[0.06] rounded-lg">
                        <button onClick={() => setPortfolioView('virtual')} className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition ${portfolioView === 'virtual' ? 'bg-purple-600 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}>Sanal</button>
                        <button onClick={() => setPortfolioView('real')} className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition ${portfolioView === 'real' ? 'bg-emerald-600 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}>Gerçek</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="bg-[rgba(6,6,11,0.4)] rounded-xl p-3 border border-white/[0.04]">
                        <span className="text-[10px] text-neutral-500 block uppercase font-medium">Net Varlık</span>
                        <span className="text-xl font-bold text-white tracking-tight">${portfolio ? formatCurrency(portfolioView === 'real' ? portfolio.real.equity : portfolio.virtual.equity) : '1,000.00'}</span>
                      </div>
                      <div className="bg-[rgba(6,6,11,0.4)] rounded-xl p-3 border border-white/[0.04]">
                        <span className="text-[10px] text-neutral-500 block uppercase font-medium">Serbest Nakit</span>
                        <span className="text-xl font-bold text-neutral-300 tracking-tight">${portfolio ? formatCurrency(portfolioView === 'real' ? portfolio.real.balance : portfolio.virtual.balance) : '1,000.00'}</span>
                      </div>
                    </div>
                    <div className="bg-[rgba(6,6,11,0.4)] rounded-xl p-3 border border-white/[0.04] flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Risk Profili:</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        portfolio?.risk_profile === 'CONSERVATIVE' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/25'
                        : portfolio?.risk_profile === 'AGGRESSIVE' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                      }`}>{portfolio ? portfolio.risk_profile : 'MODERATE'}</span>
                    </div>
                  </div>

                  {/* Watchlist */}
                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2"><Sliders size={15} className="text-indigo-400" /> AI Parametreleri</span>
                      <span className="text-[10px] text-neutral-500 font-mono">{filteredTunings.length}</span>
                    </h4>
                    <div className="max-h-[280px] overflow-y-auto pr-1 space-y-2">
                      {filteredTunings.slice(0, 10).map((t, idx) => (
                        <div key={idx} className="glass-card-sm p-2.5 flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{t.symbol}</span>
                            <span className="text-[9px] text-neutral-500 uppercase">{t.bet_type === 'open' ? 'Açılış' : 'Kapanış'}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-neutral-400 font-mono block">Lookback: {t.lookback_days}g</span>
                            <span className="text-emerald-400 font-bold font-mono">Yield: %{t.min_expected_yield.toFixed(1)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Trading Restrictions */}
                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-4 flex items-center justify-between">
                      <span className="flex items-center gap-2"><Sliders size={15} className="text-rose-400" /> İşlem Kısıtlamaları</span>
                      {isSavingRestrictions && <Loader2 size={12} className="animate-spin text-purple-400" />}
                    </h4>
                    <div className="space-y-3 text-xs">
                      {/* Block Stocks Down */}
                      <div className="glass-card-sm p-3 flex items-center justify-between">
                        <div className="pr-2">
                          <span className="font-bold text-white block">Hisselerde DOWN Engelle</span>
                          <span className="text-[10px] text-neutral-500 block mt-0.5">S&P 500 düşüş bahislerini engeller.</span>
                        </div>
                        <div className={`toggle-switch ${restrictions.block_stocks_down ? 'active' : ''}`} onClick={() => toggleRestriction('block_stocks_down')} role="switch" aria-checked={restrictions.block_stocks_down} />
                      </div>
                      {/* Block Commodities Down */}
                      <div className="glass-card-sm p-3 flex items-center justify-between">
                        <div className="pr-2">
                          <span className="font-bold text-white block">Emtialarda DOWN Engelle</span>
                          <span className="text-[10px] text-neutral-500 block mt-0.5">Petrol, Altın ve Gümüş düşüş bahisleri.</span>
                        </div>
                        <div className={`toggle-switch ${restrictions.block_commodities_down ? 'active' : ''}`} onClick={() => toggleRestriction('block_commodities_down')} role="switch" aria-checked={restrictions.block_commodities_down} />
                      </div>
                      {/* Trading Ban */}
                      <div className="glass-card-sm p-3 flex flex-col space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="pr-2">
                            <span className="font-bold text-white block">Saatlik İşlem Yasağı</span>
                            <span className="text-[10px] text-neutral-500 block mt-0.5">Belirtilen saat aralığında işlem açılmasını durdurur.</span>
                          </div>
                          <div className={`toggle-switch ${restrictions.trading_ban_enabled ? 'active' : ''}`} onClick={() => toggleRestriction('trading_ban_enabled')} role="switch" aria-checked={restrictions.trading_ban_enabled} />
                        </div>
                        {restrictions.trading_ban_enabled && (
                          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.04]">
                            <div className="flex-1">
                              <label className="text-[10px] text-neutral-500 block mb-1">Başlangıç (TRT)</label>
                              <input type="text" placeholder="22:00" value={restrictions.trading_ban_start} onChange={e => setRestrictions({ ...restrictions, trading_ban_start: e.target.value })} className="w-full bg-[rgba(6,6,11,0.6)] border border-white/[0.06] rounded-lg p-2 text-center text-white focus:outline-none focus:border-purple-600 font-mono text-xs" />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] text-neutral-500 block mb-1">Bitiş (TRT)</label>
                              <input type="text" placeholder="08:00" value={restrictions.trading_ban_end} onChange={e => setRestrictions({ ...restrictions, trading_ban_end: e.target.value })} className="w-full bg-[rgba(6,6,11,0.6)] border border-white/[0.06] rounded-lg p-2 text-center text-white focus:outline-none focus:border-purple-600 font-mono text-xs" />
                            </div>
                            <div className="self-end pb-0.5">
                              <button onClick={() => saveRestrictions()} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition text-xs">Kaydet</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Center Column — Positions & Signals */}
                <div className="xl:col-span-5 space-y-5">
                  {/* Open Positions */}
                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Zap size={15} className="text-emerald-400" />
                      Açık Pozisyonlar ({filteredCurrentTrades.filter(t => t.status === 'open').length})
                    </h4>
                    {filteredCurrentTrades.filter(t => t.status === 'open').length === 0 ? (
                      <div className="text-center py-8 bg-[rgba(6,6,11,0.3)] border border-white/[0.04] rounded-xl">
                        <p className="text-xs text-neutral-500">Aktif açık pozisyon bulunmamaktadır.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                        {filteredCurrentTrades.filter(t => t.status === 'open').map(trade => {
                          const sig = signals.find(s => s.symbol === trade.symbol && s.direction === trade.direction && s.status === 'active');
                          const livePrice = trade.current_price ?? sig?.polymarket_price ?? trade.entry_price;
                          const uPnL = (trade.shares * livePrice) - trade.size_usd;
                          return (
                            <div key={trade.id} className="glass-card-sm p-3 flex flex-col">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white text-sm">{trade.symbol}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${trade.direction.includes('UP') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{trade.direction}</span>
                                </div>
                                <span className="text-[10px] text-neutral-500 font-mono">{formatDate(trade.created_at)}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-[10px] border-b border-white/[0.04] pb-2 mb-2">
                                <div><span className="text-neutral-500 block">Giriş:</span><span className="font-mono text-neutral-300">${trade.entry_price.toFixed(2)}</span></div>
                                <div><span className="text-neutral-500 block">Yatırım:</span><span className="font-mono text-neutral-300">${trade.size_usd.toFixed(1)}</span></div>
                                <div><span className="text-neutral-500 block">K/Z:</span><span className={`font-mono font-bold ${uPnL >= 0 ? 'profit-positive' : 'profit-negative'}`}>{uPnL >= 0 ? '+' : ''}${uPnL.toFixed(2)}</span></div>
                              </div>
                              <button onClick={() => closeTrade(trade.id, trade.symbol)} disabled={closingTradeId === trade.id} className="w-full py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-[10px] font-bold uppercase tracking-wider transition flex items-center justify-center gap-1.5 disabled:opacity-50">
                                {closingTradeId === trade.id ? <><Loader2 size={10} className="animate-spin" /> Satılıyor...</> : <><XCircle size={10} /> Pozisyonu Kapat</>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Active Signals */}
                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Sparkles size={15} className="text-purple-400 animate-pulse" />
                      Aktif Sinyaller ({filteredSignals.length})
                    </h4>
                    {filteredSignals.length === 0 ? (
                      <div className="text-center py-8 bg-[rgba(6,6,11,0.3)] border border-white/[0.04] rounded-xl">
                        <p className="text-xs text-neutral-500">Aktif sinyal bulunmamaktadır.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                        {filteredSignals.map(sig => (
                          <div key={sig.id} className="glass-card-sm p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-sm">{sig.symbol}</span>
                                {getDirectionBadge(sig.direction)}
                              </div>
                              <span className="text-[10px] text-emerald-400 font-extrabold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">+{sig.edge_pct ? Math.round(sig.edge_pct * 100) : 0}%</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
                              <div><span className="text-neutral-500">Quant:</span><span className="font-bold text-purple-400 ml-1">{sig.quant_probability ? Math.round(sig.quant_probability * 100) : 0}%</span></div>
                              <div><span className="text-neutral-500">Polymarket:</span><span className="font-bold text-sky-400 ml-1">{sig.polymarket_price ? Math.round(sig.polymarket_price * 100) : 0}¢</span></div>
                            </div>
                            {sig.polymarket_slug && (
                              <a href={`https://polymarket.com/event/${sig.polymarket_slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 font-semibold">Polymarket'te Gör <ExternalLink size={10} /></a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column — Logs & History */}
                <div className="xl:col-span-3 space-y-5">
                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Brain size={15} className="text-indigo-400" />
                      Ajan Günlüğü
                    </h4>
                    <div className="max-h-[280px] overflow-y-auto pr-1 space-y-2 text-[11px]">
                      {filteredLogs.length === 0 ? (
                        <p className="text-xs text-neutral-500 text-center py-4">Günlük kaydı bulunmuyor.</p>
                      ) : filteredLogs.slice(0, 8).map(log => (
                        <div key={log.id} className="glass-card-sm p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${log.log_type === 'Tuning' ? 'bg-purple-500/10 text-purple-400' : 'bg-emerald-500/10 text-emerald-400'}`}>{log.log_type}</span>
                            <span className="text-[8px] text-neutral-500 font-mono">{formatDate(log.created_at)}</span>
                          </div>
                          <p className="font-semibold text-neutral-200 truncate text-[10px]">{log.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="glass-card p-5">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <History size={15} className="text-amber-400" />
                      Son İşlemler
                    </h4>
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 text-xs">
                      {filteredCurrentTrades.filter(t => t.status !== 'open').length === 0 ? (
                        <p className="text-xs text-neutral-500 text-center py-4">Sonuçlanan işlem bulunmamaktadır.</p>
                      ) : filteredCurrentTrades.filter(t => t.status !== 'open').slice(0, 5).map((trade, idx) => (
                        <div key={idx} className="glass-card-sm p-2.5 flex justify-between items-center">
                          <div>
                            <span className="font-bold text-white block">{trade.symbol}</span>
                            <span className={`text-[8px] font-bold uppercase ${trade.status === 'won' ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.status === 'won' ? 'Kazandı' : 'Kaybetti'}</span>
                          </div>
                          <div className="text-right">
                            <span className={`font-mono font-bold block ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}</span>
                            <span className="text-[8px] text-neutral-500 font-mono">{formatDate(trade.resolved_at || trade.created_at)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════
                TAB: SIGNALS
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'signals' && (
              <div className="space-y-4 animate-fade-in">
                {filteredSignals.length === 0 ? (
                  <div className="glass-card p-12 text-center">
                    <Zap className="h-12 w-12 text-neutral-600 mx-auto mb-4" />
                    <h3 className="text-base font-semibold text-neutral-300">Aktif Fırsat Sinyali Bulunmamaktadır</h3>
                    <p className="text-sm text-neutral-500 max-w-md mx-auto mt-2">Ajan şu anda piyasaları izliyor.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {filteredSignals.map(signal => {
                      const qp = signal.quant_probability ? Math.round(signal.quant_probability * 100) : 0;
                      const pp = signal.polymarket_price ? Math.round(signal.polymarket_price * 100) : 0;
                      const ep = signal.edge_pct ? Math.round(signal.edge_pct * 100) : 0;
                      return (
                        <div key={signal.id} className="glass-card p-5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div className="flex items-center gap-3">
                                <div className="px-3.5 py-2 bg-[rgba(6,6,11,0.6)] rounded-xl border border-white/[0.06]">
                                  <span className="text-lg font-bold text-white tracking-wider">{signal.symbol}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  {getDirectionBadge(signal.direction)}
                                  <span className="text-[10px] text-neutral-500 font-mono">{formatDate(signal.created_at)}</span>
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                {getConfidenceBadge(signal.confidence_level)}
                                <span className="text-xs font-mono text-neutral-400">{signal.confidence_stars}</span>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3 bg-[rgba(6,6,11,0.5)] rounded-xl p-3.5 border border-white/[0.04] mb-5 text-sm">
                              <div><div className="text-[10px] text-neutral-500 uppercase font-semibold">Son Fiyat</div><div className="font-semibold text-neutral-200 mt-1">${signal.current_price.toLocaleString('en-US')}</div></div>
                              <div><div className="text-[10px] text-neutral-500 uppercase font-semibold">Ref Fiyat</div><div className="font-semibold text-neutral-400 mt-1">${signal.ref_price.toLocaleString('en-US')}</div></div>
                              <div><div className="text-[10px] text-neutral-500 uppercase font-semibold">Değişim</div><div className={`font-bold mt-1 ${signal.diff_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signal.diff_pct >= 0 ? '+' : ''}{signal.diff_pct.toFixed(2)}%</div></div>
                            </div>
                            <div className="space-y-4 mb-5">
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-neutral-400 flex items-center gap-1"><Brain size={12} className="text-purple-400" /> Quant Başarı</span>
                                  <span className="font-bold text-purple-400 font-mono">{qp}%</span>
                                </div>
                                <div className="h-2 bg-[rgba(6,6,11,0.6)] rounded-full overflow-hidden border border-white/[0.04]">
                                  <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full shadow-[0_0_8px_rgba(139,92,246,0.4)]" style={{ width: `${qp}%` }} />
                                </div>
                              </div>
                              <div>
                                <div className="flex justify-between text-xs mb-1.5">
                                  <span className="text-neutral-400">🛒 Polymarket Fiyat</span>
                                  <span className="font-bold text-sky-400 font-mono">{pp}% ({pp}¢)</span>
                                </div>
                                <div className="h-2 bg-[rgba(6,6,11,0.6)] rounded-full overflow-hidden border border-white/[0.04]">
                                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pp}%` }} />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="pt-4 border-t border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-neutral-400">Fark:</span>
                              <span className="text-base font-extrabold text-emerald-400 font-mono bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20">+{ep}%</span>
                            </div>
                            {signal.polymarket_slug && (
                              <a href={`https://polymarket.com/event/${signal.polymarket_slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition">Polymarket <ExternalLink size={12} /></a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════
                TAB: TUNINGS
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'tunings' && (
              <div className="glass-card overflow-hidden animate-fade-in">
                <div className="p-5 border-b border-white/[0.04] flex justify-between items-center">
                  <div><h3 className="text-base font-bold text-white">AI Parametre Ayarları</h3><p className="text-xs text-neutral-500 mt-0.5">Dinamik olarak optimize edilen parametreler.</p></div>
                  <span className="text-xs text-neutral-400 font-mono">Toplam: {filteredTunings.length}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.04] text-neutral-500 text-xs font-semibold uppercase bg-[rgba(6,6,11,0.4)]">
                        <th className="py-4 px-6">Sembol</th><th className="py-4 px-6">Tür</th><th className="py-4 px-6">Lookback</th><th className="py-4 px-6">Min Verim</th><th className="py-4 px-6">Eşik</th><th className="py-4 px-6 text-right">Güncelleme</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03] text-sm">
                      {filteredTunings.length === 0 ? (
                        <tr><td colSpan={6} className="py-8 px-6 text-center text-neutral-500">Eşleşen parametre bulunamadı.</td></tr>
                      ) : filteredTunings.map((t, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.02] transition">
                          <td className="py-3.5 px-6 font-bold text-white">{t.symbol}</td>
                          <td className="py-3.5 px-6"><span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${t.bet_type === 'open' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>{t.bet_type === 'open' ? 'Açılış' : 'Kapanış'}</span></td>
                          <td className="py-3.5 px-6 font-mono text-neutral-300">{t.lookback_days} Gün</td>
                          <td className="py-3.5 px-6 font-mono text-emerald-400">%{t.min_expected_yield.toFixed(1)}</td>
                          <td className="py-3.5 px-6 font-mono text-neutral-400">{t.minutes_left_threshold} dk</td>
                          <td className="py-3.5 px-6 text-right text-neutral-400 text-xs font-mono">{formatDate(t.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════
                TAB: PORTFOLIO
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'portfolio' && (
              <div className="space-y-5 animate-fade-in">
                {closeResult && (
                  <div className={`p-4 rounded-xl border text-sm flex items-center gap-3 animate-fade-in ${closeResult.startsWith('Hata') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                    <Info size={16} /><span>{closeResult}</span>
                  </div>
                )}
                {/* View Selector */}
                <div className="glass-card p-4 flex justify-between items-center">
                  <div className="text-left"><h4 className="text-sm font-bold text-white">Portföy Modu</h4><p className="text-xs text-neutral-500">Cüzdan verilerini seçin.</p></div>
                  <div className="flex p-1 bg-[rgba(6,6,11,0.6)] border border-white/[0.06] rounded-xl">
                    <button onClick={() => setPortfolioView('virtual')} className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition ${portfolioView === 'virtual' ? 'bg-purple-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200'}`}>Sanal</button>
                    <button onClick={() => setPortfolioView('real')} className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition flex items-center gap-1.5 ${portfolioView === 'real' ? 'bg-emerald-600 text-white shadow-md' : 'text-neutral-400 hover:text-neutral-200'}`}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />Gerçek</button>
                  </div>
                </div>
                {/* Risk Profile */}
                <div className="glass-card p-6 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-36 h-36 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition-all" />
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20"><Brain size={24} className="animate-pulse" /></div>
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">Aktif Risk Profili:</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${portfolio?.risk_profile === 'CONSERVATIVE' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/25' : portfolio?.risk_profile === 'AGGRESSIVE' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'}`}>{portfolio ? portfolio.risk_profile : 'MODERATE'}</span>
                      </div>
                      <p className="text-sm text-neutral-300 leading-relaxed italic">"{portfolio ? portfolio.risk_justification : 'Veriler yükleniyor...'}"</p>
                    </div>
                  </div>
                </div>
                {renderBalanceChart()}
                {/* Open Positions */}
                <div className="glass-card p-5">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2"><Zap size={16} className="text-indigo-400" /> Açık Pozisyonlar ({filteredCurrentTrades.filter(t => t.status === 'open').length})</h3>
                  {filteredCurrentTrades.filter(t => t.status === 'open').length === 0 ? (
                    <p className="text-sm text-neutral-500 py-6 text-center">Aktif açık pozisyon bulunmamaktadır.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredCurrentTrades.filter(t => t.status === 'open').map(trade => {
                        const sig = signals.find(s => s.symbol === trade.symbol && s.direction === trade.direction && s.status === 'active');
                        const livePrice = trade.current_price ?? sig?.polymarket_price ?? trade.entry_price;
                        const currentValue = trade.shares * livePrice;
                        const uPnL = currentValue - trade.size_usd;
                        return (
                          <div key={trade.id} className="glass-card-sm p-4 flex flex-col justify-between text-left">
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-bold text-white text-base">{trade.symbol}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${trade.direction.includes('UP') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{trade.direction}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs border-b border-white/[0.04] pb-3 mb-3">
                              <div><span className="text-neutral-500 block">Giriş:</span><span className="font-mono text-neutral-300">${trade.entry_price.toFixed(2)} ({Math.round(trade.entry_price * 100)}¢)</span></div>
                              <div><span className="text-neutral-500 block">Adet:</span><span className="font-mono text-neutral-300">{trade.shares.toFixed(2)}</span></div>
                              <div><span className="text-neutral-500 block">Yatırım:</span><span className="font-mono text-neutral-300">${trade.size_usd.toFixed(2)}</span></div>
                              <div><span className="text-neutral-500 block">Değer:</span><span className="font-mono text-neutral-300">${currentValue.toFixed(2)}</span></div>
                            </div>
                            <div className="flex justify-between items-center text-xs mb-3">
                              <span className="text-neutral-400 font-mono text-[10px]">{formatDate(trade.created_at)}</span>
                              <div className="flex items-center gap-1"><span className="text-neutral-500">K/Z:</span><span className={`font-mono font-bold ${uPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{uPnL >= 0 ? '+' : ''}${uPnL.toFixed(2)}</span></div>
                            </div>
                            <button onClick={() => closeTrade(trade.id, trade.symbol)} disabled={closingTradeId === trade.id} className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-semibold uppercase tracking-wider transition flex items-center justify-center gap-2 disabled:opacity-50">
                              {closingTradeId === trade.id ? <><Loader2 size={13} className="animate-spin" /> Satılıyor...</> : <><XCircle size={13} /> Pozisyonu Kapat</>}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Closed Positions Table */}
                <div className="glass-card overflow-hidden">
                  <div className="p-5 border-b border-white/[0.04] flex justify-between items-center">
                    <h3 className="text-base font-bold text-white flex items-center gap-2"><History size={16} className="text-amber-400" /> Sonuçlanan İşlemler ({filteredCurrentTrades.filter(t => t.status !== 'open').length})</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead><tr className="border-b border-white/[0.04] text-neutral-500 text-xs font-semibold uppercase bg-[rgba(6,6,11,0.4)]"><th className="py-4 px-6">Varlık</th><th className="py-4 px-6">Yön</th><th className="py-4 px-6">Yatırım</th><th className="py-4 px-6">Giriş</th><th className="py-4 px-6">Durum</th><th className="py-4 px-6">K/Z</th><th className="py-4 px-6 text-right">Tarih</th></tr></thead>
                      <tbody className="divide-y divide-white/[0.03] text-sm">
                        {filteredCurrentTrades.filter(t => t.status !== 'open').length === 0 ? (
                          <tr><td colSpan={7} className="py-8 px-6 text-center text-neutral-500">İşlem geçmişi bulunmamaktadır.</td></tr>
                        ) : filteredCurrentTrades.filter(t => t.status !== 'open').map((trade, idx) => (
                          <tr key={idx} className="hover:bg-white/[0.02] transition">
                            <td className="py-3.5 px-6 font-bold text-white">{trade.symbol}</td>
                            <td className="py-3.5 px-6"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${trade.direction.includes('UP') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{trade.direction}</span></td>
                            <td className="py-3.5 px-6 font-mono text-neutral-300">${trade.size_usd.toFixed(1)}</td>
                            <td className="py-3.5 px-6 font-mono text-neutral-400">${trade.entry_price.toFixed(2)}</td>
                            <td className="py-3.5 px-6"><span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${trade.status === 'won' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25' : 'bg-rose-500/15 text-rose-300 border border-rose-500/25'}`}>{trade.status === 'won' ? 'KAZANDI' : 'KAYBETTİ'}</span></td>
                            <td className={`py-3.5 px-6 font-mono font-bold ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}</td>
                            <td className="py-3.5 px-6 text-right text-neutral-400 text-xs font-mono">{trade.resolved_at ? formatDate(trade.resolved_at) : formatDate(trade.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════
                TAB: LOGS
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'logs' && (
              <div className="space-y-4 animate-fade-in">
                <div className="glass-card-sm p-4 flex items-center justify-between text-xs text-neutral-400">
                  <div className="flex items-center gap-2"><Info size={14} className="text-purple-400" /><span>Ajan kararlarının listesi.</span></div>
                  <span className="font-mono">Son {filteredLogs.length} Günlük</span>
                </div>
                <div className="space-y-3">
                  {filteredLogs.length === 0 ? (
                    <div className="glass-card p-12 text-center text-neutral-500 text-sm">Kayıtlı günlük bulunmamaktadır.</div>
                  ) : filteredLogs.map(log => {
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <div key={log.id} className="glass-card overflow-hidden">
                        <div onClick={() => setExpandedLogId(isExpanded ? null : log.id)} className="p-4 flex items-center justify-between gap-4 cursor-pointer select-none hover:bg-white/[0.02] transition">
                          <div className="flex items-center gap-3">
                            <span className={`px-2.5 py-1 rounded text-xs font-semibold ${log.log_type === 'Tuning' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : log.log_type === 'Decision' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-neutral-800 text-neutral-400 border border-neutral-700/50'}`}>{log.log_type}</span>
                            <h4 className="text-sm font-semibold text-white truncate max-w-[280px] sm:max-w-md md:max-w-xl">{log.summary}</h4>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-neutral-400">
                            <span className="font-mono text-[10px] hidden md:inline">{formatDate(log.created_at)}</span>
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="px-4 pb-5 pt-2 border-t border-white/[0.04] bg-[rgba(6,6,11,0.4)] text-sm space-y-4">
                            <div className="text-xs text-neutral-400 font-mono block md:hidden mb-2">Tarih: {formatDate(log.created_at)}</div>
                            <div className="text-neutral-300 leading-relaxed whitespace-pre-wrap py-2" dangerouslySetInnerHTML={{ __html: log.details }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════
                TAB: CHAT & DIARY
            ═══════════════════════════════════════════════════ */}
            {activeTab === 'chat' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch animate-fade-in text-left">
                {/* Chat Interface */}
                <div className="lg:col-span-8 flex flex-col glass-card p-5 h-[650px]">
                  <div className="flex items-center justify-between mb-4 border-b border-white/[0.04] pb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2"><Brain size={18} className="text-purple-400 animate-pulse" /> Ajan AI Sohbet</h4>
                    <span className="bg-purple-500/10 text-purple-400 border border-purple-500/25 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase">Groq Llama 3.3</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 mb-4 space-y-4 scroll-smooth">
                    {chatMessages.map(msg => {
                      const isAgent = msg.sender === 'agent';
                      return (
                        <div key={msg.id} className={`flex items-start gap-3 max-w-[85%] ${isAgent ? 'mr-auto' : 'ml-auto flex-row-reverse text-right'}`}>
                          <div className={`p-2 rounded-xl border shrink-0 ${isAgent ? 'bg-purple-500/10 text-purple-400 border-purple-500/25' : 'bg-white/5 text-neutral-300 border-white/[0.06]'}`}>
                            {isAgent ? <Brain size={16} /> : <User size={16} />}
                          </div>
                          <div className="flex flex-col gap-1">
                            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed border ${isAgent ? 'bg-[rgba(6,6,11,0.5)] text-neutral-200 border-white/[0.04] rounded-tl-none' : 'bg-purple-600/90 text-white border-purple-500/25 rounded-tr-none shadow-[0_0_15px_rgba(139,92,246,0.1)]'}`}>
                              {isAgent ? <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }} /> : <span className="whitespace-pre-wrap">{msg.text}</span>}
                            </div>
                            <span className="text-[9px] text-neutral-500 font-mono mt-0.5 px-1">{msg.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      );
                    })}
                    {isSendingMessage && (
                      <div className="flex items-start gap-3 mr-auto max-w-[85%]">
                        <div className="p-2 rounded-xl border bg-purple-500/10 text-purple-400 border-purple-500/25 shrink-0"><Brain size={16} className="animate-spin" /></div>
                        <div className="px-4 py-3 bg-[rgba(6,6,11,0.5)] border border-white/[0.04] text-neutral-400 rounded-2xl rounded-tl-none flex items-center gap-1.5 text-xs">
                          <span>Ajan düşünüyor</span>
                          <span className="flex gap-0.5 items-center mt-1">
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3 mt-1 border-t border-white/[0.04] pt-3">
                    {[
                      { label: 'Şu an ne yapıyorsun?', q: 'Şu an ne yapıyorsun? Hangi piyasaları izliyorsun?' },
                      { label: 'Son işlemlerini anlat', q: 'Son 15 işlemde ne yaptın? Detaylarını açıklar mısın?' },
                      { label: 'Neden Altın aldın?', q: 'Portföyündeki XAU alımının sebebi nedir?' },
                      { label: 'Piyasa tara', q: 'Şu anki piyasa durumunu tara, arbitrage oranlarını anlat.' },
                    ].map((chip, i) => (
                      <button key={i} onClick={() => sendChatMessage(chip.q)} disabled={isSendingMessage} className="px-3 py-1.5 bg-[rgba(6,6,11,0.5)] border border-white/[0.06] hover:border-purple-500/30 text-[11px] text-neutral-400 hover:text-purple-300 rounded-lg transition disabled:opacity-50">{chip.label}</button>
                    ))}
                  </div>
                  <form onSubmit={e => { e.preventDefault(); sendChatMessage(currentMessage); }} className="flex gap-3 mt-auto">
                    <input type="text" placeholder="Ajana bir soru sor..." value={currentMessage} onChange={e => setCurrentMessage(e.target.value)} disabled={isSendingMessage} className="flex-1 bg-[rgba(6,6,11,0.6)] border border-white/[0.06] focus:border-white/[0.12] rounded-xl py-3 px-4 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-purple-500/15 transition disabled:opacity-70" />
                    <button type="submit" disabled={!currentMessage.trim() || isSendingMessage} className="px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-semibold shadow-lg border border-purple-500/20 transition flex items-center gap-1.5 disabled:opacity-50"><Send size={15} /></button>
                  </form>
                </div>

                {/* Narrative Diary */}
                <div className="lg:col-span-4 flex flex-col glass-card p-5 h-[650px]">
                  <div className="flex items-center justify-between mb-4 border-b border-white/[0.04] pb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2"><BookOpen size={16} className="text-indigo-400" /> Ajanın Günlüğü</h4>
                    <span className="text-[10px] text-neutral-500 font-mono flex items-center gap-1"><Activity size={10} className="text-emerald-400" /> Canlı</span>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1 space-y-3">
                    {generateDiaryEntries(virtualTrades, logs).length === 0 ? (
                      <div className="text-center py-10 bg-[rgba(6,6,11,0.3)] border border-white/[0.04] rounded-xl"><p className="text-xs text-neutral-500">Günlük kaydı bulunmuyor.</p></div>
                    ) : generateDiaryEntries(virtualTrades, logs).map(entry => {
                      const styles: Record<string, string> = {
                        'trade-open': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                        'trade-won': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                        'trade-lost': 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                        'log-tuning': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                        'log-decision': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                      };
                      const badgeStyle = styles[entry.type] || 'bg-neutral-800 text-neutral-400 border-neutral-700';
                      const typeLabel = entry.type.replace('trade-', 'Poz ').replace('log-', 'Ajan ').replace('-open', ' Açılış').replace('-won', ' Kazanç').replace('-lost', ' Kayıp').replace('-tuning', ' Opt.').replace('-decision', ' Karar').replace('-info', ' Bilgi');
                      return (
                        <div key={entry.id} className="glass-card-sm p-3.5 flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${badgeStyle}`}>{typeLabel}</span>
                            <span className="text-[9px] text-neutral-500 font-mono">{formatDate(entry.rawDate)}</span>
                          </div>
                          <div>
                            <h5 className="font-bold text-white text-xs mb-1 leading-snug">{entry.title}</h5>
                            <p className="text-neutral-400 text-[11px] leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="mt-auto bg-[rgba(5,5,8,0.9)] py-5 text-center text-xs text-neutral-600 px-6 relative">
        <div className="section-divider absolute top-0 left-0 right-0" />
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-neutral-500">© 2026 Traders Entertainment. Tüm Hakları Saklıdır.</p>
          <div className="flex items-center gap-4 text-neutral-500">
            <span className="flex items-center gap-1.5"><Database size={11} className="text-purple-400/60" /> SQLite</span>
            <span className="text-neutral-700">•</span>
            <span className="flex items-center gap-1.5"><Brain size={11} className="text-indigo-400/60" /> Llama 3.3</span>
            <span className="text-neutral-700">•</span>
            <span className="flex items-center gap-1.5"><Sparkles size={11} className="text-emerald-400/60" /> Pyth Network</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

