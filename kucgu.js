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

  const DEFAULT_BASE_URL = 'https://kucgu.replit.app';
  const BASE_URL_STORAGE = 'kucgu_base_url';
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

  /**
   * 驗證並正規化伺服器網址：必須是 https，去掉結尾斜線，不可含帳密、? 或 #。
   * @returns {{ok:true,value:string}|{ok:false,message:string}}
   */
  function normalizeBaseUrl(input) {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (raw === '') return { ok: false, message: '請輸入伺服器網址。' };
    if (!/^https:\/\//i.test(raw)) return { ok: false, message: '網址必須以 https:// 開頭。' };
    let u;
    try { u = new URL(raw); } catch (e) { return { ok: false, message: '網址格式不正確。' }; }
    if (!u.hostname) return { ok: false, message: '網址格式不正確。' };
    if (u.username || u.password) return { ok: false, message: '網址不可包含帳號或密碼。' };
    if (u.search || u.hash || /[?#]/.test(raw)) return { ok: false, message: '網址不可包含 ? 或 # 之後的內容。' };
    return { ok: true, value: u.origin + u.pathname.replace(/\/+$/, '') };
  }

  /** 目前生效的網址。沒設定就用預設；設定值壞掉時回傳錯誤，不悄悄改用預設。 */
  function resolveBaseUrl() {
    const stored = storage.get(BASE_URL_STORAGE);
    if (stored === null || stored === '') return { ok: true, value: DEFAULT_BASE_URL };
    return normalizeBaseUrl(stored);
  }
  function getBaseUrl() {
    const r = resolveBaseUrl();
    return r.ok ? r.value : DEFAULT_BASE_URL;
  }
  const isDefaultBaseUrl = () => getBaseUrl() === DEFAULT_BASE_URL && resolveBaseUrl().ok;

  /** 驗證通過才儲存。 */
  function setBaseUrl(input) {
    const r = normalizeBaseUrl(input);
    if (!r.ok) return r;
    if (!storage.set(BASE_URL_STORAGE, r.value)) {
      return { ok: false, message: '瀏覽器不允許寫入 localStorage，網址沒有儲存。' };
    }
    return r;
  }
  const clearBaseUrl = () => storage.remove(BASE_URL_STORAGE);

  /** 回傳「含 key」的實際網址，只能用來送出請求，不可顯示或記錄。 */
  function buildUrl(path, query, apiKeyForQuery, base) {
    if (typeof path !== 'string' || !/^\/[^/\\]/.test(path)) {
      throw new Error('KUCGU path 必須以單一 / 開頭');
    }
    const baseUrl = base || getBaseUrl();
    const u = new URL(baseUrl + path);
    if (u.origin !== new URL(baseUrl).origin) throw new Error('KUCGU path 不可指向其他網域');
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
    const base = resolveBaseUrl();
    if (!base.ok) {
      return Http.localFailure({ kind: 'bad_base_url', message: '伺服器網址設定不正確：' + base.message }, 'kucgu');
    }
    if (!key) {
      return Http.localFailure({ kind: 'no_key', message: '尚未設定 KUCGU API key，沒有送出請求' }, 'kucgu');
    }
    const mode = getAuthMode();
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (mode === 'header') headers['X-API-Key'] = key; // 放最後，呼叫端不能覆蓋

    const rec = await Http.send({
      method: method,
      url: buildUrl(path, opts.query, mode === 'query' ? key : null, base.value),
      headers: headers,
      body: opts.body,
      timeoutMs: opts.timeoutMs || TIMEOUT_MS,
      signal: opts.signal,
      secrets: [key],
      service: 'kucgu',
      fetchImpl: opts.fetchImpl
    });
    rec.authMode = mode;
    rec.baseUrl = base.value;
    rec.usingDefaultBase = base.value === DEFAULT_BASE_URL;
    return rec;
  }

  return {
    DEFAULT_BASE_URL: DEFAULT_BASE_URL, BASE_URL_STORAGE: BASE_URL_STORAGE, KEY_STORAGE: KEY_STORAGE, AUTH_STORAGE: AUTH_STORAGE, TIMEOUT_MS: TIMEOUT_MS,
    getKey: getKey, hasKey: hasKey, setKey: setKey, clearKey: clearKey,
    getAuthMode: getAuthMode, setAuthMode: setAuthMode,
    normalizeBaseUrl: normalizeBaseUrl, getBaseUrl: getBaseUrl, resolveBaseUrl: resolveBaseUrl, setBaseUrl: setBaseUrl, clearBaseUrl: clearBaseUrl,
    isDefaultBaseUrl: isDefaultBaseUrl, buildUrl: buildUrl, request: request, setStorage: setStorage
  };
});
