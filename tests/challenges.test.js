// 挑戰流程、欄位驗證、Next Action 對應表。fetch 全部是假的。只使用假 key。
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../challenges.js');
const Http = require('../http.js');
const Kucgu = require('../kucgu.js');

const KUCGU_FAKE = 'cguku_test0000';
const OWM_FAKE = 'owm_test0000';

function makeEnv(routes, opts) {
  opts = opts || {};
  const store = {};
  const ls = { m: { kucgu_api_key: KUCGU_FAKE }, get(k) { return k in this.m ? this.m[k] : null; }, set(k, v) { this.m[k] = v; return true; }, remove(k) { delete this.m[k]; return true; } };
  Kucgu.setStorage(ls);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const r = routes[(init.method || 'GET') + ' ' + u.host + u.pathname];
    if (!r) throw new Error('unexpected request ' + url);
    if (typeof r === 'function') return r(url, init);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status || 200 });
  };
  const logs = [];
  const ctx = {
    kucgu: { request: (m, p, o) => Kucgu.request(m, p, Object.assign({ fetchImpl }, o)) },
    http: { send: (o) => Http.send(Object.assign({ fetchImpl }, o)) },
    owmKey: () => (opts.noOwm ? '' : OWM_FAKE),
    session: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { if (opts.noStorage) return false; store[k] = v; return true; } },
    getAnswer: () => opts.answer,
    log: (r) => logs.push(r),
    secrets: () => [KUCGU_FAKE, OWM_FAKE]
  };
  return { ctx, calls, logs, store };
}
const item = (id) => C.makeChallenges().find((c) => c.id === id);
const MISSION = { mission_id: 'm-123', city: 'Taipei', country: 'TW', unit: 'metric', task: 't', pts_earned: 10, total_score: 20 };
const OWM_OK = { body: { main: { temp: 23.7 } } };
const SUBMIT_OK = { body: { status: 'correct', message: 'ok', actual_temperature: 23.5, pts_earned: 30, total_score: 50 } };

test('挑戰設定陣列：五項、順序固定、初始狀態未執行', () => {
  const list = C.makeChallenges();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((c) => c.order), [1, 2, 3, 4, 5]);
  list.forEach((c) => { assert.equal(c.status, 'idle'); assert.equal(typeof c.run, 'function'); assert.ok(c.id && c.title); });
});

/* ---------- 欄位驗證 ---------- */

test('validate：缺欄位、型別錯誤各自列出，不補預設值', () => {
  assert.deepEqual(C.validate({ status: 'connected', pts_earned: 0, total_score: 5 }, C.SPECS.hello), { ok: true, problems: [] });
  assert.deepEqual(C.validate({ city: 'T', country: 'TW', unit: 'metric', pts_earned: 1, total_score: 1 }, C.SPECS.mission_weather).problems, ['mission_id']);
  assert.deepEqual(C.validate({ mission_id: '  ', city: 'T', country: 'TW', unit: 'metric', pts_earned: 1, total_score: 1 }, C.SPECS.mission_weather).problems, ['mission_id']);
  assert.deepEqual(C.validate({ status: 'correct', pts_earned: '10', total_score: 1 }, C.SPECS.submit_weather).problems, ['pts_earned']);
  assert.deepEqual(C.validate({ status: 'maybe', pts_earned: 1, total_score: NaN }, C.SPECS.submit_bonus).problems, ['status', 'total_score']);
  assert.equal(C.validate([], C.SPECS.hello).ok, false);
  assert.equal(C.validate(null, C.SPECS.hello).ok, false);
  assert.equal(C.validate({ status: 'nope', pts_earned: 0, total_score: 0 }, C.SPECS.hello).ok, false);
});

test('回應缺少 mission_id：步驟 2 失敗，且不存入 session', async () => {
  const { ctx, store, logs } = makeEnv({ 'GET kucgu.replit.app/mission/weather': { body: { city: 'Taipei', country: 'TW', unit: 'metric', pts_earned: 0, total_score: 0 } } });
  const it = item('weather-mission');
  const out = await C.execute(it, ctx);
  assert.equal(out.state, 'failure');
  assert.equal(it.status, 'failure');
  assert.equal(store[C.MISSION_KEY], undefined);
  assert.equal(logs[0].error.kind, 'invalid_response');
  assert.deepEqual(logs[0].error.problems, ['mission_id']);
});

