/*
 * KUCGU client 骨架。
 *
 * 這個檔案只有基礎設施：base URL、key 讀寫、統一的 request 函式與錯誤分類。
 * 沒有任何 KUCGU endpoint。規格尚未提供，所以下面所有 TODO 都要等規格確認後才能填，
 * 不要自行猜測路徑、驗證方式或回應格式。
 *
 * 使用一般 <script> 載入（不用 ES module），因為從 file:// 直接開啟時，
 * 瀏覽器會擋掉 module 的載入。
 */
(function (global) {
  'use strict';

  // TODO(KUCGU 規格): 填入正式 base URL。空字串代表「尚未設定」，request() 會直接拒絕。
  const BASE_URL = '';

  // key 存放在 localStorage 的欄位名稱。key 本身不會出現在任何檔案裡。
  const KEY_STORAGE = 'kucgu_api_key';

  const DEFAULT_TIMEOUT_MS = 10000;

  class KucguError extends Error {
    /**
     * @param {string} kind not_configured | no_key | unauthorized | forbidden | not_found |
     *                      rate_limit | server | http | network | timeout | aborted | bad_response
     * @param {string} message 給開發者看的描述，不可包含 key 或含 key 的 URL
     * @param {number} [status] HTTP 狀態碼
     */
    constructor(kind, message, status) {
      super(message);
      this.name = 'KucguError';
      this.kind = kind;
      this.status = status;
    }
  }

  function getKey() {
    try {
      return localStorage.getItem(KEY_STORAGE) || '';
    } catch (e) {
      return '';
    }
  }

  function hasKey() {
    return getKey() !== '';
  }

  /** @returns {boolean} 是否真的寫入成功（localStorage 可能被停用） */
  function setKey(value) {
    try {
      localStorage.setItem(KEY_STORAGE, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearKey() {
    try {
      localStorage.removeItem(KEY_STORAGE);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 把 key 套用到請求上。
   * TODO(KUCGU 規格): 驗證方式未知（Authorization header、自訂 header、或 query 參數）。
   * 在規格確認前這裡一律拋錯，避免送出格式錯誤的請求，或把 key 放到錯誤的位置。
   * 注意：加上自訂 header 會觸發 CORS preflight，伺服器端必須允許。
   */
  // eslint-disable-next-line no-unused-vars
  function applyAuth(headers, url, key) {
    throw new KucguError('not_configured', 'KUCGU 驗證方式尚未定義（TODO）');
  }

  /**
   * 統一的請求函式。所有 KUCGU 呼叫都應該走這裡。
   * 成功時回傳解析後的內容（JSON 或文字）。失敗時一律拋出 KucguError，不回傳假資料。
   *
   * @param {string} path 以 / 開頭的相對路徑
   * @param {{method?: string, query?: Object, body?: any, headers?: Object,
   *          timeoutMs?: number, signal?: AbortSignal}} [options]
   */
  async function request(path, options) {
    const opts = options || {};

    if (!BASE_URL) {
      throw new KucguError('not_configured', 'KUCGU base URL 尚未設定（TODO）');
    }
    const key = getKey();
    if (!key) {
      throw new KucguError('no_key', '尚未設定 KUCGU API key');
    }

    const url = new URL(path, BASE_URL);
    if (opts.query) {
      Object.keys(opts.query).forEach(function (k) {
        url.searchParams.set(k, String(opts.query[k]));
      });
    }

    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    applyAuth(headers, url, key);

    const init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body !== undefined) {
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      if (!('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    init.signal = controller.signal;

    try {
      let res;
      try {
        res = await fetch(url.toString(), init);
      } catch (e) {
        if (timedOut) throw new KucguError('timeout', 'KUCGU 請求逾時');
        if (e && e.name === 'AbortError') throw new KucguError('aborted', 'KUCGU 請求已取消');
        throw new KucguError('network', 'KUCGU 網路錯誤');
      }

      if (!res.ok) {
        const s = res.status;
        // 錯誤訊息只放狀態碼，不放 URL，避免 key 外洩到畫面或 console。
        if (s === 401) throw new KucguError('unauthorized', 'KUCGU 回應 401', s);
        if (s === 403) throw new KucguError('forbidden', 'KUCGU 回應 403', s);
        if (s === 404) throw new KucguError('not_found', 'KUCGU 回應 404', s);
        if (s === 429) throw new KucguError('rate_limit', 'KUCGU 回應 429', s);
        if (s >= 500) throw new KucguError('server', 'KUCGU 回應 ' + s, s);
        throw new KucguError('http', 'KUCGU 回應 ' + s, s);
      }

      try {
        const type = res.headers.get('content-type') || '';
        return type.indexOf('application/json') !== -1 ? await res.json() : await res.text();
      } catch (e) {
        if (timedOut) throw new KucguError('timeout', 'KUCGU 讀取回應逾時');
        throw new KucguError('bad_response', 'KUCGU 回應內容無法解析');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // TODO(KUCGU 規格): 規格提供後，在這裡新增具名函式，內部呼叫 request()。
  // 目前刻意不放任何 endpoint。

  global.Kucgu = {
    BASE_URL: BASE_URL,
    KEY_STORAGE: KEY_STORAGE,
    KucguError: KucguError,
    getKey: getKey,
    hasKey: hasKey,
    setKey: setKey,
    clearKey: clearKey,
    request: request
  };
})(window);
