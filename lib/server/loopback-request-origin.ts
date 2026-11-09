const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost']);

function parseLoopbackRequestOrigin(request: Request): URL | null {
  const hostHeader = request.headers.get('host');
  if (!hostHeader || hostHeader.length > 260 || /[\\/?#@]/.test(hostHeader)) return null;

  try {
    const requestUrl = new URL(request.url);
    const hostUrl = new URL(`${requestUrl.protocol}//${hostHeader}`);
    const hostname = hostUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    if (
      !LOOPBACK_HOSTNAMES.has(hostname) ||
      hostUrl.username ||
      hostUrl.password ||
      hostUrl.pathname !== '/'
    ) {
      return null;
    }

    // Build the browser-visible origin from the validated Host header instead
    // of Next's reconstructed URL host, which can differ in desktop launches.
    return new URL(`${requestUrl.protocol}//${hostUrl.host}`);
  } catch {
    return null;
  }
}

export function isTrustedLoopbackRequestHost(request: Request): boolean {
  return parseLoopbackRequestOrigin(request) !== null;
}

/**
 * Accept same-origin writes to the loopback app while accounting for missing
 * Origin headers in embedded Chromium requests. A missing Origin must still
 * carry either a matching Referer or browser Fetch Metadata proving same-origin.
 */
export function isTrustedLoopbackRequestOrigin(request: Request): boolean {
  const expectedOrigin = parseLoopbackRequestOrigin(request);
  if (!expectedOrigin) return false;

  const originHeader = request.headers.get('origin');
  if (originHeader !== null) {
    try {
      return new URL(originHeader).origin === expectedOrigin.origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin.origin;
    } catch {
      return false;
    }
  }

  return request.headers.get('sec-fetch-site')?.toLowerCase() === 'same-origin';
}
