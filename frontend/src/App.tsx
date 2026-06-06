import { useState, useEffect, useRef } from 'react';
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
  User
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

interface PortfolioDetails {
  balance: number;
  equity: number;
  open_positions_value: number;
}

interface Portfolio {
  trading_mode: string;
  risk_profile: string; // 'CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'
  risk_justification: string;
  virtual: PortfolioDetails;
  real: PortfolioDetails;
  balance: number;
  equity: number;
  open_positions_value: number;
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
  current_price?: number;
  trade_type?: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'signals' | 'tunings' | 'logs' | 'portfolio' | 'chat'>('terminal');
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
  const [portfolioView, setPortfolioView] = useState<'virtual' | 'real'>('virtual');
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [closingTradeId, setClosingTradeId] = useState<number | null>(null);
  const [closeResult, setCloseResult] = useState<string | null>(null);

  // Trading Restrictions states
  const [restrictions, setRestrictions] = useState<{
    block_stocks_down: boolean;
    block_commodities_down: boolean;
    trading_ban_enabled: boolean;
    trading_ban_start: string;
    trading_ban_end: string;
  }>({
    block_stocks_down: false,
    block_commodities_down: false,
    trading_ban_enabled: false,
    trading_ban_start: '22:00',
    trading_ban_end: '08:00'
  });
  const [isSavingRestrictions, setIsSavingRestrictions] = useState(false);

