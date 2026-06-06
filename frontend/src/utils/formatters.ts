import type { VirtualTrade, AgentLog, DiaryEntry } from '../types';

// ─── Date Formatter ─────────────────────────────────────────────

export const formatDate = (isoString: string): string => {
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
  } catch {
    return isoString;
  }
};

// ─── Basic Markdown → HTML ──────────────────────────────────────

export const formatMarkdown = (text: string): string => {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li class="ml-4 list-disc text-neutral-300 my-1">$1</li>');
  html = html.replace(/```([^`]+)```/g, '<pre class="bg-neutral-950/80 p-3 rounded-lg border border-neutral-800 font-mono text-xs my-2 overflow-x-auto text-purple-300">$1</pre>');
  html = html.replace(/`([^`]+)`/g, '<code class="bg-neutral-800/80 px-1.5 py-0.5 rounded text-purple-400 font-mono text-xs font-semibold">$1</code>');
  html = html.replace(/\n/g, '<br/>');

  return html;
};

// ─── Diary Entry Generator ──────────────────────────────────────

export const generateDiaryEntries = (
  virtualTrades: VirtualTrade[],
  logs: AgentLog[]
): DiaryEntry[] => {
  const entries: DiaryEntry[] = [];

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
        date,
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
      type,
      title: `${titleEmoji} ${l.log_type}: ${l.summary}`,
      content: cleanDetails,
      date,
      rawDate: l.created_at
    });
  });

  return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
};

// ─── Number Formatting ──────────────────────────────────────────

export const formatCurrency = (value: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};
