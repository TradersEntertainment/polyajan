interface PolyQuantEmblemProps {
  size?: number;
  className?: string;
  hasLiveDot?: boolean;
}

export default function PolyQuantEmblem({ size = 42, className = "", hasLiveDot = true }: PolyQuantEmblemProps) {
  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="filter drop-shadow-[0_0_12px_rgba(139,92,246,0.6)]"
      >
        <defs>
          <linearGradient id="emblemGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="50%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <linearGradient id="coreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        
        {/* Outer rotating decagon wireframe */}
        <g className="origin-center animate-[spin_25s_linear_infinite]">
          <polygon
            points="50,5 79,15 95,41 90,70 68,91 32,91 10,70 5,41 21,15"
            fill="none"
            stroke="url(#emblemGrad)"
            strokeWidth="1.5"
            strokeOpacity="0.4"
          />
          <polygon
            points="50,12 73,20 86,41 82,63 64,80 36,80 18,63 14,41 27,20"
            fill="none"
            stroke="url(#emblemGrad)"
            strokeWidth="1"
            strokeOpacity="0.2"
          />
        </g>
        
        {/* Primary active outer polygon */}
        <polygon
          points="50,8 86,29 86,71 50,92 14,71 14,29"
          fill="rgba(12,10,24,0.75)"
          stroke="url(#emblemGrad)"
          strokeWidth="3.5"
          strokeLinejoin="round"
          className="origin-center animate-[pulse_4s_ease-in-out_infinite]"
        />

        {/* Neural Network Nodes and Connections */}
        <g stroke="rgba(255,255,255,0.18)" strokeWidth="1">
          <line x1="50" y1="8" x2="50" y2="92" />
          <line x1="14" y1="29" x2="86" y2="71" />
          <line x1="14" y1="71" x2="86" y2="29" />
          <line x1="50" y1="30" x2="14" y2="50" />
          <line x1="14" y1="50" x2="50" y2="70" />
          <line x1="50" y1="70" x2="86" y2="50" />
          <line x1="86" y1="50" x2="50" y2="30" />
          <line x1="50" y1="30" x2="50" y2="70" />
        </g>

        {/* Outer glowing vertices */}
        <circle cx="50" cy="8" r="4.5" fill="#f472b6" className="animate-pulse" />
        <circle cx="86" cy="29" r="4" fill="#a78bfa" />
        <circle cx="86" cy="71" r="4" fill="#818cf8" />
        <circle cx="50" cy="92" r="4.5" fill="#4f46e5" className="animate-pulse" />
        <circle cx="14" cy="71" r="4" fill="#818cf8" />
        <circle cx="14" cy="29" r="4" fill="#a78bfa" />

        {/* Inner network hubs */}
        <circle cx="50" cy="30" r="3" fill="#ffffff" />
        <circle cx="14" cy="50" r="3" fill="#ffffff" />
        <circle cx="50" cy="70" r="3" fill="#ffffff" />
        <circle cx="86" cy="50" r="3" fill="#ffffff" />

        {/* Glowing Pulsing Core */}
        <circle cx="50" cy="50" r="14" fill="url(#coreGrad)" className="animate-ping opacity-25 origin-center [animation-duration:2s]" />
        <circle cx="50" cy="50" r="10" fill="url(#coreGrad)" className="filter drop-shadow-[0_0_6px_rgba(244,114,182,0.8)]" />
        
        {/* Core Detail: Small bright diamond */}
        <polygon points="50,44 56,50 50,56 44,50" fill="#ffffff" className="animate-pulse" />
      </svg>
      {/* Absolute Live indicator */}
      {hasLiveDot && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[var(--bg-primary)] animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
      )}
    </div>
  );
}