test('步驟 2 成功：存入 mission_id、city、country、unit', async () => {
  const { ctx, store } = makeEnv({ 'GET kucgu.replit.app/mission/weather': { body: MISSION } });
  const out = await C.execute(item('weather-mission'), ctx);
  assert.equal(out.state, 'success');
  assert.deepEqual(JSON.parse(store[C.MISSION_KEY]), { mission_id: 'm-123', city: 'Taipei', country: 'TW', unit: 'metric' });
});

test('步驟 2：sessionStorage 寫入失敗要明確失敗', async () => {
  const { ctx, logs } = makeEnv({ 'GET kucgu.replit.app/mission/weather': { body: MISSION } }, { noStorage: true });
  const out = await C.execute(item('weather-mission'), ctx);
  assert.equal(out.state, 'failure');
  assert.equal(logs[logs.length - 1].error.kind, 'storage');
});

/* ---------- 步驟 3 ---------- */

test('步驟 3：沒有任務就停止，不呼叫任何 API', async () => {
  const { ctx, calls, logs } = makeEnv({});
  const out = await C.execute(item('weather-submit'), ctx);
  assert.equal(out.state, 'failure');
  assert.match(out.message, /請先執行步驟 2/);
  assert.equal(calls.length, 0);
  assert.equal(logs[0].request, null);
});

test('步驟 3：unit 不是 metric 就停止，不呼叫任何 API', async () => {
  const { ctx, calls, store } = makeEnv({});
  store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm', city: 'Taipei', country: 'TW', unit: 'imperial' });
  const out = await C.execute(item('weather-submit'), ctx);
  assert.equal(out.state, 'failure');
  assert.match(out.message, /imperial/);
  assert.equal(calls.length, 0);
});

test('步驟 3：沒有 OpenWeatherMap key 就停止', async () => {
  const { ctx, calls, store } = makeEnv({}, { noOwm: true });
  store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm', city: 'Taipei', country: 'TW', unit: 'metric' });
  const out = await C.execute(item('weather-submit'), ctx);
  assert.equal(out.state, 'failure');
  assert.equal(calls.length, 0);
});

test('步驟 3 成功：用任務的 city,country 查 OWM，temperature 以 number 提交', async () => {
  const { ctx, calls, store, logs } = makeEnv({
    'GET api.openweathermap.org/data/2.5/weather': OWM_OK,
    'POST kucgu.replit.app/submit/weather': SUBMIT_OK
  });
  store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm-999', city: 'Reykjavík', country: 'IS', unit: 'metric' });
  const out = await C.execute(item('weather-submit'), ctx);
  assert.equal(out.state, 'success');
  const owmUrl = new URL(calls[0].url);
  assert.equal(owmUrl.searchParams.get('q'), 'Reykjavík,IS');
  assert.equal(owmUrl.searchParams.get('units'), 'metric');
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, { mission_id: 'm-999', temperature: 23.7 });
  assert.equal(typeof body.temperature, 'number');
  assert.deepEqual(logs.map((l) => l.step), ['owm_weather', 'submit_weather']);
  logs.forEach((l) => assert.ok(!JSON.stringify(l).includes(OWM_FAKE) && !JSON.stringify(l).includes(KUCGU_FAKE)));
});

test('步驟 3：OWM 失敗（401、404、網路）時完全不呼叫 submit', async () => {
  for (const owm of [{ status: 401, body: {} }, { status: 404, body: { message: 'city not found' } },
    () => { throw new TypeError('Failed to fetch'); }]) {
    const { ctx, calls, store } = makeEnv({ 'GET api.openweathermap.org/data/2.5/weather': owm });
    store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm', city: 'Taipei', country: 'TW', unit: 'metric' });
    const out = await C.execute(item('weather-submit'), ctx);
    assert.equal(out.state, 'failure');
    assert.ok(calls.every((c) => !c.url.includes('kucgu')), '不可呼叫 submit');
  }
});

test('步驟 3：main.temp 不是有限數字時不提交（字串、null、NaN 缺失、物件缺失）', async () => {
  for (const body of [{ main: { temp: '23.7' } }, { main: { temp: null } }, { main: {} }, {}, { main: { temp: 1e999 } }]) {
    const { ctx, calls, store, logs } = makeEnv({ 'GET api.openweathermap.org/data/2.5/weather': { body: typeof body === 'object' ? JSON.stringify(body) : body } });
    store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm', city: 'Taipei', country: 'TW', unit: 'metric' });
    const out = await C.execute(item('weather-submit'), ctx);
    assert.equal(out.state, 'failure');
    assert.equal(calls.length, 1);
    assert.equal(logs[0].error.kind, 'invalid_response');
  }
});

