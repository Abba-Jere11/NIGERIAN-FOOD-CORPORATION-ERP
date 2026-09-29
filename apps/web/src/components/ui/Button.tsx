import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from '@/lib/cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-700 text-white border border-accent-800 hover:bg-accent-800 disabled:bg-ink-300 disabled:border-ink-300',
  secondary:
    'bg-surface text-ink-900 border border-ink-300 hover:bg-ink-100 disabled:text-ink-400 disabled:bg-surface-muted',
  danger:
    'bg-danger-600 text-white border border-danger-700 hover:bg-danger-700 disabled:bg-ink-300 disabled:border-ink-300',
  subtle:
    'bg-transparent text-ink-700 border border-transparent hover:bg-ink-100 disabled:text-ink-400',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
};

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return cx(
    'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium',
    'transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
