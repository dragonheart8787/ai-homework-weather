/*
 * key 遮罩。所有要顯示、記錄的字串，都必須先經過這裡。
 * 規則：只保留前 4 碼，後面一律換成 ****。長度不足 4 碼的值整個換成 ****。
 * 純函式，沒有任何 DOM 或網路相依，所以可以直接用 Node 測試。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Mask = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SECRET_PARAMS = ['api_key', 'apikey', 'appid', 'key'];
  const SECRET_HEADERS = ['x-api-key', 'authorization', 'proxy-authorization'];

  function maskKey(value) {
    const s = value == null ? '' : String(value);
    if (s === '') return '';
    if (s.length <= 4) return '****';
    return s.slice(0, 4) + '****';
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  /** 遮罩網址（或任何含網址的字串）裡的 api_key / appid 等查詢參數值。 */
  function maskUrl(text) {
    if (typeof text !== 'string') return text;
    const re = new RegExp('([?&](?:' + SECRET_PARAMS.join('|') + ')=)([^&#\\s]*)', 'gi');
    return text.replace(re, function (_all, prefix, val) {
      return prefix + maskKey(safeDecode(val));
    });
  }

  /** 回傳新物件，X-API-Key、Authorization 等 header 的值已遮罩。 */
  function maskHeaders(headers) {
    const out = {};
    Object.keys(headers || {}).forEach(function (name) {
      const v = String(headers[name]);
      if (SECRET_HEADERS.indexOf(name.toLowerCase()) === -1) { out[name] = v; return; }
      const m = /^(\S+)\s+(.+)$/.exec(v); // 例如 "Bearer abcdef"，保留 scheme
      out[name] = m ? m[1] + ' ' + maskKey(m[2]) : maskKey(v);
    });
    return out;
  }

  /**
   * 第二道防線：把已知的 key 原值（含 URL 編碼後的樣子）從任何字串中換成遮罩值。
   * 用在回應內容、錯誤訊息、body 等不在固定欄位的地方。
   */
  function scrub(text, secrets) {
    if (typeof text !== 'string' || !secrets || !secrets.length) return text;
    let out = text;
    secrets.forEach(function (s) {
      if (typeof s !== 'string' || s.length < 4) return;
      const masked = maskKey(s);
      [s, encodeURIComponent(s)].forEach(function (variant) {
        out = out.split(variant).join(masked);
      });
    });
    return out;
  }

  return { maskKey: maskKey, maskUrl: maskUrl, maskHeaders: maskHeaders, scrub: scrub };
});
