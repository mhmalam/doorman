// Minimal inline SVG set matching Asana's line-icon style.

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function CheckCircle({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="10" cy="10" r="8.5" />
      <path d="M6.5 10.5l2.3 2.3L13.5 8" />
    </svg>
  );
}

export function Caret({ open, size = 12, className = '' }: { open: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className={className}
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}
    >
      <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDown({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" className={className} {...base}>
      <path d="M2 4l4 4 4-4" />
    </svg>
  );
}

export function Star({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.7.9 5.2L10 14.5 5.4 17l.9-5.2L2.5 8.1l5.2-.7z" />
    </svg>
  );
}

export function Search({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5L18 18" />
    </svg>
  );
}

export function FilterLines({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M3 5h14M6 10h8M8.5 15h3" />
    </svg>
  );
}

export function SortArrows({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} {...base}>
      <path d="M7 4v12M7 4L4.5 6.5M7 4l2.5 2.5M13 16V4M13 16l-2.5-2.5M13 16l2.5-2.5" />
    </svg>
  );
}

export function UserCircle({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5">
      <circle cx="12" cy="12" r="10.5" />
      <circle cx="12" cy="9.5" r="3" strokeDasharray="none" />
      <path d="M6 19c1.2-2.6 3.4-4 6-4s4.8 1.4 6 4" strokeDasharray="none" fill="none" />
    </svg>
  );
}

export function CalendarIcon({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5">
      <circle cx="12" cy="12" r="10.5" />
      <rect x="7.5" y="8" width="9" height="8.5" rx="1.5" strokeDasharray="none" />
      <path d="M7.5 11h9M10 8V6.8M14 8V6.8" strokeDasharray="none" />
    </svg>
  );
}

export function Warning({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className}>
      <path d="M8 1.5L15 14H1z" fill="var(--warn)" />
      <path d="M8 6v4M8 11.5v.8" stroke="#1e1f21" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function XIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={className} {...base}>
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

export function Grip({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className={className} fill="currentColor">
      <circle cx="5" cy="3" r="1.1" /><circle cx="9" cy="3" r="1.1" />
      <circle cx="5" cy="7" r="1.1" /><circle cx="9" cy="7" r="1.1" />
      <circle cx="5" cy="11" r="1.1" /><circle cx="9" cy="11" r="1.1" />
    </svg>
  );
}

export function ListGlyph({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 6h1M8 6h8M4 10h1M8 10h8M4 14h1M8 14h8" />
    </svg>
  );
}
