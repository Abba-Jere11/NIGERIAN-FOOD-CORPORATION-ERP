import { cx } from '@/lib/cx';

const SIZES = {
  sm: 36,
  md: 72,
  lg: 96,
} as const;

export function NfcLogo({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
  /** Accepted for call-site compatibility; unused with a plain public asset. */
  priority?: boolean;
}) {
  const px = SIZES[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset from /public
    <img
      src="/nfc-logo.png"
      alt="Nigeria Food Corporation Logo"
      width={px}
      height={px}
      className={cx('shrink-0 object-contain', className)}
    />
  );
}
