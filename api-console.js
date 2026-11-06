/*
 * API Console：記錄並顯示每一次呼叫（KUCGU 與 OpenWeatherMap）。
 * 紀錄只存在記憶體（最近 20 筆），不寫 localStorage、不寫 console。
 * 收到的紀錄物件已經在 http.js 遮罩過，這裡只負責顯示（一律用 textContent）。
 */
(function (root) {
  'use strict';

  const MAX_ENTRIES = 20;
  const MAX_RAW_CHARS = 20000;
  const TITLES = (root.Challenges && root.Challenges.STEP_TITLES) || {};

  let entries = [];
  let seq = 0;
  let lastScore = null; // 只來自 KUCGU「伺服器最後一次回應」的 total_score，前端不自己算
  const listeners = [];

  function el(tag, attrs) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    const add = function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    };
    for (let i = 2; i < arguments.length; i++) add(arguments[i]);
    return node;
  }

  function add(rec) {
    seq += 1;
    entries.unshift({ n: seq, rec: rec });
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    const j = rec.response && rec.response.json;
    if (rec.service === 'kucgu' && j && typeof j === 'object' && Number.isFinite(j.total_score)) {
      lastScore = { value: j.total_score, step: rec.step, at: rec.at };
    }
    notify();
  }
  function clear() { entries = []; notify(); }
  function notify() { listeners.forEach(function (fn) { fn(); }); render(); }
  function subscribe(fn) { listeners.push(fn); }

  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }
  function clip(s) {
    return s.length > MAX_RAW_CHARS ? s.slice(0, MAX_RAW_CHARS) + '\n…（已截斷，共 ' + s.length + ' 字元）' : s;
  }
  function clock(iso) {
    const d = new Date(iso);
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function fieldRow(label, value) {
    return el('div', null, el('dt', null, label), el('dd', null, String(value)));
  }

  function renderEntry(e, open) {
    const rec = e.rec;
    const ok = rec.outcome === 'success';
    const title = TITLES[rec.step] || rec.step || '呼叫';
    const j = rec.response && rec.response.json && typeof rec.response.json === 'object' ? rec.response.json : null;

    // Request
    let reqNode;
    if (!rec.request) {
      reqNode = el('p', { class: 'con-none' }, '未送出任何請求（前置檢查未通過，或沒有 key）。');
    } else {
      const headerLines = Object.keys(rec.request.headers).map(function (k) { return k + ': ' + rec.request.headers[k]; });
      const parts = [rec.request.method + ' ' + rec.request.url]
        .concat(headerLines.length ? ['', 'Headers'].concat(headerLines) : [])
        .concat(rec.request.body != null ? ['', 'Body', pretty(rec.request.body)] : []);
      reqNode = el('pre', { class: 'con-pre' }, parts.join('\n'));
    }

    // Response
    const resHead = rec.status != null
      ? 'HTTP ' + rec.status + '，耗時 ' + rec.durationMs + ' ms'
      : '沒有收到 HTTP 回應，耗時 ' + rec.durationMs + ' ms';
    const facts = [];
    if (j) {
      if ('status' in j) facts.push(fieldRow('status', j.status));
      if ('message' in j) facts.push(fieldRow('message', j.message));
      if ('pts_earned' in j) facts.push(fieldRow('pts_earned', j.pts_earned));
      if ('total_score' in j) facts.push(fieldRow('total_score', j.total_score));
    }
    const rawText = rec.response ? clip(rec.response.json !== undefined ? pretty(rec.response.text) : rec.response.text) : '';

    const body = el('div', { class: 'con-body' },
      el('h4', null, 'Request'), reqNode,
      el('h4', null, 'Response'),
      el('p', { class: 'con-line' }, resHead),
      rec.error ? el('p', { class: 'con-err' }, '錯誤（' + rec.error.kind + '）：' + rec.error.message) : null,
      facts.length ? el('dl', { class: 'con-facts' }, facts) : null,
      rec.response ? el('details', { class: 'con-raw' }, el('summary', null, '原始回應'), el('pre', { class: 'con-pre' }, rawText === '' ? '（空）' : rawText)) : null,
      el('h4', null, 'Next Action'),
      el('p', { class: 'con-next' }, rec.nextAction || ''));

    return el('li', { class: 'con-entry' },
      el('details', { open: open },
        el('summary', null,
          el('span', { class: 'con-n' }, '#' + e.n),
          ' ', title, ' ',
          el('span', { class: 'con-time' }, clock(rec.at)),
          ' ',
          el('span', { class: 'con-badge ' + (ok ? 'is-ok' : 'is-fail') }, ok ? '成功' : '失敗')),
        body));
  }

  function render() {
    const host = document.getElementById('console-root');
    if (!host) return;
    host.replaceChildren(
      el('div', { class: 'con-head' },
        el('h3', null, 'API Console'),
        el('span', { class: 'con-count' }, entries.length + ' / ' + MAX_ENTRIES + ' 筆（只存在記憶體）'),
        el('button', { type: 'button', class: 'btn', disabled: entries.length === 0, onclick: clear }, '清除')),
      entries.length === 0
        ? el('p', { class: 'con-none' }, '尚無呼叫紀錄。按下上方步驟的按鈕後，每次呼叫的 Request、Response 與 Next Action 會顯示在這裡。')
        : el('ol', { class: 'con-list' }, entries.map(function (e, i) { return renderEntry(e, i === 0); })));
  }

  root.ApiConsole = {
    add: add, clear: clear, subscribe: subscribe, render: render, el: el,
    getLastScore: function () { return lastScore; },
    count: function () { return entries.length; },
    MAX_ENTRIES: MAX_ENTRIES
  };
})(window);
