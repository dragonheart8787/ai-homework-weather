// 只使用假 key。
const test = require('node:test');
const assert = require('node:assert/strict');
const Mask = require('../mask.js');

const KUCGU_FAKE = 'cguku_test0000';
const OWM_FAKE = 'owm_test0000';

test('maskKey 只留前 4 碼加 ****', () => {
  assert.equal(Mask.maskKey(KUCGU_FAKE), 'cguk****');
  assert.equal(Mask.maskKey(OWM_FAKE), 'owm_****');
  assert.equal(Mask.maskKey('abcd'), '****'); // 長度不足就全遮
  assert.equal(Mask.maskKey('ab'), '****');
  assert.equal(Mask.maskKey(''), '');
  assert.equal(Mask.maskKey(Mask.maskKey(KUCGU_FAKE)), 'cguk****'); // 冪等
});

test('URL 查詢參數：api_key', () => {
  const out = Mask.maskUrl('https://kucgu.replit.app/mission/hello?api_key=' + KUCGU_FAKE);
  assert.equal(out, 'https://kucgu.replit.app/mission/hello?api_key=cguk****');
  assert.ok(!out.includes(KUCGU_FAKE));
});

test('URL 查詢參數：appid，且在多個參數之間', () => {
  const out = Mask.maskUrl('https://api.openweathermap.org/data/2.5/weather?q=Taipei,TW&units=metric&appid=' + OWM_FAKE + '&lang=zh_tw');
  assert.equal(out, 'https://api.openweathermap.org/data/2.5/weather?q=Taipei,TW&units=metric&appid=owm_****&lang=zh_tw');
});

test('URL：api_key 在第一個參數後面、大小寫不同、URL 編碼', () => {
  assert.equal(Mask.maskUrl('https://x.test/a?x=1&API_KEY=' + KUCGU_FAKE + '#h'), 'https://x.test/a?x=1&API_KEY=cguk****#h');
  assert.equal(Mask.maskUrl('https://x.test/a?api_key=' + encodeURIComponent(KUCGU_FAKE)), 'https://x.test/a?api_key=cguk****');
});

test('URL：不含 key 的網址與非字串不變', () => {
  assert.equal(Mask.maskUrl('https://x.test/a?q=monkey=1'), 'https://x.test/a?q=monkey=1');
  assert.equal(Mask.maskUrl(null), null);
});

test('header：X-API-Key（不分大小寫）', () => {
  const out = Mask.maskHeaders({ Accept: 'application/json', 'X-API-Key': KUCGU_FAKE });
  assert.deepEqual(out, { Accept: 'application/json', 'X-API-Key': 'cguk****' });
  assert.equal(Mask.maskHeaders({ 'x-api-key': KUCGU_FAKE })['x-api-key'], 'cguk****');
});

test('header：Authorization 保留 scheme，並且不修改原物件', () => {
  const src = { Authorization: 'Bearer ' + KUCGU_FAKE };
  assert.equal(Mask.maskHeaders(src).Authorization, 'Bearer cguk****');
  assert.equal(src.Authorization, 'Bearer ' + KUCGU_FAKE);
});

test('scrub：任意字串中的 key 原值與 URL 編碼值', () => {
  const s = 'oops ' + KUCGU_FAKE + ' and ' + encodeURIComponent('a b' + KUCGU_FAKE);
  const out = Mask.scrub(s, [KUCGU_FAKE]);
  assert.ok(!out.includes(KUCGU_FAKE));
  assert.ok(out.includes('cguk****'));
  assert.equal(Mask.scrub('no secret', [KUCGU_FAKE]), 'no secret');
});
