/*
 * 挑戰區畫面與分頁切換。
 * 重要：載入頁面時不會呼叫任何 KUCGU endpoint，只有使用者點按鈕才會。
 * 這裡只讀 sessionStorage 來還原畫面上的任務資訊。
 */
(function () {
  'use strict';

  const el = ApiConsole.el;
  const C = Challenges;
  const OWM_KEY_STORAGE = 'owm_api_key'; // 與 app.js 的設定面板使用同一個欄位

  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  const owmKey = () => { try { return localStorage.getItem(OWM_KEY_STORAGE) || ''; } catch (e) { return ''; } };
  const readJson = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

  const items = C.CHALLENGES;
  const refs = {};
  let answerInput;

  const ctx = {
    kucgu: Kucgu,
    http: Http,
    owmKey: owmKey,
    session: session,
    getAnswer: () => (answerInput ? answerInput.value : ''),
    log: (rec) => ApiConsole.add(rec),
    secrets: () => [Kucgu.getKey(), owmKey()]
  };

  function anyRunning() { return items.some((i) => i.status === 'running'); }

  function updateItem(item) {
    const r = refs[item.id];
    r.state.textContent = C.STATUS_LABEL[item.status];
    r.state.setAttribute('data-state', item.status);
    r.msg.textContent = item.message || '';
    r.msg.className = 'step-msg' + (item.status === 'failure' ? ' is-error' : '');
    const busy = anyRunning();
    items.forEach((i) => { refs[i.id].btn.disabled = busy; });
    r.btn.textContent = item.status === 'running' ? '執行中…' : r.label;
    renderInfo();
  }

  function renderInfo() {
    const m = readJson(session.get(C.MISSION_KEY));
    const mi = refs['weather-mission'].info;
    if (m && m.mission_id) {
      mi.replaceChildren(el('dl', { class: 'kv' },
        el('div', null, el('dt', null, 'city'), el('dd', null, String(m.city))),
        el('div', null, el('dt', null, 'country'), el('dd', null, String(m.country))),
        el('div', null, el('dt', null, 'unit'), el('dd', null, String(m.unit))),
        el('div', null, el('dt', null, 'mission_id'), el('dd', { class: 'mono' }, String(m.mission_id)))));
    } else {
      mi.replaceChildren(el('p', { class: 'step-hint' }, '尚未取得任務。'));
    }
    const b = readJson(session.get(C.BONUS_KEY));
    const bi = refs['bonus-get'].info;
    if (b && b.bonus_id) {
      bi.replaceChildren(el('p', { class: 'question' }, b.question), el('p', { class: 'step-hint mono' }, 'bonus_id：' + b.bonus_id));
    } else {
      bi.replaceChildren(el('p', { class: 'step-hint' }, '尚未取得題目。'));
    }
  }

  function renderScore() {
    const s = ApiConsole.getLastScore();
    refs.score.textContent = s
      ? 'total_score：' + s.value + '（伺服器最後一次回應，來源：' + (C.STEP_TITLES[s.step] || s.step) + '）'
      : 'total_score：尚未收到伺服器回應';
  }

  function build() {
    const root = document.getElementById('challenges-root');
    if (!root) return;

    const labels = { hello: '執行', 'weather-mission': '取得任務', 'weather-submit': '抓天氣並提交', 'bonus-get': '取得題目', 'bonus-submit': '送出答案' };
    const hints = {
      'weather-submit': '使用步驟 2 回傳的城市查詢 OpenWeatherMap（metric），再把溫度提交給 KUCGU。',
      'bonus-submit': '答案由你自己輸入，程式不會自動解題。'
    };

    const list = el('ol', { class: 'steps' }, items.map((item) => {
      const btn = el('button', { type: 'button', class: 'btn btn-primary', 'data-step': item.id,
        onclick: () => C.execute(item, ctx, updateItem) }, labels[item.id]);
      const state = el('span', { class: 'step-state', 'data-state': 'idle' }, C.STATUS_LABEL.idle);
      const info = el('div', { class: 'step-info' });
      const msg = el('p', { class: 'step-msg', role: 'status', 'aria-live': 'polite' });
      refs[item.id] = { btn: btn, state: state, info: info, msg: msg, label: labels[item.id] };

      let controls = btn;
      if (item.id === 'bonus-submit') {
        answerInput = el('input', { type: 'text', id: 'bonus-answer', autocomplete: 'off', spellcheck: 'false',
          'aria-label': 'Bonus 答案', placeholder: '輸入你的答案' });
        controls = el('div', { class: 'row' }, answerInput, btn);
      }
      return el('li', { class: 'step' },
        el('span', { class: 'step-no', 'aria-hidden': 'true' }, String(item.order)),
        el('div', { class: 'step-main' },
          el('div', { class: 'step-head' },
            el('h3', { class: 'step-title' }, '步驟 ' + item.order + '　' + item.title), state),
          hints[item.id] ? el('p', { class: 'step-hint' }, hints[item.id]) : null,
          el('div', { class: 'step-ctl' }, controls),
          info, msg));
    }));

    refs.score = el('p', { class: 'score', 'aria-live': 'polite' });
    root.replaceChildren(
      el('p', { class: 'hint' }, '每個按鈕只在你點擊時才會呼叫 API，頁面載入與切換分頁都不會呼叫。KUCGU 的計分由伺服器決定，每項只給一次分。'),
      refs.score,
      list,
      el('p', { class: 'scoreboard' },
        el('a', { href: 'https://kucgu.replit.app', target: '_blank', rel: 'noopener noreferrer' }, '開啟網站查看 Scoreboard')));
    renderInfo();
    renderScore();
    ApiConsole.subscribe(renderScore);
    ApiConsole.render();
  }

  function setupTabs() {
    const tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        select(next);
        next.focus();
      });
    });
  }

  setupTabs();
  build();
})();