test('步驟 3：伺服器判定 incorrect 時狀態是失敗，Next Action 指向步驟 2', async () => {
  const { ctx, store, logs } = makeEnv({
    'GET api.openweathermap.org/data/2.5/weather': OWM_OK,
    'POST kucgu.replit.app/submit/weather': { body: { status: 'incorrect', message: 'off', actual_temperature: 10, pts_earned: 0, total_score: 20 } }
  });
  store[C.MISSION_KEY] = JSON.stringify({ mission_id: 'm', city: 'Taipei', country: 'TW', unit: 'metric' });
  const it = item('weather-submit');
  await C.execute(it, ctx);
  assert.equal(it.status, 'failure');
  assert.match(logs[1].nextAction, /重新執行步驟 2/);
});

/* ---------- 步驟 4、5 ---------- */

test('步驟 4 存 bonus_id 與 question；步驟 5 以字串送出 trim 後的答案', async () => {
  const env = makeEnv({
    'GET kucgu.replit.app/mission/bonus': { body: { bonus_id: 'b-1', type: 'q', question: '1 加 1？', pts_earned: 0, total_score: 5 } },
    'POST kucgu.replit.app/submit/bonus': { body: { status: 'correct', message: 'yes', pts_earned: 5, total_score: 10 } }
  }, { answer: '  42  ' });
  assert.equal((await C.execute(item('bonus-get'), env.ctx)).state, 'success');
  assert.deepEqual(JSON.parse(env.store[C.BONUS_KEY]), { bonus_id: 'b-1', question: '1 加 1？' });
  assert.equal((await C.execute(item('bonus-submit'), env.ctx)).state, 'success');
  const sent = JSON.parse(env.calls[1].init.body);
  assert.deepEqual(sent, { bonus_id: 'b-1', answer: '42' });
  assert.equal(typeof sent.answer, 'string');
});

test('步驟 5：數字樣子的答案仍以字串送出；空答案與沒有題目都不送出', async () => {
  const env = makeEnv({ 'POST kucgu.replit.app/submit/bonus': { body: { status: 'incorrect', message: 'no', pts_earned: 0, total_score: 5 } } }, { answer: '7' });
  env.store[C.BONUS_KEY] = JSON.stringify({ bonus_id: 'b-1', question: 'q' });
  const it = item('bonus-submit');
  await C.execute(it, env.ctx);
  assert.equal(JSON.parse(env.calls[0].init.body).answer, '7');
  assert.equal(it.status, 'failure'); // incorrect，可重試

  const empty = makeEnv({}, { answer: '   ' });
  empty.store[C.BONUS_KEY] = JSON.stringify({ bonus_id: 'b-1', question: 'q' });
  assert.equal((await C.execute(item('bonus-submit'), empty.ctx)).state, 'failure');
  assert.equal(empty.calls.length, 0);

  const noq = makeEnv({}, { answer: 'x' });
  const out = await C.execute(item('bonus-submit'), noq.ctx);
  assert.match(out.message, /請先執行步驟 4/);
  assert.equal(noq.calls.length, 0);
});

test('execute：執行中再次呼叫會被擋下，不會重複送出', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const env = makeEnv({ 'GET kucgu.replit.app/mission/hello': async () => { await gate; return new Response(JSON.stringify({ status: 'connected', pts_earned: 1, total_score: 1 })); } });
  const it = item('hello');
  const first = C.execute(it, env.ctx);
  assert.equal(it.status, 'running');
  assert.equal(await C.execute(it, env.ctx), null);
  release();
  await first;
  assert.equal(env.calls.length, 1);
  assert.equal(it.status, 'success');
});

test('execute：未預期例外視為失敗並記錄', async () => {
  const env = makeEnv({});
  const it = { id: 'x', order: 1, title: 'x', status: 'idle', run: async () => { throw new Error('boom ' + KUCGU_FAKE); } };
  const out = await C.execute(it, env.ctx);
  assert.equal(out.state, 'failure');
  assert.equal(it.status, 'failure');
  assert.ok(!JSON.stringify(env.logs).includes(KUCGU_FAKE));
});

