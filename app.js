(function () {
  'use strict';

  /* ---------- 常數與儲存 ---------- */

  const OWM_BASE = 'https://api.openweathermap.org';
  const TIMEOUT_MS = 10000;
  const MAX_RECENT = 5;
  const STORE = { owmKey: 'owm_api_key', unit: 'weather_unit', recent: 'weather_recent' };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }
  };

  const state = {
    unit: store.get(STORE.unit) === 'imperial' ? 'imperial' : 'metric',
    current: null,
    forecast: null,
    place: null,
    seq: 0,          // 每次新的載入加一，舊請求回來時用來丟棄結果
    controller: null // 目前進行中請求的取消控制器
  };

  const $ = (id) => document.getElementById(id);
  const view = $('view');

  /* ---------- DOM 小工具（一律用 textContent，避免 API 回傳內容造成 XSS） ---------- */

  function h(tag, attrs) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach((c) => append(el, c));
    else el.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child)) : child);
  }
  function setView(node, busy) {
    view.replaceChildren(node);
    view.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  /* ---------- 錯誤 ---------- */

  class ApiError extends Error {
    constructor(kind, status) {
      super(kind);
      this.name = 'ApiError';
      this.kind = kind;
      this.status = status;
    }
  }

  function describeError(err) {
    const k = err && err.kind;
    const msgs = {
      no_key: ['尚未設定 API key', '請按右上角的「設定」，輸入 OpenWeatherMap API key。'],
      invalid_key: ['API key 無效，或尚未生效（401）',
        '請到「設定」確認 key 有沒有貼錯。新申請的 key 通常要等幾十分鐘到數小時才會啟用，期間一律會回傳 401。'],
      not_found: ['找不到這個城市（404）', '請檢查拼字，或改用英文名稱再試一次。'],
      rate_limit: ['已超過呼叫頻率上限（429）', '請等一分鐘後再試。免費方案有每分鐘與每日的次數限制。'],
      network: ['無法連線到 OpenWeatherMap', '請檢查網路連線。如果網路正常，可能是廣告攔截器、防火牆或公司網路擋住了 api.openweathermap.org。'],
      timeout: ['請求逾時', '超過 ' + (TIMEOUT_MS / 1000) + ' 秒沒有收到回應，請稍後再試。'],
      server: ['OpenWeatherMap 伺服器發生錯誤（' + (err && err.status) + '）', '這通常是對方暫時的問題，請稍後再試。'],
      http: ['請求失敗（HTTP ' + (err && err.status) + '）', '伺服器回傳了未預期的狀態碼。'],
      bad_response: ['收到的資料格式不符預期', '為了避免顯示錯誤資訊，這次不顯示任何天氣資料。請稍後再試。']
    };
    if (msgs[k]) return { title: msgs[k][0], body: msgs[k][1] };
    console.error(err);
    return { title: '發生未預期的錯誤', body: String((err && err.message) || err) };
  }

  /* ---------- 網路層：所有 fetch 都經過這裡 ---------- */

  async function fetchJson(url, signal) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    try {
      let res;
      try {
        res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      } catch (e) {
        if (timedOut) throw new ApiError('timeout');
        if (e && e.name === 'AbortError') throw new ApiError('aborted');
        throw new ApiError('network');
      }
      if (!res.ok) {
        const s = res.status;
        if (s === 401) throw new ApiError('invalid_key', s);
        if (s === 404) throw new ApiError('not_found', s);
        if (s === 429) throw new ApiError('rate_limit', s);
        if (s >= 500) throw new ApiError('server', s);
        throw new ApiError('http', s);
      }
      try {
        return await res.json();
      } catch (e) {
        if (timedOut) throw new ApiError('timeout');
        if (e && e.name === 'AbortError') throw new ApiError('aborted');
        throw new ApiError('bad_response');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // 注意：URL 內含 key，所以任何錯誤訊息都不可印出 URL。
  function owmUrl(path, params) {
    const key = store.get(STORE.owmKey);
    if (!key) throw new ApiError('no_key');
    const u = new URL(OWM_BASE + path);
    Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
    u.searchParams.set('appid', key);
    return u.toString();
  }

  async function geocode(q, signal) {
    const data = await fetchJson(owmUrl('/geo/1.0/direct', { q: q, limit: 5 }), signal);
    if (!Array.isArray(data)) throw new ApiError('bad_response');
    return data.filter((g) => g && Number.isFinite(g.lat) && Number.isFinite(g.lon) && g.name);
  }

  async function fetchWeather(lat, lon, signal) {
    const p = { lat: lat, lon: lon, units: 'metric', lang: 'zh_tw' };
    const [current, forecast] = await Promise.all([
      fetchJson(owmUrl('/data/2.5/weather', p), signal),
      fetchJson(owmUrl('/data/2.5/forecast', p), signal)
    ]);
    if (!current || !current.main || !Number.isFinite(current.main.temp)
        || !Array.isArray(current.weather) || !current.weather.length
        || !Number.isFinite(current.dt)) throw new ApiError('bad_response');
    if (!forecast || !Array.isArray(forecast.list) || !forecast.list.length) throw new ApiError('bad_response');
    return { current, forecast };
  }

  /* ---------- 單位與格式 ---------- */

  const imperial = () => state.unit === 'imperial';
  const tempVal = (c) => Math.round(imperial() ? c * 9 / 5 + 32 : c);
  const tempStr = (c) => tempVal(c) + '°';
  const pad = (n) => String(n).padStart(2, '0');

  function windStr(ms, deg) {
    const v = imperial() ? ms * 2.23694 : ms;
    const unit = imperial() ? 'mph' : 'm/s';
    const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    const dir = Number.isFinite(deg) ? dirs[Math.round(deg / 45) % 8] + '風 ' : '';
    return dir + v.toFixed(1) + ' ' + unit;
  }
  function clock(dt, tz) {
    if (!Number.isFinite(dt)) return '無資料';
    const d = new Date((dt + tz) * 1000);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  const dayKey = (dt, tz) => new Date((dt + tz) * 1000).toISOString().slice(0, 10);

  /* ---------- 簡單 SVG 圖示（自己畫，無外部套件） ---------- */

  const CLOUD = 'M14 36a8 8 0 0 1-1-15.9A11 11 0 0 1 34 17a9.5 9.5 0 0 1 1 19z';
  const ICONS = {
    sun: '<circle cx="24" cy="24" r="8"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>',
    moon: '<path d="M30 8a16 16 0 1 0 10 28A13 13 0 0 1 30 8z"/>',
    partly: '<circle cx="17" cy="16" r="6"/><path d="M17 3v3M5 16h3M8.5 7.5l2 2M25.5 7.5l-2 2"/><path fill="var(--paper)" d="M16 40a7 7 0 0 1-1-14 10 10 0 0 1 19-2 8.5 8.5 0 0 1 1 16z"/>',
    cloud: '<path d="' + CLOUD + '"/>',
    rain: '<path d="M14 30a8 8 0 0 1-1-15.9A11 11 0 0 1 34 11a9.5 9.5 0 0 1 1 19z"/><path d="M16 35l-2 6M25 35l-2 6M34 35l-2 6"/>',
    snow: '<path d="M14 30a8 8 0 0 1-1-15.9A11 11 0 0 1 34 11a9.5 9.5 0 0 1 1 19z"/><path d="M16 36v6M13 39h6M26 36v6M23 39h6M36 36v6M33 39h6"/>',
    thunder: '<path d="M14 30a8 8 0 0 1-1-15.9A11 11 0 0 1 34 11a9.5 9.5 0 0 1 1 19z"/><path d="M26 30l-6 8h6l-4 8"/>',
    mist: '<path d="M8 14h32M12 22h28M8 30h32M14 38h26"/>'
  };
  function iconName(id, icon) {
    const night = typeof icon === 'string' && icon.slice(-1) === 'n';
    if (id >= 200 && id < 300) return 'thunder';
    if (id >= 300 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'mist';
    if (id === 800) return night ? 'moon' : 'sun';
    if (id === 801 || id === 802) return 'partly';
    return 'cloud';
  }
  function svgIcon(id, icon) {
    const wrap = document.createElement('span');
    wrap.innerHTML = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
      + ICONS[iconName(id, icon)] + '</svg>'; // 內容全是上面的常數，不含 API 資料
    return wrap.firstChild;
  }

  /* ---------- 畫面：訊息、引導、骨架 ---------- */

  function showMessage(kind, title, body, extra) {
    const node = h('section', { class: 'msg' + (kind === 'error' ? ' msg-error' : ''),
      role: kind === 'error' ? 'alert' : null },
      h('h2', null, title), body ? h('p', null, body) : null, extra);
    setView(node, false);
  }
  function showError(err) {
    const d = describeError(err);
    const extra = (err && (err.kind === 'invalid_key' || err.kind === 'no_key'))
      ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openSettings(true) }, '開啟設定'))
      : null;
    showMessage('error', d.title, d.body, extra);
  }
  function showGuide() {
    showMessage('info', '開始之前，需要一把 OpenWeatherMap API key',
      '這個頁面不內建任何 key，所以在你輸入之前不會顯示天氣。',
      h('div', null,
        h('ol', null,
          h('li', null, '到 openweathermap.org 註冊帳號，並在 API keys 頁面取得 key。'),
          h('li', null, '按右上角「設定」，把 key 貼進去並儲存。'),
          h('li', null, '新 key 可能要等一段時間才會生效，生效前會看到 401 的提示。')),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openSettings(true) }, '開啟設定'))));
  }
  function showEmpty() {
    showMessage('info', '輸入城市名稱開始查詢', '可以輸入中文或英文城市名，也可以按「使用目前位置」。');
  }
  function showSkeleton() {
    const line = (cls) => h('div', { class: 'sk ' + cls });
    const node = h('div', { 'aria-label': '載入中', role: 'status' },
      h('section', { class: 'current' },
        line('sk-title'), line('sk-sub'),
        h('div', { class: 'sk-hero' }, line('sk-icon'), line('sk-temp')),
        h('div', { class: 'sk-facts' }, line('sk-fact'), line('sk-fact'), line('sk-fact'), line('sk-fact'), line('sk-fact'), line('sk-fact'))),
      h('section', { class: 'forecast' },
        line('sk-row'), line('sk-row'), line('sk-row'), line('sk-row'), line('sk-row')));
    setView(node, true);
  }

  /* ---------- 天氣畫面 ---------- */

  function buildDaily(forecast) {
    const tz = Number.isFinite(forecast.city && forecast.city.timezone) ? forecast.city.timezone : 0;
    const days = new Map();
    forecast.list.forEach((it) => {
      if (!it || !Number.isFinite(it.dt) || !it.main || !Number.isFinite(it.main.temp_min)
          || !Number.isFinite(it.main.temp_max) || !Array.isArray(it.weather) || !it.weather.length) return;
      const key = dayKey(it.dt, tz);
      const hour = new Date((it.dt + tz) * 1000).getUTCHours();
      let d = days.get(key);
      if (!d) { d = { key: key, min: Infinity, max: -Infinity, pick: null, dist: 99 }; days.set(key, d); }
      d.min = Math.min(d.min, it.main.temp_min);
      d.max = Math.max(d.max, it.main.temp_max);
      const dist = Math.abs(hour - 12); // 用最接近中午的那一筆代表當天天氣
      if (dist < d.dist) { d.dist = dist; d.pick = it.weather[0]; }
    });
    return Array.from(days.values()).slice(0, 5);
  }

  function renderWeather() {
    const c = state.current;
    const tz = Number.isFinite(c.timezone) ? c.timezone : 0;
    const w = c.weather[0];
    const m = c.main;
    const sys = c.sys || {};
    const name = (state.place && state.place.label) || c.name || '目前位置';
    const sub = [sys.country, '資料時間 ' + clock(c.dt, tz) + '（當地）'].filter(Boolean).join('，');
    const todayKey = dayKey(c.dt, tz);
    const WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

    const fact = (label, value) => h('div', null, h('dt', null, label), h('dd', null, value));
    const current = h('section', { class: 'current', 'aria-labelledby': 'place' },
      h('h2', { class: 'place', id: 'place' }, name),
      h('p', { class: 'place-sub' }, sub),
      h('div', { class: 'hero' },
        svgIcon(w.id, w.icon),
        h('div', null,
          h('div', { class: 'temp' }, String(tempVal(m.temp)), h('small', null, imperial() ? '°F' : '°C')),
          h('p', { class: 'desc' }, w.description || ''))),
      h('dl', { class: 'facts' },
        fact('體感溫度', Number.isFinite(m.feels_like) ? tempStr(m.feels_like) : '無資料'),
        fact('濕度', Number.isFinite(m.humidity) ? m.humidity + '%' : '無資料'),
        fact('風速', c.wind && Number.isFinite(c.wind.speed) ? windStr(c.wind.speed, c.wind.deg) : '無資料'),
        fact('氣壓', Number.isFinite(m.pressure) ? m.pressure + ' hPa' : '無資料'),
        fact('日出', clock(sys.sunrise, tz)),
        fact('日落', clock(sys.sunset, tz))));

    const daily = buildDaily(state.forecast);
    let forecast;
    if (!daily.length) {
      forecast = h('section', { class: 'forecast' }, h('h2', null, '5 天預報'),
        h('p', { class: 'msg msg-error', role: 'alert' }, '預報資料格式不符預期，無法整理成每日高低溫。'));
    } else {
      forecast = h('section', { class: 'forecast', 'aria-labelledby': 'fc-title' },
        h('h2', { id: 'fc-title' }, '5 天預報'),
        h('ul', { class: 'days' }, daily.map((d) => {
          const date = new Date(d.key + 'T00:00:00Z');
          const label = d.key === todayKey ? '今天' : WEEK[date.getUTCDay()];
          return h('li', { class: 'day' },
            h('div', { class: 'day-name' }, label,
              h('span', { class: 'day-date' }, (date.getUTCMonth() + 1) + '/' + date.getUTCDate())),
            svgIcon(d.pick.id, d.pick.icon),
            h('div', { class: 'day-desc' }, d.pick.description || ''),
            h('div', { class: 'day-temps' }, h('span', { class: 'hi' }, tempStr(d.max)),
              h('span', { class: 'lo' }, tempStr(d.min))));
        })),
        h('p', { class: 'note' }, '高低溫由每 3 小時一筆的預報整理而成，今天只涵蓋剩下的時段。'));
    }

    setView(h('div', null, current, forecast), false);
  }

  /* ---------- 流程 ---------- */

  function beginRequest() {
    if (state.controller) state.controller.abort();
    state.controller = new AbortController();
    state.seq += 1;
    return { seq: state.seq, signal: state.controller.signal };
  }

  function requireKey() {
    if (store.get(STORE.owmKey)) return true;
    showGuide();
    return false;
  }

  async function loadPlace(place) {
    if (!requireKey()) return;
    const req = beginRequest();
    showSkeleton();
    try {
      const data = await fetchWeather(place.lat, place.lon, req.signal);
      if (req.seq !== state.seq) return;
      state.place = place;
      state.current = data.current;
      state.forecast = data.forecast;
      renderWeather();
      saveRecent({
        label: place.label || data.current.name || '目前位置',
        country: (data.current.sys && data.current.sys.country) || place.country || '',
        lat: place.lat, lon: place.lon
      });
    } catch (err) {
      if (req.seq !== state.seq || (err && err.kind === 'aborted')) return;
      state.current = state.forecast = null;
      showError(err);
    }
  }

  const hasCjk = (s) => /[㐀-鿿]/.test(s);

  async function search(q) {
    q = q.trim();
    if (!q) {
      showMessage('error', '請先輸入城市名稱', '輸入框是空的，沒有可以查詢的內容。');
      return;
    }
    if (!requireKey()) return;
    const req = beginRequest();
    showSkeleton();
    try {
      const found = await geocode(q, req.signal);
      if (req.seq !== state.seq) return;
      if (!found.length) throw new ApiError('not_found', 404);
      const places = found.map((g) => {
        const ln = g.local_names || {};
        const zh = hasCjk(q) ? (ln.zh_tw || ln.zh || ln.zh_cn) : null;
        return { label: zh || g.name, state: g.state || '', country: g.country || '', lat: g.lat, lon: g.lon };
      });
      if (places.length === 1) { loadPlace(places[0]); return; }
      showChoices(q, places);
    } catch (err) {
      if (req.seq !== state.seq || (err && err.kind === 'aborted')) return;
      showError(err);
    }
  }

  function showChoices(q, places) {
    const list = h('ul', { class: 'choices' }, places.map((p) => h('li', null,
      h('button', { type: 'button', class: 'choice', onclick: () => loadPlace(p) },
        h('span', { class: 'choice-name' }, p.label),
        h('span', { class: 'choice-sub' },
          [p.state, p.country].filter(Boolean).join('，') + '（' + p.lat.toFixed(2) + ', ' + p.lon.toFixed(2) + '）')))));
    showMessage('info', '找到 ' + places.length + ' 個「' + q + '」的結果', '請選擇你要查詢的地點。', list);
  }

  function locate() {
    if (!requireKey()) return;
    if (!('geolocation' in navigator)) {
      showMessage('error', '這個瀏覽器不支援定位', '請改用城市名稱搜尋。');
      return;
    }
    const req = beginRequest();
    showMessage('info', '正在取得你的位置', '如果瀏覽器跳出權限詢問，請選擇允許。');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (req.seq !== state.seq) return;
        loadPlace({ label: '', lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        if (req.seq !== state.seq) return;
        const m = {
          1: ['定位權限被拒絕', '你拒絕了位置存取。要使用定位，請在瀏覽器網址列旁的網站設定中允許「位置」後再按一次；也可以直接用城市名稱搜尋。'],
          2: ['無法取得位置', '裝置無法判斷目前位置，可能是沒有 GPS 或網路定位訊號。請改用城市名稱搜尋。'],
          3: ['定位逾時', '等了 10 秒仍沒有取得位置。請再試一次，或改用城市名稱搜尋。']
        }[err.code] || ['定位失敗', err.message || '未知原因'];
        showMessage('error', m[0], m[1]);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* ---------- 最近搜尋 ---------- */

  function loadRecent() {
    try {
      const arr = JSON.parse(store.get(STORE.recent) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr.filter((r) => r && typeof r.label === 'string' && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice(0, MAX_RECENT);
    } catch (e) { return []; }
  }
  function saveRecent(entry) {
    const same = (r) => r.lat.toFixed(2) === entry.lat.toFixed(2) && r.lon.toFixed(2) === entry.lon.toFixed(2);
    const list = [entry].concat(loadRecent().filter((r) => !same(r))).slice(0, MAX_RECENT);
    store.set(STORE.recent, JSON.stringify(list)); // 寫入失敗只代表沒有紀錄功能，不影響查詢
    renderRecent();
  }
  function renderRecent() {
    const list = loadRecent();
    $('recent-wrap').hidden = list.length === 0;
    $('recent').replaceChildren.apply($('recent'), list.map((r) => h('li', null,
      h('button', { type: 'button', class: 'btn', onclick: () => loadPlace({ label: r.label, country: r.country, lat: r.lat, lon: r.lon }) },
        r.label + (r.country ? '，' + r.country : '')))));
  }

  /* ---------- 單位切換 ---------- */

  function syncUnitButtons() {
    document.querySelectorAll('[data-unit]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-unit') === state.unit));
    });
  }

  /* ---------- 設定面板 ---------- */

  function openSettings(focus) {
    $('settings').hidden = false;
    $('btn-settings').setAttribute('aria-expanded', 'true');
    if (focus) $('owm-key').focus();
    $('settings').scrollIntoView({ block: 'nearest' });
  }
  function toggleSettings() {
    const open = $('settings').hidden;
    $('settings').hidden = !open;
    $('btn-settings').setAttribute('aria-expanded', String(open));
  }
  function setStatus(id, text, isError) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }
  function refreshKeyStatus() {
    setStatus('owm-status', store.get(STORE.owmKey) ? '目前狀態：已儲存' : '目前狀態：未設定');
    setStatus('kucgu-status', window.Kucgu && Kucgu.hasKey() ? '目前狀態：已儲存' : '目前狀態：未設定');
    $('owm-key').placeholder = store.get(STORE.owmKey) ? '已儲存（基於安全不顯示）' : '貼上你的 key';
    $('kucgu-key').placeholder = window.Kucgu && Kucgu.hasKey() ? '已儲存（基於安全不顯示）' : '貼上你的 key';
  }

  function onSaveOwm(e) {
    e.preventDefault();
    const input = $('owm-key');
    const v = input.value.trim();
    if (!v) { setStatus('owm-status', '沒有輸入內容，未儲存。', true); return; }
    if (!/^[A-Za-z0-9]{16,64}$/.test(v)) {
      setStatus('owm-status', '格式看起來不對：key 應該只含英數字且至少 16 個字元，請確認有沒有多複製空白或其他符號。', true);
      return;
    }
    if (!store.set(STORE.owmKey, v)) {
      setStatus('owm-status', '瀏覽器不允許寫入 localStorage（可能是無痕模式或停用了網站資料），key 沒有儲存。', true);
      return;
    }
    input.value = '';
    refreshKeyStatus();
    setStatus('owm-status', '已儲存。');
    if (!state.current) showEmpty();
  }
  function onSaveKucgu(e) {
    e.preventDefault();
    const input = $('kucgu-key');
    const v = input.value.trim();
    if (!window.Kucgu) { setStatus('kucgu-status', 'kucgu.js 沒有載入，無法儲存。', true); return; }
    if (!v) { setStatus('kucgu-status', '沒有輸入內容，未儲存。', true); return; }
    if (/\s/.test(v)) { setStatus('kucgu-status', 'key 中不應包含空白。', true); return; }
    if (!Kucgu.setKey(v)) {
      setStatus('kucgu-status', '瀏覽器不允許寫入 localStorage，key 沒有儲存。', true);
      return;
    }
    input.value = '';
    refreshKeyStatus();
    setStatus('kucgu-status', '已儲存。');
  }

  /* ---------- 事件綁定與初始化 ---------- */

  $('btn-settings').addEventListener('click', toggleSettings);
  $('form-owm').addEventListener('submit', onSaveOwm);
  $('form-kucgu').addEventListener('submit', onSaveKucgu);
  $('owm-clear').addEventListener('click', () => {
    if (!store.remove(STORE.owmKey)) { setStatus('owm-status', '無法清除，瀏覽器拒絕存取 localStorage。', true); return; }
    state.current = state.forecast = null;
    refreshKeyStatus();
    setStatus('owm-status', '已清除。');
    showGuide();
  });
  $('kucgu-clear').addEventListener('click', () => {
    if (!window.Kucgu || !Kucgu.clearKey()) { setStatus('kucgu-status', '無法清除，瀏覽器拒絕存取 localStorage。', true); return; }
    refreshKeyStatus();
    setStatus('kucgu-status', '已清除。');
  });
  function syncAuthMode() {
    const mode = window.Kucgu ? Kucgu.getAuthMode() : 'header';
    document.querySelectorAll('[name="kucgu-auth"]').forEach((r) => { r.checked = r.value === mode; });
  }
  document.querySelectorAll('[name="kucgu-auth"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    if (!window.Kucgu || !Kucgu.setAuthMode(r.value)) {
      setStatus('kucgu-status', '無法儲存認證方式（localStorage 不可用）。', true);
      syncAuthMode();
      return;
    }
    setStatus('kucgu-status', '認證方式已切換為 ' + (r.value === 'query' ? 'Query 參數' : 'Header') + '。');
  }));
  syncAuthMode();

  /* KUCGU 伺服器網址（key 以外的設定，可以安全地回填顯示） */
  function refreshBaseUrl() {
    if (!window.Kucgu) { setStatus('kucgu-url-status', 'kucgu.js 沒有載入。', true); return; }
    const r = Kucgu.resolveBaseUrl ? Kucgu.resolveBaseUrl() : { ok: true, value: Kucgu.getBaseUrl() };
    $('kucgu-url').value = r.ok ? r.value : (localStorage.getItem(Kucgu.BASE_URL_STORAGE) || '');
    if (!r.ok) setStatus('kucgu-url-status', '已儲存的網址不正確：' + r.message, true);
    else setStatus('kucgu-url-status', Kucgu.isDefaultBaseUrl() ? '目前使用：預設網址' : '目前使用：自訂網址（代理）');
  }
  $('form-kucgu-url').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!window.Kucgu) { setStatus('kucgu-url-status', 'kucgu.js 沒有載入，無法儲存。', true); return; }
    const r = Kucgu.setBaseUrl($('kucgu-url').value);
    if (!r.ok) { setStatus('kucgu-url-status', r.message + '（沒有儲存）', true); return; }
    $('kucgu-url').value = r.value;
    setStatus('kucgu-url-status', '已儲存。' + (Kucgu.isDefaultBaseUrl() ? '目前使用預設網址。' : '之後的請求會改送到這個網址。'));
  });
  $('kucgu-url-reset').addEventListener('click', () => {
    if (!window.Kucgu || !Kucgu.clearBaseUrl()) { setStatus('kucgu-url-status', '無法恢復預設，瀏覽器拒絕存取 localStorage。', true); return; }
    refreshBaseUrl();
    setStatus('kucgu-url-status', '已恢復預設網址。');
  });

  document.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const input = $(b.getAttribute('data-reveal'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? '隱藏' : '顯示';
    b.setAttribute('aria-pressed', String(show));
  }));

  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); search($('q').value); });
  $('btn-geo').addEventListener('click', locate);
  document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    state.unit = b.getAttribute('data-unit');
    store.set(STORE.unit, state.unit);
    syncUnitButtons();
    if (state.current && state.forecast) renderWeather(); // 用已取得的資料重畫，不重打 API
  }));
  $('recent-clear').addEventListener('click', () => { store.remove(STORE.recent); renderRecent(); });

  syncUnitButtons();
  renderRecent();
  refreshKeyStatus();
  refreshBaseUrl();
  if (store.get(STORE.owmKey)) showEmpty(); else showGuide();
})();
