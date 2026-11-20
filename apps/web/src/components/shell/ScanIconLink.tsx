import Link from 'next/link';

/** Navbar shortcut to the asset and stock scan lookup. */
export function ScanIconLink({ className = 'text-white/90 hover:bg-white/10' }: { className?: string }) {
  return (
    <Link
      href="/inventory/scan"
      title="Scan lookup"
      aria-label="Scan lookup"
      className={`flex h-8 w-8 shrink-0 items-center justify-center ${className}`}
      data-testid="nav-scan"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M7 12h10" />
        <path d="M9 9v6M12 9v6M15 9v6" />
      </svg>
    </Link>
  );
}
