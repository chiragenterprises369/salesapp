import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname = request.headers.get('host') || '';
  const pathname = url.pathname;

  // Don't rewrite internal Next.js assets, api, or static files with extension
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Super Admin subdomain: superadmin.tootodo.com or superadmin.localhost
  if (hostname.startsWith('superadmin.')) {
    if (pathname === '/') {
      url.pathname = '/super-admin';
      return NextResponse.rewrite(url);
    }
    if (pathname === '/login') {
      url.pathname = '/super-admin/login';
      return NextResponse.rewrite(url);
    }
    if (!pathname.startsWith('/super-admin')) {
      url.pathname = `/super-admin${pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Admin / Company App subdomain: admin.tootodo.com, app.tootodo.com
  if (hostname.startsWith('admin.') || hostname.startsWith('app.')) {
    if (pathname === '/') {
      url.pathname = '/app';
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
