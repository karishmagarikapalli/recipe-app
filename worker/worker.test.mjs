import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://karishmagarikapalli.github.io';

test('rejects requests from origins other than the configured Pages site', async () => {
  let upstreamCalled = false;
  const response = await worker.fetch(new Request('https://proxy.example/fdc/v1/foods/search', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'oats' }),
  }), {
    USDA_API_KEY: 'test-secret',
    ALLOWED_ORIGIN: origin,
    fetch: async () => { upstreamCalled = true; },
  });

  assert.equal(response.status, 403);
  assert.equal(upstreamCalled, false);
});

test('validates search input before calling USDA', async () => {
  const response = await worker.fetch(new Request('https://proxy.example/fdc/v1/foods/search', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '' }),
  }), { USDA_API_KEY: 'test-secret', ALLOWED_ORIGIN: origin });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /query is required/i);
});

test('forwards a constrained search with the server key and never returns the key', async () => {
  let upstreamUrl;
  let upstreamBody;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
      upstreamUrl = new URL(url);
      upstreamBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ foods: [{ fdcId: 123, description: 'Oats' }] }), {
        headers: { 'Content-Type': 'application/json' },
      });
  };
  let response;
  try {
    response = await worker.fetch(new Request('https://proxy.example/fdc/v1/foods/search', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'rolled oats', pageSize: 99, dataType: ['Foundation', 'invalid'] }),
    }), { USDA_API_KEY: 'test-secret-value', ALLOWED_ORIGIN: origin });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const responseBody = await response.text();
  assert.equal(response.status, 200);
  assert.equal(upstreamUrl.searchParams.get('api_key'), 'test-secret-value');
  assert.deepEqual(upstreamBody.dataType, ['Foundation']);
  assert.equal(upstreamBody.pageSize, 8);
  assert.equal(responseBody.includes('test-secret-value'), false);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});