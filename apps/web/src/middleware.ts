import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@nfc/shared';

const PUBLIC_PREFIXES = ['/login', '/edms/login', '/_next', '/favicon', '/nfc-logo.png'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }
  // Public files under /public (logo, favicon, etc.) must not require a session.
  if (/\.(?:png|jpe?g|gif|svg|webp|ico|txt|xml|webmanifest)$/i.test(pathname)) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE) && !pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith('/edms') ? '/edms/login' : '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico)$).*)'],
};
