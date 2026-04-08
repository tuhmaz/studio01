import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'https://mbj.news',
  'http://localhost:3000',
  'http://localhost:9002',
  'http://192.168.2.48:9002',
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin') ?? '';

  // Only apply CORS to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const isAllowed = ALLOWED_ORIGINS.includes(origin) || !origin;

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  isAllowed ? origin : 'https://mbj.news',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const res = NextResponse.next();

  if (isAllowed && origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  return res;
}

export const config = {
  matcher: '/api/:path*',
};
