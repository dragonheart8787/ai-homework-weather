// KUCGU 伺服器網址設定：驗證、儲存、實際用來送請求、遮罩只動 key 不動網域。只使用假 key。
const test = require('node:test');
const assert = require('node:assert/strict');
const Kucgu = require('../kucgu.js');
const Mask = require('../mask.js');

const KUCGU_FAKE = 'cguku_test0000';
const PROXY = 'https://kucgu-proxy.example.workers.dev';

function mem(init) {
  const m = Object.assign({}, init);
  return { m, get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; return true; }, remove: (k) => { delete m[k]; return true; } };
}
const okFetch = (calls) => async (url, init) => { calls.push({ url, init }); return new Response('{"a":1}', { status: 200 }); };

test('normalizeBaseUrl：合法網址，去掉結尾斜線，保留路徑', () => {
  assert.deepEqual(Kucgu.normalizeBaseUrl('https://kucgu.replit.app'), { ok: true, value: 'https://kucgu.replit.app' });
  assert.equal(Kucgu.normalizeBaseUrl('  https://kucgu.replit.app/  ').value, 'https://kucgu.replit.app');
  assert.equal(Kucgu.normalizeBaseUrl(PROXY + '///').value, PROXY);
  assert.equal(Kucgu.normalizeBaseUrl('HTTPS://Example.COM/proxy/').value, 'https://example.com/proxy');
});

test('normalizeBaseUrl：格式錯誤各自有明確訊息', () => {
  const bad = (v) => Kucgu.normalizeBaseUrl(v);
  assert.match(bad('').message, /請輸入/);
  assert.match(bad('   ').message, /請輸入/);
  assert.match(bad(null).message, /請輸入/);
  assert.match(bad('http://kucgu.replit.app').message, /https:\/\//);
  assert.match(bad('kucgu.replit.app').message, /https:\/\//);
  assert.match(bad('ftp://x.test').message, /https:\/\//);
  assert.match(bad('https://').message, /格式/);
  assert.match(bad('https://exa mple.com').message, /格式/);
  assert.match(bad('https://user:pw@example.com').message, /帳號/);
  assert.match(bad('https://example.com?x=1').message, /\?/);
  assert.match(bad('https://example.com/#h').message, /\?|#/);
  ['', 'http://x.test', 'https://', 'https://u:p@x.test', 'https://x.test?a=1'].forEach((v) => assert.equal(bad(v).ok, false));
});

test('setBaseUrl：格式錯誤不儲存；正確才儲存正規化後的值', () => {
  const st = mem({}); Kucgu.setStorage(st);
  assert.equal(Kucgu.setBaseUrl('http://x.test').ok, false);
  assert.equal(st.get('kucgu_base_url'), null);
  const r = Kucgu.setBaseUrl(PROXY + '/');
  assert.deepEqual(r, { ok: true, value: PROXY });
  assert.equal(st.get('kucgu_base_url'), PROXY);
  assert.equal(Kucgu.getBaseUrl(), PROXY);
  assert.equal(Kucgu.isDefaultBaseUrl(), false);
  Kucgu.clearBaseUrl();
  assert.equal(Kucgu.getBaseUrl(), 'https://kucgu.replit.app');
  assert.equal(Kucgu.isDefaultBaseUrl(), true);
});

test('setBaseUrl：localStorage 寫入失敗要明確回報', () => {
  const st = mem({}); st.set = () => false; Kucgu.setStorage(st);
  const r = Kucgu.setBaseUrl(PROXY);
  assert.equal(r.ok, false);
  assert.match(r.message, /沒有儲存/);
});

test('request 使用設定的網址，Console 的 Request 顯示完整網址，只遮 key', async () => {
  Kucgu.setStorage(mem({ kucgu_api_key: KUCGU_FAKE, kucgu_base_url: PROXY, kucgu_auth_mode: 'query' }));
  const calls = [];
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: okFetch(calls) });
  assert.equal(calls[0].url, PROXY + '/mission/hello?api_key=' + KUCGU_FAKE);
  assert.equal(rec.request.url, PROXY + '/mission/hello?api_key=cguk****');
  assert.equal(rec.usingDefaultBase, false);
  assert.ok(!JSON.stringify(rec).includes(KUCGU_FAKE));
});

test('request 沒設定網址時使用預設網址；路徑前綴會保留', async () => {
  Kucgu.setStorage(mem({ kucgu_api_key: KUCGU_FAKE }));
  const calls = [];
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: okFetch(calls) });
  assert.equal(calls[0].url, 'https://kucgu.replit.app/mission/hello');
  assert.equal(rec.usingDefaultBase, true);

  Kucgu.setStorage(mem({ kucgu_api_key: KUCGU_FAKE, kucgu_base_url: 'https://x.test/proxy' }));
  await Kucgu.request('GET', '/mission/hello', { fetchImpl: okFetch(calls) });
  assert.equal(calls[1].url, 'https://x.test/proxy/mission/hello');
});

test('已儲存的網址壞掉：不送出請求，也不悄悄改用預設網址', async () => {
  Kucgu.setStorage(mem({ kucgu_api_key: KUCGU_FAKE, kucgu_base_url: 'http://evil.test' }));
  const calls = [];
  const rec = await Kucgu.request('GET', '/mission/hello', { fetchImpl: okFetch(calls) });
  assert.equal(calls.length, 0);
  assert.equal(rec.error.kind, 'bad_base_url');
  assert.equal(rec.ok, false);
});

test('遮罩不動網域，只動 key', () => {
  assert.equal(Mask.maskUrl(PROXY + '/mission/hello?api_key=' + KUCGU_FAKE), PROXY + '/mission/hello?api_key=cguk****');
});
