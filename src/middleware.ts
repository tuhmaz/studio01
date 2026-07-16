import { NextRequest, NextResponse } from 'next/server';

function getAllowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map(o => o.trim())
    .filter(Boolean) ?? [];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL;
  const devOrigins = process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:9002'];

  return Array.from(new Set([
    ...configured,
    ...(appUrl ? [appUrl] : []),
    ...devOrigins,
  ]));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin') ?? '';

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const allowedOrigins = getAllowedOrigins();
  const isAllowed = !origin || allowedOrigins.includes(origin);

  if (req.method === 'OPTIONS') {
    if (!isAllowed) {
      return new NextResponse(null, { status: 403 });
    }

    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Health-Secret',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      },
    });
  }

  const res = NextResponse.next();

  if (isAllowed && origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Health-Secret');
    res.headers.set('Vary', 'Origin');
  }

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-Frame-Options', 'DENY');

  return res;
}

export const config = {
  matcher: '/api/:path*',
};
