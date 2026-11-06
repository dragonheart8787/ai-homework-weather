// Cloudflare Worker 代理測試。fetch 全部是假的。只使用假 key。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const KUCGU_FAKE = 'cguku_test0000';
const GH = 'https://dragonheart8787.github.io';
const LOCAL = 'http://localhost:8000';
const W = 'https://kucgu-proxy.example.workers.dev';
const WORKER_SRC = path.join(__dirname, '..', 'worker', 'worker.js');

let worker;
test.before(async () => { worker = (await import(WORKER_SRC)).default; });

/** 執行一次 worker，並攔截上游 fetch 與所有 console 輸出。 */
async function run(url, init, upstream) {
  const upstreamCalls = [];
  const logs = [];
  const realFetch = globalThis.fetch;
  const realConsole = {};
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach((k) => { realConsole[k] = console[k]; console[k] = (...a) => logs.push(a.join(' ')); });
  globalThis.fetch = async (u, i) => {
    upstreamCalls.push({ url: u, init: i });
    if (upstream instanceof Error) throw upstream;
    return typeof upstream === 'function' ? upstream(u, i) : (upstream || new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  try {
    const res = await worker.fetch(new Request(url, init));
    const text = await res.text();
    return { res, text, upstreamCalls, logs };
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, realConsole);
  }
}
const withOrigin = (origin, extra) => Object.assign({ headers: Object.assign(origin ? { Origin: origin } : {}, (extra && extra.headers) || {}) }, extra && { method: extra.method, body: extra.body });

/* ---------- 路徑白名單 ---------- */

test('白名單內的 method 加路徑：轉發到固定上游', async () => {
  const cases = [['GET', '/mission/hello'], ['GET', '/mission/weather'], ['GET', '/mission/bonus'], ['POST', '/submit/weather'], ['POST', '/submit/bonus']];
  for (const [method, p] of cases) {
    const r = await run(W + p, withOrigin(GH, { method, body: method === 'POST' ? '{"a":1}' : undefined }));
    assert.equal(r.res.status, 200, method + ' ' + p);
    assert.equal(r.upstreamCalls.length, 1);
    assert.equal(r.upstreamCalls[0].url, 'https://kucgu.replit.app' + p);
    assert.equal(r.upstreamCalls[0].init.method, method);
  }
});

test('白名單外的路徑與 method：404，且不轉發', async () => {
  const cases = [
    ['GET', '/'], ['GET', '/mission'], ['GET', '/mission/hello/'], ['GET', '/mission/other'], ['GET', '/MISSION/HELLO'],
    ['GET', '/admin'], ['GET', '//evil.test/mission/hello'], ['GET', '/mission/hello/../../admin'], ['GET', '/mission/hello%2f..'],
    ['POST', '/mission/hello'], ['GET', '/submit/weather'], ['PUT', '/submit/bonus'], ['DELETE', '/mission/hello'],
    ['POST', '/mission/weather'], ['POST', '/submit/weather/']
  ];
  for (const [method, p] of cases) {
    const r = await run(W + p, withOrigin(GH, { method, body: ['POST', 'PUT'].includes(method) ? '{}' : undefined }));
    assert.equal(r.res.status, 404, method + ' ' + p);
    assert.equal(r.upstreamCalls.length, 0, method + ' ' + p + ' 不可轉發');
  }
});

test('上游主機寫死：query 參數或標頭都無法改變上游', async () => {
  const r = await run(W + '/mission/hello?url=https://evil.test&host=evil.test&api_key=' + KUCGU_FAKE,
    withOrigin(GH, { headers: { Host: 'evil.test', 'X-Forwarded-Host': 'evil.test' } }));
  assert.ok(r.upstreamCalls[0].url.startsWith('https://kucgu.replit.app/mission/hello?'));
  assert.equal(new URL(r.upstreamCalls[0].url).host, 'kucgu.replit.app');
});

/* ---------- Origin 白名單 ---------- */

test('白名單 Origin：兩個都可通過', async () => {
  for (const o of [GH, LOCAL]) {
    const r = await run(W + '/mission/hello', withOrigin(o));
    assert.equal(r.res.status, 200);
    assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), o);
  }
});

test('非白名單 Origin：403，不轉發，不加 CORS 標頭（GET、POST、OPTIONS 都一樣）', async () => {
  const bad = [undefined, 'null', 'https://evil.test', GH + '.evil.test', 'http://dragonheart8787.github.io', 'https://dragonheart8787.github.io/', 'http://localhost:8001', 'http://localhost', 'https://localhost:8000', '*'];
  for (const o of bad) {
    for (const [method, p] of [['GET', '/mission/hello'], ['POST', '/submit/weather'], ['OPTIONS', '/mission/hello'], ['GET', '/nope']]) {
      const r = await run(W + p, withOrigin(o, { method, body: method === 'POST' ? '{}' : undefined }));
      assert.equal(r.res.status, 403, String(o) + ' ' + method + ' ' + p);
      assert.equal(r.upstreamCalls.length, 0);
      assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), null);
    }
  }
});

