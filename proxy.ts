import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isProWorkbenchEnabled } from '@/lib/config/feature-flags';
import {
  isTrustedLoopbackRequestHost,
  isTrustedLoopbackRequestOrigin,
} from '@/lib/server/loopback-request-origin';
import { verifyAccessTokenEdge } from '@/lib/server/access-token-edge';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // This Bot server is a loopback-only desktop service. Never let an arbitrary
  // Host header reach a local API, even when ACCESS_CODE is not configured.
  if (pathname.startsWith('/api/')) {
    if (!isTrustedLoopbackRequestHost(request)) {
      return NextResponse.json({ error: '不接受此本机服务地址。' }, { status: 403 });
    }

    // State-changing API calls need a same-origin signal tied to this validated
    // loopback Host. Embedded Chromium may omit Origin, so the shared check
    // requires a matching Referer or same-origin Fetch Metadata in that case.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      if (!isTrustedLoopbackRequestOrigin(request)) {
        return NextResponse.json({ error: '不接受跨来源的本机请求。' }, { status: 403 });
      }
    }
  }

  // Proxy runs in Node in Next 16, so the workbench gate can inspect the same
  // server-side runtime configuration as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.next();
  }

  // Whitelist: access-code endpoints, health check
  if (
    pathname.startsWith('/api/access-code/') ||
    pathname === '/api/health' ||
    pathname === '/api/bot/health' ||
    pathname === '/api/health/live'
  ) {
    return NextResponse.next();
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyAccessTokenEdge(cookie.value, accessCode))) {
    return NextResponse.next();
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};
