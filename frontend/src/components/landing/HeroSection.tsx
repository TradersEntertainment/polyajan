import { useState, useEffect } from 'react';
import { useTypewriter } from '../../hooks/useTypewriter';
import ParticleBackground from './ParticleBackground';
import PolyQuantEmblem from '../PolyQuantEmblem';
import {
  Brain,
  TrendingUp,
  Zap,
  BarChart3,
  ArrowRight,
  Sparkles,
  Shield,
  Activity
} from 'lucide-react';

interface HeroSectionProps {
  onEnterDashboard: () => void;
  stats: {
    totalTrades: number;
    winRate: number;
    activeSignals: number;
    equity: number;
  };
}

export default function HeroSection({ onEnterDashboard, stats }: HeroSectionProps) {
  const { displayed, done } = useTypewriter(
    'AI destekli Polymarket tahmin algoritması.\nGerçek zamanlı sinyal üretimi. Otonom işlem.',
    30,
    800
  );
  const [pillsVisible, setPillsVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPillsVisible(true), 1400);
    const t2 = setTimeout(() => setStatsVisible(true), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Particle Animation Background */}
      <ParticleBackground />

      {/* Grid Overlay */}
      <div className="fixed inset-0 z-[1] grid-background animate-grid-pulse pointer-events-none" />

      {/* Top gradient overlay */}
      <div className="fixed inset-0 z-[2] hero-overlay pointer-events-none" />

      {/* Floating Navbar */}
      <nav className="relative z-10 w-full px-5 sm:px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PolyQuantEmblem size={40} hasLiveDot={true} />
          <span className="text-[21px] font-extrabold tracking-tight text-white" style={{ fontFamily: 'var(--font-heading)' }}>
            Poly AI Quant<sup className="text-[10px] text-purple-400 ml-0.5">®</sup>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="https://polymarket.com/@financebot"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm text-neutral-400 hover:text-white border border-white/10 hover:border-white/20 rounded-full transition-all duration-300"
          >
            <Activity size={14} />
            Polymarket Profili
          </a>
          <button
            onClick={onEnterDashboard}
            className="px-5 py-2.5 bg-white text-black text-sm font-semibold rounded-full hover:bg-neutral-200 transition-colors duration-200 flex items-center gap-2"
          >
            Dashboard
            <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      {/* Hero Content */}
      <div className="relative z-10 flex-1 flex flex-col justify-center px-5 sm:px-8 max-w-5xl mx-auto w-full pb-32">
        {/* Badge */}
        <div className="animate-fade-in-up mb-6">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-purple-500/10 border border-purple-500/25 rounded-full text-purple-300 text-xs font-semibold uppercase tracking-wider">
            <Sparkles size={12} className="animate-pulse" />
            Autonomous Trading Agent v1.0
          </span>
        </div>

        {/* Typewriter Headline */}
        <div className="mb-8">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight text-white min-h-[140px] sm:min-h-[160px]">
            {displayed.split('\n').map((line, i) => (
              <span key={i}>
                {line}
                {i < displayed.split('\n').length - 1 && <br />}
              </span>
            ))}
            {!done && (
              <span className="inline-block w-[3px] h-[1.1em] bg-purple-400 align-middle ml-[2px] animate-cursor-blink" />
            )}
          </h1>
        </div>

        {/* Action Pills */}
        <div
          className={`flex flex-wrap gap-y-2 gap-x-2 transition-all duration-500 ${
            pillsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
          }`}
        >
          {/* White pills */}
          {[
            { label: "Dashboard'a Git", icon: <BarChart3 size={13} />, action: onEnterDashboard },
            { label: 'Ajanla Sohbet', icon: <Brain size={13} />, action: onEnterDashboard },
            { label: 'Portföyü Gör', icon: <TrendingUp size={13} />, action: onEnterDashboard },
            { label: 'Nasıl Çalışır?', icon: <Shield size={13} />, action: undefined },
          ].map((pill, i) => (
            <button
              key={i}
              onClick={pill.action}
              className="inline-flex items-center gap-2 bg-white text-black border border-black/10 rounded-full text-[13px] sm:text-[14px] px-4 sm:px-5 py-[0.45em] font-medium hover:bg-black hover:text-white transition-colors duration-200 whitespace-nowrap"
            >
              {pill.icon}
              {pill.label}
            </button>
          ))}

          {/* Outline pill - email */}
          <button
            onClick={() => navigator.clipboard.writeText('hello@polyquant.ai')}
            className="inline-flex items-center gap-2 text-white bg-transparent border border-white/30 rounded-full text-[13px] sm:text-[14px] px-4 sm:px-5 py-[0.45em] font-medium hover:bg-white hover:text-black transition-colors duration-200 whitespace-nowrap"
          >
            İletişim: <span className="underline underline-offset-2">hello@polyquant.ai</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom Stats Bar */}
      <div
        className={`relative z-10 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl transition-all duration-700 ${
          statsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {[
            { label: 'Toplam İşlem', value: stats.totalTrades.toString(), icon: <Zap size={16} className="text-purple-400" /> },
            { label: 'Başarı Oranı', value: `%${stats.winRate}`, icon: <TrendingUp size={16} className="text-emerald-400" /> },
            { label: 'Aktif Sinyal', value: stats.activeSignals.toString(), icon: <Sparkles size={16} className="text-amber-400" /> },
            { label: 'Net Varlık', value: `$${stats.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, icon: <BarChart3 size={16} className="text-sky-400" /> },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="p-2 bg-white/5 rounded-xl border border-white/[0.06]">
                {stat.icon}
              </div>
              <div>
                <div className="text-lg sm:text-xl font-bold text-white tracking-tight font-mono">{stat.value}</div>
                <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-medium">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