/* ---------- OPTIONS ---------- */

test('OPTIONS preflight：204 與完整 CORS 標頭，Origin 回傳請求的 Origin，不用 *，不轉發', async () => {
  for (const o of [GH, LOCAL]) {
    const r = await run(W + '/mission/hello', withOrigin(o, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-api-key' } }));
    assert.equal(r.res.status, 204);
    assert.equal(r.text, '');
    const h = r.res.headers;
    assert.equal(h.get('Access-Control-Allow-Origin'), o);
    assert.notEqual(h.get('Access-Control-Allow-Origin'), '*');
    assert.equal(h.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
    assert.equal(h.get('Access-Control-Allow-Headers'), 'Content-Type, X-API-Key');
    assert.ok(Number(h.get('Access-Control-Max-Age')) > 0);
    assert.match(h.get('Vary'), /Origin/);
    assert.equal(r.upstreamCalls.length, 0);
  }
});

test('OPTIONS：白名單外的路徑回 404', async () => {
  const r = await run(W + '/admin', withOrigin(GH, { method: 'OPTIONS' }));
  assert.equal(r.res.status, 404);
  assert.equal(r.upstreamCalls.length, 0);
});

/* ---------- 轉發內容 ---------- */

test('保留 method、query string（含 api_key）、body，只轉發 X-API-Key 與 Content-Type', async () => {
  const body = JSON.stringify({ mission_id: 'm1', temperature: 21.4 });
  const r = await run(W + '/submit/weather?api_key=' + KUCGU_FAKE + '&x=1', {
    method: 'POST', body,
    headers: {
      Origin: GH, 'Content-Type': 'application/json', 'X-API-Key': KUCGU_FAKE,
      Cookie: 'sid=1', Authorization: 'Bearer zzz', 'User-Agent': 'ua', 'X-Forwarded-For': '1.2.3.4', Referer: GH + '/', 'Accept-Language': 'zh'
    }
  });
  const call = r.upstreamCalls[0];
  assert.equal(call.url, 'https://kucgu.replit.app/submit/weather?api_key=' + KUCGU_FAKE + '&x=1');
  assert.equal(call.init.method, 'POST');
  assert.equal(Buffer.from(call.init.body).toString(), body);
  const sent = {};
  call.init.headers.forEach((v, k) => { sent[k] = v; });
  assert.deepEqual(Object.keys(sent).sort(), ['content-type', 'x-api-key']);
  assert.equal(sent['x-api-key'], KUCGU_FAKE);
  assert.equal(sent['content-type'], 'application/json');
});

test('沒帶 X-API-Key 時不會憑空加上 header', async () => {
  const r = await run(W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin(GH));
  const names = []; r.upstreamCalls[0].init.headers.forEach((v, k) => names.push(k));
  assert.deepEqual(names, []);
});

test('回應保留上游 status 與 body，並加上 CORS 標頭', async () => {
  for (const [status, body] of [[200, '{"status":"connected"}'], [401, '{"detail":"bad key"}'], [429, '{"e":1}'], [500, 'plain text'], [422, '{"detail":[]}']]) {
    const r = await run(W + '/mission/hello', withOrigin(GH), new Response(body, { status, headers: { 'Content-Type': status === 500 ? 'text/plain' : 'application/json' } }));
    assert.equal(r.res.status, status);
    assert.equal(r.text, body);
    assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), GH);
    assert.match(r.res.headers.get('Vary'), /Origin/);
    assert.equal(r.res.headers.get('Content-Type'), status === 500 ? 'text/plain' : 'application/json');
  }
});

test('上游的 Set-Cookie 不會回給瀏覽器；204 這類無 body 狀態不會出錯', async () => {
  const r = await run(W + '/mission/hello', withOrigin(GH), new Response('{}', { status: 200, headers: { 'Set-Cookie': 'a=b', 'Content-Type': 'application/json' } }));
  assert.equal(r.res.headers.get('Set-Cookie'), null);
  const r2 = await run(W + '/mission/hello', withOrigin(GH), new Response(null, { status: 204 }));
  assert.equal(r2.res.status, 204);
});

test('上游無法連線：502 與 {"error":"upstream_unreachable"}，仍帶 CORS 標頭', async () => {
  const r = await run(W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin(GH, { headers: { 'X-API-Key': KUCGU_FAKE } }), new TypeError('fetch failed ' + KUCGU_FAKE));
  assert.equal(r.res.status, 502);
  assert.deepEqual(JSON.parse(r.text), { error: 'upstream_unreachable' });
  assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), GH);
  assert.ok(!r.text.includes(KUCGU_FAKE));
});

