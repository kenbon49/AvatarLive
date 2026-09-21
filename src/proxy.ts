import { NextRequest, NextResponse } from 'next/server';

const apiUpstream = (process.env.API_UPSTREAM || 'http://localhost:8000').replace(/\/$/, '');

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const protocol = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.slice(0, -1);
    const allowed = new Set([request.nextUrl.origin, new URL(request.url).origin, host ? `${protocol}://${host}` : '']);
    if (origin && !allowed.has(origin)) {
      return NextResponse.json({ detail: '跨站请求已拒绝' }, { status: 403 });
    }
  }
  if (path === '/login' || path === '/register' || path.startsWith('/api/v1/auth/')) {
    return NextResponse.next();
  }

  let user: { id?: string; role?: string } | null = null;
  try {
    const response = await fetch(`${apiUpstream}/api/v1/auth/me`, {
      headers: { cookie: request.headers.get('cookie') || '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) user = await response.json() as { id?: string; role?: string };
  } catch {
    // Fail closed while the session service is unavailable.
  }

  if (!user?.id) {
    if (path.startsWith('/api/') || path.includes('-api/') || path.startsWith('/rtc/')) {
      return NextResponse.json({ detail: '请先登录' }, { status: 401 });
    }
    const login = new URL('/login', request.url);
    login.searchParams.set('next', path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  if (path.startsWith('/admin') && user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }
  const headers = new Headers(request.headers);
  headers.set('x-synlive-user-id', user.id);
  headers.set('x-synlive-user-role', user.role || 'user');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/|assets/|favicon.ico|icon.svg).*)'],
};