  // Chat integration states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'Merhaba! Ben Poly AI Quant Algoritman. Polymarket üzerindeki aktif pozisyonları, fırsat sinyallerini ve kısıtlama kararlarını takip ediyorum. Bana risk seviyeni güncelleyebilir, DOWN bahislerine kısıtlama getirmek istediğini söyleyebilir ya da belirli saatler için işlem yasağı koyabilirsin!',
      timestamp: new Date()
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const saveRestrictions = async (updatedRestrictions = restrictions) => {
    setIsSavingRestrictions(true);
    try {
      const res = await fetch(`${API_BASE}/api/restrictions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedRestrictions)
      });
      if (res.ok) {
        setRestrictions(updatedRestrictions);
        fetchData();
      }
    } catch (err) {
      console.error("Error saving restrictions:", err);
    } finally {
      setIsSavingRestrictions(false);
    }
  };

  const toggleRestriction = (key: keyof typeof restrictions) => {
    const newVal = !restrictions[key];
    const updated = { ...restrictions, [key]: newVal };
    setRestrictions(updated);
    saveRestrictions(updated);
  };

  // Fetch all data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [signalsRes, tuningsRes, logsRes, portfolioRes, tradesRes, historyRes, restrictionsRes] = await Promise.all([
        fetch(`${API_BASE}/api/signals`),
        fetch(`${API_BASE}/api/tunings`),
        fetch(`${API_BASE}/api/logs`),
        fetch(`${API_BASE}/api/portfolio`),
        fetch(`${API_BASE}/api/trades/virtual`),
        fetch(`${API_BASE}/api/portfolio/history`),
        fetch(`${API_BASE}/api/restrictions`).catch(() => null)
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

  // Auto-scroll to bottom of chat when new message arrives or chat tab is active
  useEffect(() => {
    if (activeTab === 'chat') {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [chatMessages, activeTab]);

  const sendChatMessage = async (msgText: string) => {
    if (!msgText.trim() || isSendingMessage) return;
    
    const userMsgId = `user-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: msgText,
      timestamp: new Date()
    };
    
    setChatMessages(prev => [...prev, userMsg]);
    setCurrentMessage('');
    setIsSendingMessage(true);
    
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: msgText })
      });
      
      const data = await res.json();
      if (res.ok) {
        const agentMsg: ChatMessage = {
          id: `agent-${Date.now()}`,
          sender: 'agent',
          text: data.response || 'Bir hata oluştu veya boş bir yanıt döndü.',
          timestamp: new Date()
        };
        setChatMessages(prev => [...prev, agentMsg]);
      } else {
        const errorMsg: ChatMessage = {
          id: `agent-err-${Date.now()}`,
          sender: 'agent',
          text: `Hata: ${data.detail || 'Sohbet sunucusundan hata döndü.'}`,
          timestamp: new Date()
        };
        setChatMessages(prev => [...prev, errorMsg]);
      }
    } catch (error) {
      const errorMsg: ChatMessage = {
        id: `agent-err-${Date.now()}`,
        sender: 'agent',
        text: 'Sunucuya bağlanılamadı. Lütfen backend servisinizin çalıştığından emin olun.',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev, errorMsg]);
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
    } catch (error) {
      setScanMessage('Failed to connect to the backend server.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(null), 5000);
    }
  };

  const closeTrade = async (tradeId: number, symbol: string) => {
    const password = window.prompt("Güvenlik Onayı: Lütfen pozisyonu kapatmak için şifreyi girin:");
    if (password === null) {
      return; // Canceled
    }
    if (password !== "allah") {
      window.alert("Hatalı şifre! Pozisyon kapatma işlemi iptal edildi.");
      return;
    }

    if (!window.confirm(`${symbol} pozisyonunu kapatmak istediğinize emin misiniz? Paylar mevcut en iyi bid fiyatından parça parça satılacaktır.`)) {
      return;
    }
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
    } catch (error) {
      setCloseResult('Sunucuya bağlanılamadı.');
    } finally {
      setClosingTradeId(null);
      setTimeout(() => setCloseResult(null), 8000);
    }
  };

  const triggerReset = async () => {
    const password = window.prompt("Güvenlik Onayı: Portföyü sıfırlamak için lütfen şifreyi girin:");
    if (password === null) {
      return; // Canceled
    }
    if (password !== "allah") {
      window.alert("Hatalı şifre! Portföy sıfırlama işlemi iptal edildi.");
      return;
    }

    if (!window.confirm("Portföy geçmişini ve işlemleri sıfırlamak istediğinize emin misiniz? (Gerçek bakiyeniz sıfırlanmaz, sadece işlem geçmişi temizlenir.)")) {
      return;
    }
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

  const currentTrades = virtualTrades.filter(t => 
    portfolioView === 'real' ? t.trade_type === 'real' : t.trade_type !== 'real'
  );
  const resolvedTrades = currentTrades.filter(t => t.status !== 'open');
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
          Bakiye ve Net Portföy Grafiği ({portfolioView === 'real' ? 'Gerçek' : 'Sanal'})
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

  const filteredCurrentTrades = currentTrades.filter(t => 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.direction.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatMarkdown = (text: string) => {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc text-neutral-300 my-1">$1</li>');
    html = html.replace(/```([^`]+)```/g, '<pre class="bg-neutral-950/80 p-3 rounded-lg border border-neutral-800 font-mono text-xs my-2 overflow-x-auto text-purple-300">$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code class="bg-neutral-850 px-1.5 py-0.5 rounded text-purple-400 font-mono text-xs font-semibold">$1</code>');
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  const generateDiaryEntries = () => {
    const entries: { id: string; type: string; title: string; content: string; date: Date; rawDate: string }[] = [];
    
    virtualTrades.forEach(t => {
      const date = new Date(t.created_at);
      const resolvedDate = t.resolved_at ? new Date(t.resolved_at) : null;
      const formattedCreated = formatDate(t.created_at);
      const formattedResolved = t.resolved_at ? formatDate(t.resolved_at) : '';
      
      if (t.status === 'open') {
        entries.push({
          id: `trade-open-${t.id}`,
          type: 'trade-open',
          title: `Pozisyon Açıldı: ${t.symbol} ${t.direction}`,
          content: `Saat ${formattedCreated} itibarıyla ${t.symbol} kontratında ${t.direction} yönünde $${t.size_usd.toFixed(2)} büyüklüğünde pozisyon açtım. Giriş Fiyatı: $${t.entry_price.toFixed(2)}. (${t.trade_type === 'real' ? 'Gerçek Polymarket cüzdanı' : 'Sanal portföy'})`,
          date: date,
          rawDate: t.created_at
        });
      } else if (t.status === 'won') {
        entries.push({
          id: `trade-won-${t.id}`,
          type: 'trade-won',
          title: `Pozisyon Kazançla Kapandı: ${t.symbol} ${t.direction}`,
          content: `Saat ${formattedResolved} itibarıyla ${t.symbol} ${t.direction} pozisyonunu kârla kapattım. Elde edilen kâr: +$${t.profit.toFixed(2)}. Giriş: $${t.entry_price.toFixed(2)}, Çıkış/Kapanış fiyatı lehimize sonuçlandı.`,
          date: resolvedDate || date,
          rawDate: t.resolved_at || t.created_at
        });
      } else if (t.status === 'lost') {
        entries.push({
          id: `trade-lost-${t.id}`,
          type: 'trade-lost',
          title: `Pozisyon Zararla Kapandı: ${t.symbol} ${t.direction}`,
          content: `Saat ${formattedResolved} itibarıyla ${t.symbol} ${t.direction} pozisyonunu maalesef zararla kapatmak zorunda kaldım. Zarar: -$${Math.abs(t.profit).toFixed(2)}. Giriş: $${t.entry_price.toFixed(2)}. Risk yönetimi limitlerim dahilinde pozisyon sonlandırıldı.`,
          date: resolvedDate || date,
          rawDate: t.resolved_at || t.created_at
        });
      }
    });
    
    logs.forEach(l => {
      const date = new Date(l.created_at);
      const cleanDetails = l.details ? l.details.replace(/<\/?[^>]+(>|$)/g, "") : "";
      let type = 'log-info';
      let titleEmoji = 'ℹ️';
      if (l.log_type === 'Tuning') {
        type = 'log-tuning';
        titleEmoji = '⚙️';
      } else if (l.log_type === 'Decision') {
        type = 'log-decision';
        titleEmoji = '🧠';
      }
      
      entries.push({
        id: `log-${l.id}`,
        type: type,
        title: `${titleEmoji} ${l.log_type}: ${l.summary}`,
        content: cleanDetails,
        date: date,
        rawDate: l.created_at
      });
    });
    
    return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

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
            <a
              href="https://polymarket.com/@financebot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-neutral-800 hover:border-neutral-700 rounded-xl font-medium transition duration-200 flex items-center gap-2 text-sm shadow-inner"
            >
              <ExternalLink size={14} className="text-purple-400" />
              <span>Polymarket Profili</span>
            </a>

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
              <span className="text-neutral-400 text-sm font-medium">Net Varlık (Equity - {portfolioView === 'real' ? 'Gerçek' : 'Sanal'})</span>
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg"><Briefcase size={16} /></div>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight">
              ${portfolio ? (portfolioView === 'real' ? portfolio.real.equity : portfolio.virtual.equity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
            </div>
            <p className="text-xs text-indigo-400 mt-2 flex items-center gap-1 font-medium">
              <span>●</span> Nakit: ${portfolio ? (portfolioView === 'real' ? portfolio.real.balance : portfolio.virtual.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
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
              <span className="text-neutral-400 text-sm font-medium">{portfolioView === 'real' ? 'Gerçek Başarı Oranı' : 'Sanal Başarı Oranı'}</span>
              <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg"><History size={16} /></div>
            </div>
            <div className="text-3xl font-extrabold text-white tracking-tight">%{winRate}</div>
            <p className="text-xs text-neutral-400 mt-2">
              Toplam {currentTrades.length} İşlem / {resolvedTrades.length} Sonuçlanan
            </p>
          </div>
        </section>

        {/* Tab Controls and Search */}
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-6 border-b border-neutral-800/60 pb-5">
          <div className="flex p-1 bg-neutral-900 border border-neutral-800 rounded-xl max-w-lg w-full sm:w-auto overflow-x-auto">
            <button
              onClick={() => setActiveTab('terminal')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'terminal'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <LayoutGrid size={14} />
              Terminal (Genel Bakış)
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                activeTab === 'chat'
                  ? 'bg-neutral-800 text-white shadow-md'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <MessageSquare size={14} />
              Ajanla Sohbet (AI Chat)
            </button>
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
              Portföy Takibi
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
            {/* Tab: Terminal (Genel Bakış) */}
            {activeTab === 'terminal' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start animate-fade-in text-left">
                {/* Left Column - Portfolio & Watchlist (Width: 35%) */}
                <div className="xl:col-span-4 space-y-6">
                  {/* Portfolio Card */}
                  <div className="bg-gradient-to-tr from-neutral-900/80 to-purple-950/10 border border-neutral-800 rounded-2xl p-5 relative overflow-hidden group hover:border-purple-500/20 transition duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition duration-300"></div>
                    <div className="flex items-center justify-between mb-4 border-b border-neutral-800/80 pb-3">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Briefcase size={16} className="text-purple-400" />
                        Portföy Modu ({portfolioView === 'real' ? 'Gerçek' : 'Sanal'})
                      </h4>
                      <div className="flex p-0.5 bg-neutral-950 border border-neutral-850 rounded-lg">
                        <button
                          onClick={() => setPortfolioView('virtual')}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition ${
                            portfolioView === 'virtual'
                              ? 'bg-purple-600 text-white shadow-sm'
                              : 'text-neutral-400 hover:text-neutral-200'
                          }`}
                        >
                          Sanal
                        </button>
                        <button
                          onClick={() => setPortfolioView('real')}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase transition ${
                            portfolioView === 'real'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'text-neutral-400 hover:text-neutral-200'
                          }`}
                        >
                          Gerçek
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="bg-neutral-950/50 rounded-xl p-3 border border-neutral-850">
                        <span className="text-[10px] text-neutral-500 block uppercase font-medium">Net Varlık (Equity)</span>
                        <span className="text-xl font-bold text-white tracking-tight">
                          ${portfolio ? (portfolioView === 'real' ? portfolio.real.equity : portfolio.virtual.equity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
                        </span>
                      </div>
                      <div className="bg-neutral-950/50 rounded-xl p-3 border border-neutral-850">
                        <span className="text-[10px] text-neutral-500 block uppercase font-medium">Serbest Nakit</span>
                        <span className="text-xl font-bold text-neutral-300 tracking-tight">
                          ${portfolio ? (portfolioView === 'real' ? portfolio.real.balance : portfolio.virtual.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '1,000.00'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-neutral-950/50 rounded-xl p-3 border border-neutral-850 flex items-center justify-between text-xs">
                      <span className="text-neutral-400">Risk Profili:</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        portfolio?.risk_profile === 'CONSERVATIVE'
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/35'
                          : portfolio?.risk_profile === 'AGGRESSIVE'
                            ? 'bg-rose-500/10 text-rose-400 border border-rose-500/35'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/35'
                      }`}>
                        {portfolio ? portfolio.risk_profile : 'MODERATE'}
                      </span>
                    </div>
                  </div>

                  {/* Watchlist & Parameters Card */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative overflow-hidden">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Sliders size={16} className="text-indigo-400" />
                        AI Parametreleri & Watchlist
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono">En Son {filteredTunings.length}</span>
                    </h4>
                    <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2 scrollbar-thin">
                      {filteredTunings.slice(0, 10).map((t, idx) => (
                        <div key={idx} className="bg-neutral-950/40 border border-neutral-850 rounded-xl p-2.5 hover:border-neutral-800 transition flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-white block">{t.symbol}</span>
                            <span className="text-[9px] text-neutral-550 uppercase">{t.bet_type === 'open' ? 'Açılış' : 'Kapanış'}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-neutral-450 font-mono block">Lookback: {t.lookback_days}g</span>
                            <span className="text-emerald-400 font-bold font-mono">Yield: %{t.min_expected_yield.toFixed(1)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Trading Restrictions Card */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative overflow-hidden">
                    <h4 className="text-sm font-bold text-white mb-4 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Sliders size={16} className="text-rose-400" />
                        İşlem Kısıtlamaları (Hassas Ayarlar)
                      </span>
                      {isSavingRestrictions && (
                        <Loader2 size={12} className="animate-spin text-purple-400" />
                      )}
                    </h4>
                    
                    <div className="space-y-4 text-xs">
                      {/* Checkbox 1: Block Stocks Down */}
                      <div className="flex items-center justify-between bg-neutral-950/40 border border-neutral-850 p-3 rounded-xl hover:border-neutral-800 transition">
                        <div className="pr-2">
                          <span className="font-bold text-white block">Hisselerde DOWN Engelle</span>
                          <span className="text-[10px] text-neutral-500 block mt-0.5">S&P 500 ve diğer hisselerde düşüş bahislerini engeller.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                          <input 
                            type="checkbox" 
                            checked={restrictions.block_stocks_down} 
                            onChange={() => toggleRestriction('block_stocks_down')}
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-400 after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-650 peer-checked:after:bg-white"></div>
                        </label>
                      </div>

                      {/* Checkbox 2: Block Commodities Down */}
                      <div className="flex items-center justify-between bg-neutral-950/40 border border-neutral-850 p-3 rounded-xl hover:border-neutral-800 transition">
                        <div className="pr-2">
                          <span className="font-bold text-white block">Emtialarda DOWN Engelle</span>
                          <span className="text-[10px] text-neutral-500 block mt-0.5">Petrol, Altın ve Gümüş düşüş bahislerini engeller.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                          <input 
                            type="checkbox" 
                            checked={restrictions.block_commodities_down} 
                            onChange={() => toggleRestriction('block_commodities_down')}
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-400 after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-650 peer-checked:after:bg-white"></div>
                        </label>
                      </div>

                      {/* Checkbox 3: Trading Ban Enabled */}
                      <div className="flex flex-col bg-neutral-950/40 border border-neutral-850 p-3 rounded-xl hover:border-neutral-800 transition space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="pr-2">
                            <span className="font-bold text-white block">Belirli Saatlerde İşlem Yasağı</span>
                            <span className="text-[10px] text-neutral-500 block mt-0.5">Aşağıda belirlenen saat aralığında işlem açılmasını durdurur.</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                            <input 
                              type="checkbox" 
                              checked={restrictions.trading_ban_enabled} 
                              onChange={() => toggleRestriction('trading_ban_enabled')}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-400 after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-650 peer-checked:after:bg-white"></div>
                          </label>
                        </div>
                        
                        {restrictions.trading_ban_enabled && (
                          <div className="flex items-center gap-3 pt-2 border-t border-neutral-850/60">
                            <div className="flex-1">
                              <label className="text-[10px] text-neutral-500 block mb-1">Başlangıç (TRT)</label>
                              <input 
                                type="text" 
                                placeholder="Örn: 22:00" 
                                value={restrictions.trading_ban_start}
                                onChange={(e) => setRestrictions({ ...restrictions, trading_ban_start: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2 text-center text-white focus:outline-none focus:border-purple-600 font-mono text-xs"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] text-neutral-500 block mb-1">Bitiş (TRT)</label>
                              <input 
                                type="text" 
                                placeholder="Örn: 08:00" 
                                value={restrictions.trading_ban_end}
                                onChange={(e) => setRestrictions({ ...restrictions, trading_ban_end: e.target.value })}
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2 text-center text-white focus:outline-none focus:border-purple-600 font-mono text-xs"
                              />
                            </div>
                            <div className="self-end pb-0.5">
                              <button 
                                onClick={() => saveRestrictions()}
                                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition duration-200 text-xs"
                              >
                                Kaydet
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Center Column - Positions & Signals (Width: 42%) */}
                <div className="xl:col-span-5 space-y-6">
                  {/* Open Positions Widget */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Zap size={16} className="text-emerald-400" />
                        Açık Pozisyonlar ({filteredCurrentTrades.filter(t => t.status === 'open').length})
                      </span>
                    </h4>
                    
                    {filteredCurrentTrades.filter(t => t.status === 'open').length === 0 ? (
                      <div className="text-center py-8 bg-neutral-950/20 border border-neutral-850 rounded-xl">
                        <p className="text-xs text-neutral-500">Aktif açık pozisyon bulunmamaktadır.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                        {filteredCurrentTrades.filter(t => t.status === 'open').map((trade) => {
                          const sig = signals.find(s => s.symbol === trade.symbol && s.direction === trade.direction && s.status === 'active');
                          const livePrice = trade.current_price ?? sig?.polymarket_price ?? trade.entry_price;
                          const currentValue = trade.shares * livePrice;
                          const uPnL = currentValue - trade.size_usd;
                          
                          return (
                            <div key={trade.id} className="bg-neutral-950/50 border border-neutral-850 rounded-xl p-3 flex flex-col justify-between hover:border-neutral-800 transition">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white text-sm">{trade.symbol}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                    trade.direction.includes('UP')
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  }`}>
                                    {trade.direction}
                                  </span>
                                </div>
                                <span className="text-[10px] text-neutral-500 font-mono">{formatDate(trade.created_at)}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-[10px] border-b border-neutral-850 pb-2 mb-2">
                                <div>
                                  <span className="text-neutral-500 block">Giriş Fiyatı:</span>
                                  <span className="font-mono text-neutral-300">${trade.entry_price.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">Yatırım:</span>
                                  <span className="font-mono text-neutral-300">${trade.size_usd.toFixed(1)}</span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 block">Kâr/Zarar:</span>
                                  <span className={`font-mono font-bold ${uPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {uPnL >= 0 ? '+' : ''}${uPnL.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={() => closeTrade(trade.id, trade.symbol)}
                                disabled={closingTradeId === trade.id}
                                className="w-full py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-350 border border-rose-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider transition duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                              >
                                {closingTradeId === trade.id ? (
                                  <><Loader2 size={10} className="animate-spin" /> Satılıyor...</>
                                ) : (
                                  <><XCircle size={10} /> Pozisyonu Kapat</>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Active Signals Widget */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <Sparkles size={16} className="text-purple-400 animate-pulse" />
                      Aktif Sinyaller ({filteredSignals.length})
                    </h4>
                    
                    {filteredSignals.length === 0 ? (
                      <div className="text-center py-8 bg-neutral-950/20 border border-neutral-850 rounded-xl">
                        <p className="text-xs text-neutral-500">Aktif sinyal bulunmamaktadır.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
                        {filteredSignals.map((sig) => (
                          <div key={sig.id} className="bg-neutral-950/50 border border-neutral-850 rounded-xl p-3 hover:border-neutral-800 transition">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-sm">{sig.symbol}</span>
                                {getDirectionBadge(sig.direction)}
                              </div>
                              <span className="text-[10px] text-emerald-400 font-extrabold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                +{sig.edge_pct ? Math.round(sig.edge_pct * 100) : 0}% Fark
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
                              <div>
                                <span className="text-neutral-500">Quant Olasılık:</span>
                                <span className="font-bold text-purple-400 ml-1">{sig.quant_probability ? Math.round(sig.quant_probability * 100) : 0}%</span>
                              </div>
                              <div>
                                <span className="text-neutral-500">Polymarket Fiyat:</span>
                                <span className="font-bold text-sky-400 ml-1">{sig.polymarket_price ? Math.round(sig.polymarket_price * 100) : 0}¢</span>
                              </div>
                            </div>
                            {sig.polymarket_slug && (
                              <a
                                href={`https://polymarket.com/event/${sig.polymarket_slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 font-semibold"
                              >
                                Polymarket'te Gör
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column - Logs & History (Width: 23%) */}
                <div className="xl:col-span-3 space-y-6">
                  {/* Agent Logs Widget */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Brain size={16} className="text-indigo-400" />
                        Ajan Günlüğü (Canlı)
                      </span>
                    </h4>
                    <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2.5 scrollbar-thin text-[11px] text-neutral-300">
                      {filteredLogs.length === 0 ? (
                        <p className="text-xs text-neutral-500 text-center py-4">Günlük kaydı bulunmuyor.</p>
                      ) : (
                        filteredLogs.slice(0, 8).map((log) => (
                          <div key={log.id} className="bg-neutral-950/40 border border-neutral-850 rounded-xl p-2.5 hover:border-neutral-800 transition">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                                log.log_type === 'Tuning'
                                  ? 'bg-purple-500/10 text-purple-400'
                                  : 'bg-emerald-500/10 text-emerald-400'
                              }`}>
                                {log.log_type}
                              </span>
                              <span className="text-[8px] text-neutral-500 font-mono">{formatDate(log.created_at)}</span>
                            </div>
                            <p className="font-semibold text-neutral-200 truncate text-[10px]">{log.summary}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* History Widget */}
                  <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm relative">
                    <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                      <History size={16} className="text-amber-400" />
                      Sonuçlanan İşlemler
                    </h4>
                    <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 scrollbar-thin text-xs">
                      {filteredCurrentTrades.filter(t => t.status !== 'open').length === 0 ? (
                        <p className="text-xs text-neutral-500 text-center py-4">Sonuçlanan işlem bulunmamaktadır.</p>
                      ) : (
                        filteredCurrentTrades.filter(t => t.status !== 'open').slice(0, 5).map((trade, idx) => (
                          <div key={idx} className="bg-neutral-950/40 border border-neutral-850 rounded-xl p-2.5 flex justify-between items-center hover:border-neutral-800 transition">
                            <div>
                              <span className="font-bold text-white block">{trade.symbol}</span>
                              <span className={`text-[8px] font-bold uppercase ${trade.status === 'won' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {trade.status === 'won' ? 'Kazandı' : 'Kaybetti'}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className={`font-mono font-bold block ${trade.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {trade.profit >= 0 ? '+' : ''}${trade.profit.toFixed(2)}
                              </span>
                              <span className="text-[8px] text-neutral-500 font-mono">{formatDate(trade.resolved_at || trade.created_at)}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                
                {/* Close Result Toast */}
                {closeResult && (
                  <div className={`p-4 rounded-xl border text-sm flex items-center gap-3 animate-fade-in ${
                    closeResult.startsWith('Hata') 
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  }`}>
                    <Info size={16} />
                    <span>{closeResult}</span>
                  </div>
                )}

                {/* View Selector */}
                <div className="flex justify-between items-center bg-neutral-900/60 p-4 border border-neutral-800 rounded-2xl">
                  <div className="text-left">
                    <h4 className="text-sm font-bold text-white">Portföy Modu Seçimi</h4>
                    <p className="text-xs text-neutral-400">Görüntülenen cüzdan verilerini ve işlem geçmişini seçin.</p>
                  </div>
                  <div className="flex p-1 bg-neutral-950 border border-neutral-850 rounded-xl">
                    <button
                      onClick={() => setPortfolioView('virtual')}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition ${
                        portfolioView === 'virtual'
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      Sanal (Paper)
                    </button>
                    <button
                      onClick={() => setPortfolioView('real')}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition flex items-center gap-1.5 ${
                        portfolioView === 'real'
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                      Gerçek (Real)
                    </button>
                  </div>
                </div>

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
                    Açık Pozisyonlar ({filteredCurrentTrades.filter(t => t.status === 'open').length})
                  </h3>

                  {filteredCurrentTrades.filter(t => t.status === 'open').length === 0 ? (
                    <p className="text-sm text-neutral-500 py-6 text-center">Aktif açık pozisyon bulunmamaktadır.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredCurrentTrades.filter(t => t.status === 'open').map((trade) => {
                        const sig = signals.find(s => s.symbol === trade.symbol && s.direction === trade.direction && s.status === 'active');
                        const livePrice = trade.current_price ?? sig?.polymarket_price ?? trade.entry_price;
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
                            {/* Close Position Button */}
                            <button
                              onClick={() => closeTrade(trade.id, trade.symbol)}
                              disabled={closingTradeId === trade.id}
                              className="mt-3 w-full py-2 px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 hover:border-rose-500/40 rounded-lg text-xs font-semibold uppercase tracking-wider transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {closingTradeId === trade.id ? (
                                <><Loader2 size={13} className="animate-spin" /> Satılıyor...</>
                              ) : (
                                <><XCircle size={13} /> Pozisyonu Kapat</>
                              )}
                            </button>
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
                      Sonuçlanan İşlemler ({filteredCurrentTrades.filter(t => t.status !== 'open').length})
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
                        {filteredCurrentTrades.filter(t => t.status !== 'open').length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 px-6 text-center text-neutral-500">
                              Sonuçlanan işlem geçmişi bulunmamaktadır.
                            </td>
                          </tr>
                        ) : (
                          filteredCurrentTrades.filter(t => t.status !== 'open').map((trade, idx) => (
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

            {/* Tab: Chat & Diary */}
            {activeTab === 'chat' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch animate-fade-in text-left">
                {/* Left Column - Chat Interface (8 Cols) */}
                <div className="lg:col-span-8 flex flex-col bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm h-[650px] relative">
                  <div className="flex items-center justify-between mb-4 border-b border-neutral-800/80 pb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Brain size={18} className="text-purple-400 animate-pulse" />
                      Ajan Yapay Zekası ile Sohbet
                    </h4>
                    <span className="bg-purple-500/10 text-purple-400 border border-purple-500/35 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase">
                      Groq Llama 3.3 Active
                    </span>
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto pr-1 mb-4 space-y-4 scrollbar-thin scroll-smooth">
                    {chatMessages.map((msg) => {
                      const isAgent = msg.sender === 'agent';
                      return (
                        <div
                          key={msg.id}
                          className={`flex items-start gap-3 max-w-[85%] ${
                            isAgent ? 'mr-auto text-left' : 'ml-auto flex-row-reverse text-right'
                          }`}
                        >
                          <div className={`p-2 rounded-xl border flex items-center justify-center shrink-0 ${
                            isAgent 
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' 
                              : 'bg-neutral-800 text-neutral-300 border-neutral-700'
                          }`}>
                            {isAgent ? <Brain size={16} /> : <User size={16} />}
                          </div>
                          
                          <div className="flex flex-col gap-1">
                            <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed border ${
                              isAgent 
                                ? 'bg-neutral-950/60 text-neutral-200 border-neutral-850 rounded-tl-none' 
                                : 'bg-purple-600/90 text-white border-purple-500/30 rounded-tr-none shadow-[0_0_15px_rgba(139,92,246,0.1)]'
                            }`}>
                              {isAgent ? (
                                <div 
                                  className="whitespace-pre-wrap font-sans"
                                  dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }} 
                                />
                              ) : (
                                <span className="whitespace-pre-wrap">{msg.text}</span>
                              )}
                            </div>
                            <span className="text-[9px] text-neutral-550 font-mono mt-0.5 px-1">
                              {msg.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    
                    {/* Sending / Typing Indicator */}
                    {isSendingMessage && (
                      <div className="flex items-start gap-3 mr-auto text-left max-w-[85%]">
                        <div className="p-2 rounded-xl border bg-purple-500/10 text-purple-400 border-purple-500/30 shrink-0">
                          <Brain size={16} className="animate-spin" />
                        </div>
                        <div className="px-4 py-3 bg-neutral-950/60 border border-neutral-850 text-neutral-450 rounded-2xl rounded-tl-none flex items-center gap-1.5 text-xs font-medium">
                          <span>Ajan düşünüyor</span>
                          <span className="flex gap-0.5 items-center justify-center mt-1">
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                            <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                          </span>
                        </div>
                      </div>
                    )}
                    
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Suggestion Chips */}
                  <div className="flex flex-wrap gap-2 mb-3 mt-1 border-t border-neutral-800/40 pt-3">
                    {[
                      { label: "Şu an ne yapıyorsun?", q: "Şu an ne yapıyorsun? Hangi piyasaları izliyorsun?" },
                      { label: "Son işlemlerini anlat", q: "Son 15 işlemde ne yaptın? Detaylarını açıklar mısın?" },
                      { label: "Neden Altın (XAU) aldın?", q: "Portföyündeki XAU alımının sebebi nedir? Hangi kantitatif edge'i buldun?" },
                      { label: "Piyasa taraması yap", q: "Şu anki piyasa durumunu tara, arbitrage ve edge oranlarını bana anlat." }
                    ].map((chip, index) => (
                      <button
                        key={index}
                        onClick={() => sendChatMessage(chip.q)}
                        disabled={isSendingMessage}
                        className="px-3 py-1.5 bg-neutral-950/60 border border-neutral-850 hover:border-purple-500/40 text-[11px] text-neutral-450 hover:text-purple-300 rounded-lg transition duration-200 disabled:opacity-50"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>

                  {/* Message Input Box */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendChatMessage(currentMessage);
                    }}
                    className="flex gap-3 mt-auto"
                  >
                    <input
                      type="text"
                      placeholder="Ajana bir soru sor (ör. 'Neden altın aldın?', 'WTI işlem riskin nedir?')..."
                      value={currentMessage}
                      onChange={(e) => setCurrentMessage(e.target.value)}
                      disabled={isSendingMessage}
                      className="flex-1 bg-neutral-950 border border-neutral-850 focus:border-neutral-700 rounded-xl py-3 px-4 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition disabled:opacity-70"
                    />
                    <button
                      type="submit"
                      disabled={!currentMessage.trim() || isSendingMessage}
                      className="px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-purple-500/10 border border-purple-500/20 transition duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </div>

                {/* Right Column - Narrative Diary (4 Cols) */}
                <div className="lg:col-span-4 flex flex-col bg-neutral-900/40 border border-neutral-800 rounded-2xl p-5 backdrop-blur-sm h-[650px]">
                  <div className="flex items-center justify-between mb-4 border-b border-neutral-800/80 pb-3">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <BookOpen size={16} className="text-indigo-400" />
                      Ajanın Günlüğü (Otonom)
                    </h4>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      Canlı Yayın
                    </span>
                  </div>

                  {/* Diary Cards Area */}
                  <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin">
                    {generateDiaryEntries().length === 0 ? (
                      <div className="text-center py-10 bg-neutral-950/20 border border-neutral-850 rounded-xl">
                        <p className="text-xs text-neutral-500">Günlük kaydı oluşturulabilecek veri bulunmuyor.</p>
                      </div>
                    ) : (
                      generateDiaryEntries().map((entry) => {
                        let badgeStyle = "bg-neutral-800 text-neutral-450 border-neutral-750";
                        if (entry.type === 'trade-open') badgeStyle = "bg-purple-500/10 text-purple-400 border-purple-500/20";
                        else if (entry.type === 'trade-won') badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                        else if (entry.type === 'trade-lost') badgeStyle = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                        else if (entry.type === 'log-tuning') badgeStyle = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                        else if (entry.type === 'log-decision') badgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/20";

                        return (
                          <div 
                            key={entry.id} 
                            className="bg-neutral-950/40 border border-neutral-850 rounded-xl p-3.5 hover:border-neutral-800 transition flex flex-col gap-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${badgeStyle}`}>
                                {entry.type.replace('trade-', 'Pozisyon ').replace('log-', 'Ajan ').replace('-open', ' Açılış').replace('-won', ' Kazanç').replace('-lost', ' Kayıp').replace('-tuning', ' Optimizasyon').replace('-decision', ' Karar').replace('-info', ' Bilgi')}
                              </span>
                              <span className="text-[9px] text-neutral-550 font-mono">
                                {formatDate(entry.rawDate)}
                              </span>
                            </div>
                            <div>
                              <h5 className="font-bold text-white text-xs mb-1 leading-snug">{entry.title}</h5>
                              <p className="text-neutral-350 text-[11px] leading-relaxed whitespace-pre-wrap">{entry.content}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
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