/* ---------- 不記錄任何東西 ---------- */

test('key、query string、body 不會出現在任何 log，也不會出現在錯誤回應', async () => {
  const secretBody = JSON.stringify({ mission_id: 'm1', temperature: 1, note: KUCGU_FAKE });
  const scenarios = [
    [W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin(GH, { headers: { 'X-API-Key': KUCGU_FAKE } }), undefined],
    [W + '/submit/weather?api_key=' + KUCGU_FAKE, withOrigin(GH, { method: 'POST', body: secretBody, headers: { 'X-API-Key': KUCGU_FAKE, 'Content-Type': 'application/json' } }), undefined],
    [W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin(GH, { headers: { 'X-API-Key': KUCGU_FAKE } }), new Error('boom ' + KUCGU_FAKE)],
    [W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin('https://evil.test', { headers: { 'X-API-Key': KUCGU_FAKE } }), undefined],
    [W + '/nope?api_key=' + KUCGU_FAKE, withOrigin(GH, { headers: { 'X-API-Key': KUCGU_FAKE } }), undefined],
    [W + '/mission/hello?api_key=' + KUCGU_FAKE, withOrigin(GH, { method: 'OPTIONS' }), undefined]
  ];
  for (const [u, init, up] of scenarios) {
    const r = await run(u, init, up);
    assert.deepEqual(r.logs, [], '不可有任何 console 輸出');
    assert.ok(!r.text.includes(KUCGU_FAKE), '回應內容不可含 key');
    let headerDump = ''; r.res.headers.forEach((v, k) => { headerDump += k + ':' + v + '\n'; });
    assert.ok(!headerDump.includes(KUCGU_FAKE), '回應標頭不可含 key');
  }
});

test('原始碼：沒有任何 console 呼叫，沒有 KV、Secret、環境變數、儲存 API', () => {
  const src = fs.readFileSync(WORKER_SRC, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bconsole\b/.test(code), '不可使用 console');
  assert.ok(!/\benv\b|\bKV\b|caches\b|\.put\(|waitUntil|localStorage/.test(code), '不可使用儲存或環境變數');
  assert.ok(!/cguku_|[0-9a-fA-F]{32}/.test(src), '不可含 key');
  assert.ok(!/\bimport\b|require\(/.test(code), '單一檔案，不可有相依');
});

/* ---------- 與 App 的 client 一起跑 ---------- */

test('App 的 Kucgu client 對 Worker 發出的請求（Header 與 Query 兩種模式）可以通過', async () => {
  const Kucgu = require('../kucgu.js');
  for (const mode of ['header', 'query']) {
    const st = { m: { kucgu_api_key: KUCGU_FAKE, kucgu_base_url: W, kucgu_auth_mode: mode }, get(k) { return k in this.m ? this.m[k] : null; }, set() { return true; }, remove() { return true; } };
    Kucgu.setStorage(st);
    const upstreamCalls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, i) => { upstreamCalls.push({ u, i }); return new Response('{"status":"connected","pts_earned":0,"total_score":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    // 模擬瀏覽器：照 CORS 規則，先看 preflight 是否允許要送的標頭，再送出請求並帶 Origin
    const browserFetch = async (u, init) => {
      const wanted = Object.keys(init.headers).filter((h) => !['accept'].includes(h.toLowerCase()));
      if (wanted.length) {
        const pre = await worker.fetch(new Request(u, { method: 'OPTIONS', headers: { Origin: GH } }));
        const allowed = pre.headers.get('Access-Control-Allow-Headers').toLowerCase().split(/,\s*/);
        wanted.forEach((h) => assert.ok(allowed.includes(h.toLowerCase()), 'preflight 沒允許 ' + h));
      }
      return worker.fetch(new Request(u, { method: init.method, headers: Object.assign({ Origin: GH }, init.headers), body: init.body }));
    };
    try {
      const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: browserFetch });
      assert.equal(rec.ok, true, mode);
      assert.equal(rec.status, 200);
      assert.ok(upstreamCalls[0].u.startsWith('https://kucgu.replit.app/mission/hello'));
      assert.ok(!JSON.stringify(rec).includes(KUCGU_FAKE));
      const post = await Kucgu.request('POST', '/submit/weather', { body: { mission_id: 'm', temperature: 1 }, fetchImpl: browserFetch });
      assert.equal(post.ok, true, mode + ' POST');
    } finally {
      globalThis.fetch = realFetch;
    }
  }
});
