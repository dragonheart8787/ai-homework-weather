/*
 * 共用的 HTTP 傳輸層（KUCGU 與 OpenWeatherMap 都走這裡）。
 *
 * 規則：
 * 1. send() 永遠不拋錯，一律回傳紀錄物件，失敗時 ok=false 並帶 error。
 * 2. 紀錄裡的 request 與 response 在建立當下就已經遮罩，呼叫端與顯示層拿不到未遮罩的 key。
 * 3. 不使用 console.log 輸出任何請求內容。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Http = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const Mask = typeof require === 'function' ? require('./mask.js') : root.Mask;
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const hasHeader = (h, name) => Object.keys(h).some((k) => k.toLowerCase() === name);

  function maskedRequest(method, url, headers, bodyText, secrets) {
    const mh = Mask.maskHeaders(headers);
    Object.keys(mh).forEach((k) => { mh[k] = Mask.scrub(mh[k], secrets); });
    return {
      method: method,
      url: Mask.scrub(Mask.maskUrl(url), secrets),
      headers: mh,
      body: bodyText == null ? null : Mask.scrub(bodyText, secrets)
    };
  }

  /** 沒有送出任何請求就失敗（前置檢查、沒有 key 等）。 */
  function localFailure(error, service, step) {
    return {
      ok: false, status: null, durationMs: 0, at: new Date().toISOString(),
      service: service || 'local', step: step || '', outcome: 'failure',
      request: null, response: null, error: error
    };
  }

  function classify(e, timedOut, timeoutMs, secrets) {
    if (timedOut) return { kind: 'timeout', message: '逾時（超過 ' + Math.round(timeoutMs / 1000) + ' 秒沒有回應）' };
    const msg = Mask.scrub(String((e && e.message) || e), secrets);
    if (e && e.name === 'AbortError') return { kind: 'aborted', message: '請求已取消' };
    if (e && e.name === 'TypeError') return { kind: 'network', name: 'TypeError', message: 'TypeError: ' + msg };
    return { kind: 'exception', name: (e && e.name) || 'Error', message: msg };
  }

  /**
   * @param {{method?:string, url:string, headers?:Object, body?:any, timeoutMs?:number,
   *          signal?:AbortSignal, secrets?:string[], service?:string, fetchImpl?:Function}} opts
   * @returns {Promise<{ok:boolean,status:number|null,durationMs:number,at:string,service:string,
   *   request:{method:string,url:string,headers:Object,body:string|null},
   *   response:null|{text:string,json:any},
   *   error:null|{kind:string,message:string}}>}
   */
  async function send(opts) {
    const secrets = (opts.secrets || []).filter(Boolean);
    const method = (opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});
    const timeoutMs = opts.timeoutMs || 30000;

    let bodyText = null;
    if (opts.body !== undefined && opts.body !== null) {
      bodyText = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      if (typeof opts.body !== 'string' && !hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    }

    const record = {
      ok: false, status: null, durationMs: 0, at: new Date().toISOString(),
      service: opts.service || '', step: '', outcome: 'failure',
      request: maskedRequest(method, opts.url, headers, bodyText, secrets), // 先遮罩，再發送
      response: null, error: null
    };

    const fetchImpl = opts.fetchImpl || ((u, i) => root.fetch(u, i));
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const t0 = now();

    try {
      let res;
      try {
        res = await fetchImpl(opts.url, {
          method: method, headers: headers, body: bodyText == null ? undefined : bodyText,
          cache: 'no-store', signal: ctrl.signal
        });
      } catch (e) {
        record.error = classify(e, timedOut, timeoutMs, secrets);
        return record;
      }

      record.status = res.status;
      let text;
      try {
        text = await res.text();
      } catch (e) {
        record.error = classify(e, timedOut, timeoutMs, secrets);
        return record;
      }

      const scrubbed = Mask.scrub(text, secrets);
      let json;
      try { json = JSON.parse(scrubbed); } catch (e) { json = undefined; }
      record.response = { text: scrubbed, json: json };

      if (!res.ok) {
        record.error = { kind: 'http', message: 'HTTP ' + res.status };
      } else if (json === undefined) {
        record.error = { kind: 'not_json', message: '回應不是有效的 JSON' };
      } else {
        record.ok = true;
      }
      return record;
    } finally {
      clearTimeout(timer);
      record.durationMs = Math.round(now() - t0);
    }
  }

  return { send: send, localFailure: localFailure };
});
