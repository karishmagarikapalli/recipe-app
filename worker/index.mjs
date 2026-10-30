const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const MAX_BODY_BYTES = 16_384;
const ALLOWED_DATA_TYPES = new Set(['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded']);

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  });
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const configuredOrigin = env.ALLOWED_ORIGIN;
    const requestOrigin = request.headers.get('Origin');
    if (!configuredOrigin || !requestOrigin || requestOrigin !== configuredOrigin) {
      return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const headers = {
      'Access-Control-Allow-Origin': configuredOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST' || requestUrl.pathname !== '/fdc/v1/foods/search') {
      return jsonResponse({ error: 'Not found' }, 404, configuredOrigin);
    }
    if (!env.USDA_API_KEY) return jsonResponse({ error: 'USDA search is not configured.' }, 503, configuredOrigin);

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonResponse({ error: 'Search request is too large.' }, 413, configuredOrigin);

    let payload;
    try {
      const body = await request.text();
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Search request is too large.' }, 413, configuredOrigin);
      }
      payload = JSON.parse(body);
    } catch {
      return jsonResponse({ error: 'Search request must be valid JSON.' }, 400, configuredOrigin);
    }

    const query = typeof payload.query === 'string' ? payload.query.trim().slice(0, 200) : '';
    if (!query) return jsonResponse({ error: 'A food search query is required.' }, 400, configuredOrigin);
    const pageSize = Math.min(8, Math.max(1, Number(payload.pageSize) || 8));
    const dataType = Array.isArray(payload.dataType)
      ? payload.dataType.filter((value) => ALLOWED_DATA_TYPES.has(value))
      : [];

    const upstreamUrl = new URL(USDA_SEARCH_URL);
    upstreamUrl.searchParams.set('api_key', env.USDA_API_KEY);
    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, pageSize, dataType }),
      });
      if (!upstream.ok) {
        return jsonResponse({ error: upstream.status === 429 ? 'USDA rate limit reached. Retry later.' : 'USDA search is temporarily unavailable.' }, 502, configuredOrigin);
      }
      return new Response(await upstream.text(), {
        status: 200,
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return jsonResponse({ error: 'Could not reach USDA FoodData Central.' }, 502, configuredOrigin);
    }
  },
};