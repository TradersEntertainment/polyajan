// ─── API & Domain Types ─────────────────────────────────────────

export interface Signal {
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

export interface Tuning {
  symbol: string;
  bet_type: string;
  lookback_days: number;
  minutes_left_threshold: number;
  min_expected_yield: number;
  updated_at: string;
}

export interface AgentLog {
  id: number;
  log_type: string; // 'Tuning', 'Decision', 'Info'
  summary: string;
  details: string;
  created_at: string;
}

export interface PortfolioDetails {
  balance: number;
  equity: number;
  open_positions_value: number;
}

export interface Portfolio {
  trading_mode: string;
  risk_profile: string; // 'CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'
  risk_justification: string;
  virtual: PortfolioDetails;
  real: PortfolioDetails;
  balance: number;
  equity: number;
  open_positions_value: number;
}

export interface VirtualTrade {
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

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export interface Restrictions {
  block_stocks_down: boolean;
  block_commodities_down: boolean;
  trading_ban_enabled: boolean;
  trading_ban_start: string;
  trading_ban_end: string;
}

export interface EquityPoint {
  equity: number;
  balance: number;
  recorded_at: string;
}

export interface DiaryEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  date: Date;
  rawDate: string;
}

// ─── Tab Types ──────────────────────────────────────────────────

export type TabKey = 'terminal' | 'signals' | 'tunings' | 'logs' | 'portfolio' | 'chat';

export type PortfolioView = 'virtual' | 'real';

// ─── View Types ─────────────────────────────────────────────────

export type AppView = 'landing' | 'dashboard';
