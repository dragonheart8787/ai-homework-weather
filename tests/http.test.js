// 傳輸層與 KUCGU client。fetch 全部是假的，不碰網路。只使用假 key。
const test = require('node:test');
const assert = require('node:assert/strict');
const Http = require('../http.js');
const Kucgu = require('../kucgu.js');

const KUCGU_FAKE = 'cguku_test0000';
const OWM_FAKE = 'owm_test0000';

function memStorage(init) {
  const m = Object.assign({}, init);
  return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; return true; }, remove: (k) => { delete m[k]; return true; } };
}
function fakeFetch(status, bodyText, calls) {
  return async (url, init) => {
    if (calls) calls.push({ url, init });
    return new Response(bodyText, { status });
  };
}
const dump = (rec) => JSON.stringify(rec);

test('header 模式：key 放在 X-API-Key，紀錄裡已遮罩', async () => {
  Kucgu.setStorage(memStorage({ kucgu_api_key: KUCGU_FAKE }));
  const calls = [];
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: fakeFetch(200, '{"status":"connected"}', calls) });
  assert.equal(calls[0].init.headers['X-API-Key'], KUCGU_FAKE); // 真正送出的請求要有 key
  assert.ok(!calls[0].url.includes('api_key'));
  assert.equal(rec.request.headers['X-API-Key'], 'cguk****');
  assert.equal(rec.request.url, 'https://kucgu.replit.app/mission/hello');
  assert.ok(!dump(rec).includes(KUCGU_FAKE));
  assert.equal(rec.ok, true);
  assert.equal(rec.status, 200);
});

test('query 模式：key 放在 api_key，紀錄裡網址已遮罩，且沒有 X-API-Key header', async () => {
  Kucgu.setStorage(memStorage({ kucgu_api_key: KUCGU_FAKE, kucgu_auth_mode: 'query' }));
  const calls = [];
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: fakeFetch(200, '{"a":1}', calls) });
  assert.ok(calls[0].url.endsWith('?api_key=' + KUCGU_FAKE));
  assert.equal(calls[0].init.headers['X-API-Key'], undefined);
  assert.equal(rec.request.url, 'https://kucgu.replit.app/mission/hello?api_key=cguk****');
  assert.ok(!dump(rec).includes(KUCGU_FAKE));
});

test('伺服器回應或錯誤訊息回顯 key 時，也會被遮罩', async () => {
  Kucgu.setStorage(memStorage({ kucgu_api_key: KUCGU_FAKE }));
  const echo = await Kucgu.request('GET', '/mission/hello', { fetchImpl: fakeFetch(401, '{"error":"bad key ' + KUCGU_FAKE + '"}') });
  assert.ok(!dump(echo).includes(KUCGU_FAKE));
  assert.equal(echo.response.json.error, 'bad key cguk****');
  const thrown = await Kucgu.request('GET', '/mission/hello', { fetchImpl: async () => { throw new TypeError('Failed to fetch ' + KUCGU_FAKE); } });
  assert.ok(!dump(thrown).includes(KUCGU_FAKE));
});

test('沒有 key：不送出請求，回傳 no_key', async () => {
  Kucgu.setStorage(memStorage({}));
  let called = false;
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: async () => { called = true; return new Response('{}'); } });
  assert.equal(called, false);
  assert.equal(rec.ok, false);
  assert.equal(rec.error.kind, 'no_key');
});

test('POST body 以 JSON 送出，Content-Type 正確，temperature 保持 number', async () => {
  Kucgu.setStorage(memStorage({ kucgu_api_key: KUCGU_FAKE }));
  const calls = [];
  const rec = await Kucgu.request('POST', '/submit/weather', { body: { mission_id: 'm1', temperature: 21.4 }, fetchImpl: fakeFetch(200, '{}', calls) });
  assert.equal(calls[0].init.body, '{"mission_id":"m1","temperature":21.4}');
  assert.equal(typeof JSON.parse(calls[0].init.body).temperature, 'number');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(rec.request.body, '{"mission_id":"m1","temperature":21.4}');
});

test('錯誤分類：非 2xx、非 JSON、網路 TypeError、逾時', async () => {
  Kucgu.setStorage(memStorage({ kucgu_api_key: KUCGU_FAKE }));
  const r500 = await Kucgu.request('GET', '/x1', { fetchImpl: fakeFetch(503, '{"e":1}') });
  assert.deepEqual([r500.ok, r500.status, r500.error.kind], [false, 503, 'http']);
  assert.deepEqual(r500.response.json, { e: 1 });

  const html = await Kucgu.request('GET', '/x1', { fetchImpl: fakeFetch(200, '<html>oops</html>') });
  assert.deepEqual([html.ok, html.status, html.error.kind], [false, 200, 'not_json']);
  assert.equal(html.response.text, '<html>oops</html>');

  const net = await Kucgu.request('GET', '/x1', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual([net.ok, net.status, net.error.kind, net.error.name], [false, null, 'network', 'TypeError']);

  const slow = await Kucgu.request('GET', '/x1', {
    timeoutMs: 30,
    fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  });
  assert.equal(slow.error.kind, 'timeout');
});

test('預設 timeout：KUCGU 30 秒', () => {
  assert.equal(Kucgu.TIMEOUT_MS, 30000);
});

test('buildUrl 拒絕指向其他網域的 path', () => {
  assert.throws(() => Kucgu.buildUrl('//evil.test/x'));
  assert.throws(() => Kucgu.buildUrl('https://evil.test/x'));
  assert.throws(() => Kucgu.buildUrl('mission/hello'));
});

test('OpenWeatherMap：appid 在紀錄裡已遮罩', async () => {
  const url = 'https://api.openweathermap.org/data/2.5/weather?q=Taipei%2CTW&units=metric&appid=' + OWM_FAKE;
  const rec = await Http.send({ url, secrets: [OWM_FAKE], service: 'owm', fetchImpl: fakeFetch(200, '{"main":{"temp":20}}') });
  assert.ok(rec.request.url.endsWith('&appid=owm_****'));
  assert.ok(!dump(rec).includes(OWM_FAKE));
});
