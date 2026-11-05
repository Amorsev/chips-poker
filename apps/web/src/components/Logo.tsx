export function ChipMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="chip-mark" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="#12372c" stroke="#f2cd7a" strokeWidth="2.5" />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#2a8f6f" strokeWidth="6" strokeDasharray="7 7" />
      <path
        d="M32 16.5l4.9 10 11 1.6-8 7.8 1.9 11-9.8-5.2-9.8 5.2 1.9-11-8-7.8 11-1.6z"
        fill="#f2cd7a"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <ChipMark />
      <span className="logo-text">
        CHIPS<span>POKER</span>
      </span>
    </span>
  );
}
