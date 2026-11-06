/*
 * KUCGU client。
 *
 * 統一入口 request(method, path, {headers, query, body})，回傳紀錄物件（不拋錯）：
 *   { ok, status, durationMs, request(已遮罩), response({text, json}), error }
 * key 與認證方式都從 localStorage 讀取，程式碼裡沒有任何 key。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Kucgu = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const Http = typeof require === 'function' ? require('./http.js') : root.Http;

  const BASE_URL = 'https://kucgu.replit.app';
  const KEY_STORAGE = 'kucgu_api_key';
  const AUTH_STORAGE = 'kucgu_auth_mode'; // 'header'（預設）或 'query'
  const TIMEOUT_MS = 30000;

  const defaultStorage = {
    get(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { root.localStorage.removeItem(k); return true; } catch (e) { return false; } }
  };
  let storage = defaultStorage;
  function setStorage(s) { storage = s || defaultStorage; } // 測試用

  const getKey = () => storage.get(KEY_STORAGE) || '';
  const hasKey = () => getKey() !== '';
  const setKey = (v) => storage.set(KEY_STORAGE, v);
  const clearKey = () => storage.remove(KEY_STORAGE);

  const getAuthMode = () => (storage.get(AUTH_STORAGE) === 'query' ? 'query' : 'header');
  function setAuthMode(mode) {
    if (mode !== 'header' && mode !== 'query') return false;
    return storage.set(AUTH_STORAGE, mode);
  }

  /** 回傳「含 key」的實際網址，只能用來送出請求，不可顯示或記錄。 */
  function buildUrl(path, query, apiKeyForQuery) {
    if (typeof path !== 'string' || !/^\/[^/\\]/.test(path)) {
      throw new Error('KUCGU path 必須以單一 / 開頭');
    }
    const u = new URL(path, BASE_URL);
    if (u.origin !== new URL(BASE_URL).origin) throw new Error('KUCGU path 不可指向其他網域');
    Object.keys(query || {}).forEach((k) => u.searchParams.set(k, String(query[k])));
    if (apiKeyForQuery) u.searchParams.set('api_key', apiKeyForQuery);
    return u.toString();
  }

  /**
   * @param {string} method
   * @param {string} path 例如 '/mission/hello'
   * @param {{headers?:Object, query?:Object, body?:any, timeoutMs?:number, signal?:AbortSignal,
   *          fetchImpl?:Function}} [opts]
   */
  async function request(method, path, opts) {
    opts = opts || {};
    const key = getKey();
    if (!key) {
      return Http.localFailure({ kind: 'no_key', message: '尚未設定 KUCGU API key，沒有送出請求' }, 'kucgu');
    }
    const mode = getAuthMode();
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (mode === 'header') headers['X-API-Key'] = key; // 放最後，呼叫端不能覆蓋

    const rec = await Http.send({
      method: method,
      url: buildUrl(path, opts.query, mode === 'query' ? key : null),
      headers: headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs || TIMEOUT_MS,
      signal: opts.signal,
      secrets: [key],
      service: 'kucgu',
      fetchImpl: opts.fetchImpl
    });
    rec.authMode = mode;
    return rec;
  }

  return {
    BASE_URL: BASE_URL, KEY_STORAGE: KEY_STORAGE, AUTH_STORAGE: AUTH_STORAGE, TIMEOUT_MS: TIMEOUT_MS,
    getKey: getKey, hasKey: hasKey, setKey: setKey, clearKey: clearKey,
    getAuthMode: getAuthMode, setAuthMode: setAuthMode,
    buildUrl: buildUrl, request: request, setStorage: setStorage
  };
});