/* ---------- Next Action 對應表 ---------- */

const R = (step, over) => Object.assign({ step, service: 'kucgu', error: null, status: 200, response: { json: {} } }, over);
const E = (kind, over) => ({ kind, message: kind, ...over });

const TABLE = [
  ['hello 成功 pts>0', R('hello', { response: { json: { pts_earned: 10 } } }), '已連線，下一步請執行步驟 2'],
  ['hello 成功 pts=0', R('hello', { response: { json: { pts_earned: 0 } } }), '先前已連線過，可直接執行步驟 2'],
  ['weather 任務取得', R('mission_weather', { response: { json: { city: 'Taipei' } } }), '已指派城市 Taipei，下一步請執行步驟 3'],
  ['submit/weather correct', R('submit_weather', { response: { json: { status: 'correct' } } }), '天氣任務完成，下一步請執行步驟 4'],
  ['submit/weather incorrect', R('submit_weather', { response: { json: { status: 'incorrect' } } }), '溫度不符，請重新執行步驟 2 取得新的 mission_id，再執行步驟 3 重試'],
  ['bonus 取得', R('mission_bonus'), '請在步驟 5 輸入答案'],
  ['submit/bonus correct', R('submit_bonus', { response: { json: { status: 'correct' } } }), '全部完成，請開啟網站截圖 Scoreboard'],
  ['submit/bonus incorrect', R('submit_bonus', { response: { json: { status: 'incorrect' } } }), '答案不正確，請修正後重新提交'],
  ['HTTP 401', R('hello', { status: 401, error: E('http') }), 'API key 錯誤或未設定，請檢查設定面板'],
  ['HTTP 403', R('hello', { status: 403, error: E('http') }), 'API key 錯誤或未設定，請檢查設定面板'],
  ['沒有 key', R('hello', { status: null, error: E('no_key') }), 'API key 錯誤或未設定，請檢查設定面板'],
  ['HTTP 429', R('hello', { status: 429, error: E('http') }), '請求太頻繁，稍後再試'],
  ['HTTP 500', R('hello', { status: 500, error: E('http') }), '伺服器錯誤，稍後再試'],
  ['HTTP 503', R('hello', { status: 503, error: E('http') }), '伺服器錯誤，稍後再試'],
  ['逾時', R('hello', { status: null, error: E('timeout') }), '伺服器可能正在啟動中（Replit 冷啟動），請再試一次'],
  ['TypeError 無 status，使用預設網址', R('hello', { status: null, usingDefaultBase: true, error: E('network', { name: 'TypeError' }) }),
    '網路失敗，或被瀏覽器的 CORS 擋下（兩者在瀏覽器端無法區分，請查看 DevTools Console）。請到設定改填代理網址'],
  ['TypeError 無 status，已使用代理網址', R('hello', { status: null, usingDefaultBase: false, error: E('network', { name: 'TypeError' }) }),
    '網路失敗，或被瀏覽器的 CORS 擋下（兩者在瀏覽器端無法區分，請查看 DevTools Console）。請確認 Worker 已部署且網址正確'],
  ['伺服器網址設定錯誤', R('hello', { status: null, error: E('bad_base_url') }), '伺服器網址設定不正確，請到設定重新填寫，或按「恢復預設」']
];
TABLE.forEach(([name, rec, expected]) => test('Next Action：' + name, () => assert.equal(C.nextAction(rec), expected)));

test('Next Action：錯誤優先於成功對應（HTTP 200 但欄位缺失、非 JSON、其他 4xx）', () => {
  assert.match(C.nextAction(R('mission_weather', { error: E('invalid_response', { problems: ['mission_id'] }) })), /mission_id.*不視為成功/);
  assert.match(C.nextAction(R('hello', { error: E('not_json') })), /不是 JSON/);
  assert.match(C.nextAction(R('hello', { status: 404, error: E('http') })), /HTTP 404/);
});

test('Next Action：OpenWeatherMap 的逾時與網路錯誤不會說成 Replit 冷啟動或 CORS', () => {
  const t = C.nextAction({ step: 'owm_weather', service: 'owm', status: null, error: E('timeout'), response: null });
  assert.ok(!/Replit/.test(t));
  const n = C.nextAction({ step: 'owm_weather', service: 'owm', status: null, error: E('network'), response: null });
  assert.ok(!/CORS/.test(n));
});
