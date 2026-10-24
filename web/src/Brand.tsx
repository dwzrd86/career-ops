export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`meritwake-brand${compact ? " compact" : ""}`}>
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 26V9l8 9L20 5v21M20 16l9-13v23" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
    <span>meritwake</span>
  </span>;
}
