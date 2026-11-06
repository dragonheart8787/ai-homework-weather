/**
 * KUCGU CORS 代理（Cloudflare Worker，單一檔案，不需要 build）。
 *
 * 可以直接整份貼進 Cloudflare 網頁編輯器的 Edit code。
 *
 * 安全設計：
 * - 上游主機寫死，請求無法指定要轉發到哪裡。
 * - 只開放五組固定的 method 加路徑，其餘一律 404。
 * - 只接受白名單 Origin，其餘一律 403 且不轉發。
 * - 只轉發 Content-Type 與 X-API-Key 兩個 header，query string 與 body 原樣轉發。
 * - 不儲存、不記錄任何內容：這個檔案沒有任何 console 呼叫，也不使用 KV、Secret 或環境變數。
 */

const UPSTREAM = 'https://kucgu.replit.app';

const ALLOWED_ORIGINS = [
  'https://dragonheart8787.github.io',
  'http://localhost:8000'
];

// 路徑 -> 允許的 method
const ROUTES = Object.freeze({
  '/mission/hello': 'GET',
  '/mission/weather': 'GET',
  '/mission/bonus': 'GET',
  '/submit/weather': 'POST',
  '/submit/bonus': 'POST'
});

const FORWARD_HEADERS = ['content-type', 'x-api-key'];
const NULL_BODY_STATUSES = [101, 204, 205, 304];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(status, body, origin) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  if (origin) {
    const cors = corsHeaders(origin);
    Object.keys(cors).forEach((k) => headers.set(k, cors[k]));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function handle(request) {
  // 1. Origin 白名單。沒有 Origin 或不在名單內，一律 403，不轉發，也不加 CORS 標頭。
  const origin = request.headers.get('Origin');
  if (!origin || ALLOWED_ORIGINS.indexOf(origin) === -1) {
    return jsonResponse(403, { error: 'origin_not_allowed' }, null);
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const known = Object.prototype.hasOwnProperty.call(ROUTES, url.pathname);

  // 2. preflight
  if (method === 'OPTIONS') {
    if (!known) return jsonResponse(404, { error: 'not_found' }, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // 3. 路徑與 method 白名單
  if (!known || ROUTES[url.pathname] !== method) {
    return jsonResponse(404, { error: 'not_found' }, origin);
  }

  // 4. 組出上游請求：主機是常數，只帶入已驗證的路徑與原本的 query string
  const headers = new Headers();
  FORWARD_HEADERS.forEach((name) => {
    const v = request.headers.get(name);
    if (v !== null) headers.set(name, v);
  });

  try {
    const init = { method: method, headers: headers, redirect: 'manual' };
    if (method === 'POST') init.body = await request.arrayBuffer();
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, init);

    const out = new Headers(corsHeaders(origin));
    const type = upstream.headers.get('Content-Type');
    if (type) out.set('Content-Type', type);
    out.set('Cache-Control', 'no-store');

    const body = NULL_BODY_STATUSES.indexOf(upstream.status) === -1 ? await upstream.arrayBuffer() : null;
    return new Response(body, { status: upstream.status, headers: out });
  } catch (e) {
    return jsonResponse(502, { error: 'upstream_unreachable' }, origin);
  }
}

export default {
  async fetch(request) {
    return handle(request);
  }
};
