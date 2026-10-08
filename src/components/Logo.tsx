/** FABLE monogram: a square F whose arms are pages lifting off a spine — an open page. No circle, no border. */
export function Monogram({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M8 4h3.6v24H8z" fill="currentColor" />
      <path d="M11.6 4H25l-2.2 2.6c-.5.6-1.2.9-2 .9H11.6z" fill="currentColor" />
      <path d="M11.6 4.2c3.6 0 6.9 1.1 9.4 3.3H11.6z" fill="#6547E8" />
      <path d="M11.6 13.4h9.3l-1.9 2.3c-.4.5-1 .8-1.7.8h-5.7z" fill="currentColor" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <Monogram />
      <span className="display text-[1.45rem] leading-none tracking-tight">FABLE</span>
    </span>
  );
}
