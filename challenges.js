/*
 * 五項 KUCGU 挑戰：設定陣列、流程、欄位驗證、Next Action。
 * 這個檔案不碰 DOM。所有外部相依（網路、儲存、紀錄）都從 ctx 傳入，所以可以用 Node 測試。
 *
 * ctx = {
 *   kucgu:   { request },                 // kucgu.js
 *   http:    { send },                    // http.js
 *   owmKey:  () => string,                // 設定面板的 OpenWeatherMap key
 *   session: { get(k), set(k, v)=>bool }, // sessionStorage
 *   getAnswer: () => string,              // 步驟 5 的輸入框
 *   log:     (record) => void,            // API Console
 *   secrets: () => string[]               // 用來遮罩例外訊息
 * }
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Challenges = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const Http = typeof require === 'function' ? require('./http.js') : root.Http;
  const Mask = typeof require === 'function' ? require('./mask.js') : root.Mask;

  const MISSION_KEY = 'kucgu_mission';
  const BONUS_KEY = 'kucgu_bonus';
  const OWM_URL = 'https://api.openweathermap.org/data/2.5/weather';
  const OWM_TIMEOUT_MS = 15000;

  const STATUS_LABEL = { idle: '未執行', running: '執行中', success: '成功', failure: '失敗' };
  const STEP_TITLES = {
    hello: '1 Hello',
    mission_weather: '2 取得 Weather 任務',
    submit_weather: '3 提交 Weather',
    owm_weather: '3 OpenWeatherMap 查詢',
    mission_bonus: '4 取得 Bonus 題目',
    submit_bonus: '5 提交 Bonus 答案'
  };

  /* ---------- 欄位驗證：缺欄位就報錯，不補預設值 ---------- */

  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const CHECKS = {
    str: isStr,
    num: isNum,
    connected: (v) => v === 'connected',
    verdict: (v) => v === 'correct' || v === 'incorrect'
  };
  const SPECS = {
    hello: [['status', 'connected'], ['pts_earned', 'num'], ['total_score', 'num']],
    mission_weather: [['mission_id', 'str'], ['city', 'str'], ['country', 'str'], ['unit', 'str'],
      ['pts_earned', 'num'], ['total_score', 'num']],
    submit_weather: [['status', 'verdict'], ['pts_earned', 'num'], ['total_score', 'num']],
    mission_bonus: [['bonus_id', 'str'], ['question', 'str'], ['pts_earned', 'num'], ['total_score', 'num']],
    submit_bonus: [['status', 'verdict'], ['pts_earned', 'num'], ['total_score', 'num']]
  };

  /** @returns {{ok:boolean, problems:string[]}} */
  function validate(json, spec) {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, problems: ['（回應不是 JSON 物件）'] };
    }
    const problems = spec.filter(function (f) { return !CHECKS[f[1]](json[f[0]]); })
      .map(function (f) { return f[0]; });
    return { ok: problems.length === 0, problems: problems };
  }

  /* ---------- Next Action ---------- */

  function nextAction(rec) {
    const svc = rec.service;
    const err = rec.error;
    const j = rec.response && rec.response.json;

    if (err) {
      switch (err.kind) {
        case 'precheck': return err.hint || '請依提示處理後再試';
        case 'no_key': return 'API key 錯誤或未設定，請檢查設定面板';
        case 'timeout':
          return svc === 'owm'
            ? 'OpenWeatherMap 回應逾時（15 秒），請再試一次'
            : '伺服器可能正在啟動中（Replit 冷啟動），請再試一次';
        case 'network':
          return svc === 'owm'
            ? '網路失敗，請檢查網路連線並查看 DevTools Console'
            : rec.usingDefaultBase === false
              ? '網路失敗，或被瀏覽器的 CORS 擋下（兩者在瀏覽器端無法區分，請查看 DevTools Console）。請確認 Worker 已部署且網址正確'
              : '網路失敗，或被瀏覽器的 CORS 擋下（兩者在瀏覽器端無法區分，請查看 DevTools Console）。請到設定改填代理網址';
        case 'http': {
          const s = rec.status;
          if (s === 401 || s === 403) return 'API key 錯誤或未設定，請檢查設定面板';
          if (s === 429) return '請求太頻繁，稍後再試';
          if (s >= 500) return '伺服器錯誤，稍後再試';
          if (svc === 'owm' && s === 404) return 'OpenWeatherMap 找不到這個城市，請重新執行步驟 2 取得新任務';
          return '請求被拒絕（HTTP ' + s + '），請查看原始回應';
        }
        case 'not_json': return '回應不是 JSON，不視為成功，請查看原始回應';
        case 'invalid_response':
          return '回應缺少必要欄位或型別錯誤（' + (err.problems || []).join(', ') + '），不視為成功，請查看原始回應';
        case 'bad_base_url': return '伺服器網址設定不正確，請到設定重新填寫，或按「恢復預設」';
        case 'storage': return 'sessionStorage 無法寫入，請允許網站資料或關閉無痕模式後重新執行步驟 2';
        case 'aborted': return '請求已取消，請重新執行';
        default: return '發生未預期的錯誤，請查看錯誤訊息';
      }
    }

    switch (rec.step) {
      case 'hello':
        if (!j) break;
        return j.pts_earned > 0 ? '已連線，下一步請執行步驟 2' : '先前已連線過，可直接執行步驟 2';
      case 'mission_weather':
        return '已指派城市 ' + (j && j.city) + '，下一步請執行步驟 3';
      case 'owm_weather':
        return '已取得溫度 ' + (j && j.main && j.main.temp) + '°C，接著提交至 /submit/weather';
      case 'submit_weather':
        return j && j.status === 'correct'
          ? '天氣任務完成，下一步請執行步驟 4'
          : '溫度不符，請重新執行步驟 2 取得新的 mission_id，再執行步驟 3 重試';
      case 'mission_bonus':
        return '請在步驟 5 輸入答案';
      case 'submit_bonus':
        return j && j.status === 'correct'
          ? '全部完成，請開啟網站截圖 Scoreboard'
          : '答案不正確，請修正後重新提交';
      default: break;
    }
    return '請查看回應內容';
  }

  /* ---------- 流程共用 ---------- */

  function readJson(s) {
    try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  function precheck(ctx, step, message, hint) {
    const rec = Http.localFailure({ kind: 'precheck', message: message, hint: hint }, 'local', step);
    rec.nextAction = nextAction(rec);
    ctx.log(rec);
    return { state: 'failure', message: message + '。' + hint };
  }

  function failureMessage(rec) {
    if (rec.error) return rec.error.message + '。' + rec.nextAction;
    return '';
  }

  /** 呼叫 KUCGU，驗證欄位，產生 Next Action，寫入 Console。successTest 決定「業務上成不成功」。 */
  async function callKucgu(ctx, step, method, path, opts, spec, successTest) {
    const rec = await ctx.kucgu.request(method, path, opts);
    rec.step = step;
    rec.service = 'kucgu';
    if (rec.ok) {
      const v = validate(rec.response.json, spec);
      if (!v.ok) {
        rec.ok = false;
        rec.error = { kind: 'invalid_response', message: '回應欄位缺失或型別錯誤：' + v.problems.join(', '), problems: v.problems };
      }
    }
    rec.outcome = rec.ok && (!successTest || successTest(rec.response.json)) ? 'success' : 'failure';
    rec.nextAction = nextAction(rec);
    ctx.log(rec);
    return rec;
  }

  const isCorrect = (j) => j.status === 'correct';

  function verdictOutcome(rec) {
    if (rec.outcome === 'success') return { state: 'success', message: rec.response.json.message || '' };
    if (rec.ok) return { state: 'failure', message: (rec.response.json.message || '伺服器判定不正確') + '。' + rec.nextAction };
    return { state: 'failure', message: failureMessage(rec) };
  }

  /* ---------- 五個步驟 ---------- */

  async function runHello(ctx) {
    const rec = await callKucgu(ctx, 'hello', 'GET', '/mission/hello', {}, SPECS.hello);
    return rec.ok ? { state: 'success', message: rec.response.json.message || '' }
      : { state: 'failure', message: failureMessage(rec) };
  }

  async function runMissionWeather(ctx) {
    const rec = await callKucgu(ctx, 'mission_weather', 'GET', '/mission/weather', {}, SPECS.mission_weather);
    if (!rec.ok) return { state: 'failure', message: failureMessage(rec) };
    const j = rec.response.json;
    const mission = { mission_id: j.mission_id, city: j.city, country: j.country, unit: j.unit };
    if (!ctx.session.set(MISSION_KEY, JSON.stringify(mission))) {
      const f = Http.localFailure({ kind: 'storage', message: '無法寫入 sessionStorage，步驟 3 讀不到任務資料' }, 'local', 'mission_weather');
      f.nextAction = nextAction(f);
      ctx.log(f);
      return { state: 'failure', message: f.error.message + '。' + f.nextAction };
    }
    return { state: 'success', message: j.task || '' };
  }

  async function runWeatherSubmit(ctx) {
    // a. 讀最新任務
    const m = readJson(ctx.session.get(MISSION_KEY));
    if (!m || !isStr(m.mission_id) || !isStr(m.city) || !isStr(m.country) || !isStr(m.unit)) {
      return precheck(ctx, 'submit_weather', '沒有可用的 Weather 任務', '請先執行步驟 2');
    }
    // b. unit 必須是 metric
    if (m.unit !== 'metric') {
      return precheck(ctx, 'submit_weather', '任務的 unit 是 "' + m.unit + '"，不是 "metric"，已停止，沒有呼叫任何 API',
        '本程式只處理 metric，請重新執行步驟 2 取得新任務');
    }
    const owmKey = ctx.owmKey();
    if (!owmKey) {
      return precheck(ctx, 'submit_weather', '尚未設定 OpenWeatherMap API key，沒有呼叫任何 API', 'API key 錯誤或未設定，請檢查設定面板');
    }

    // c. 用任務回傳的 city 與 country 查 OpenWeatherMap
    const u = new URL(OWM_URL);
    u.searchParams.set('q', m.city + ',' + m.country);
    u.searchParams.set('units', 'metric');
    u.searchParams.set('appid', owmKey);
    const owm = await ctx.http.send({
      method: 'GET', url: u.toString(), timeoutMs: OWM_TIMEOUT_MS, secrets: [owmKey], service: 'owm'
    });
    owm.step = 'owm_weather';
    owm.service = 'owm';
    // d. main.temp 必須是有限的 number
    if (owm.ok) {
      const t = owm.response.json && owm.response.json.main && owm.response.json.main.temp;
      if (!isNum(t)) {
        owm.ok = false;
        owm.error = { kind: 'invalid_response', message: 'main.temp 缺失或不是有限數字', problems: ['main.temp'] };
      }
    }
    owm.outcome = owm.ok ? 'success' : 'failure';
    owm.nextAction = nextAction(owm);
    ctx.log(owm);
    // f. OWM 失敗時完全不呼叫 submit
    if (!owm.ok) return { state: 'failure', message: failureMessage(owm) + '（未提交）' };

    // e. temperature 以 number 型別送出
    const temperature = owm.response.json.main.temp;
    const rec = await callKucgu(ctx, 'submit_weather', 'POST', '/submit/weather',
      { body: { mission_id: m.mission_id, temperature: temperature } }, SPECS.submit_weather, isCorrect);
    return verdictOutcome(rec);
  }

  async function runMissionBonus(ctx) {
    const rec = await callKucgu(ctx, 'mission_bonus', 'GET', '/mission/bonus', {}, SPECS.mission_bonus);
    if (!rec.ok) return { state: 'failure', message: failureMessage(rec) };
    const j = rec.response.json;
    if (!ctx.session.set(BONUS_KEY, JSON.stringify({ bonus_id: j.bonus_id, question: j.question }))) {
      const f = Http.localFailure({ kind: 'storage', message: '無法寫入 sessionStorage，步驟 5 讀不到題目資料' }, 'local', 'mission_bonus');
      f.nextAction = nextAction(f);
      ctx.log(f);
      return { state: 'failure', message: f.error.message + '。' + f.nextAction };
    }
    return { state: 'success', message: '' };
  }

  async function runBonusSubmit(ctx) {
    const b = readJson(ctx.session.get(BONUS_KEY));
    if (!b || !isStr(b.bonus_id)) {
      return precheck(ctx, 'submit_bonus', '沒有可用的 Bonus 題目', '請先執行步驟 4');
    }
    const answer = String(ctx.getAnswer() == null ? '' : ctx.getAnswer()).trim();
    if (answer === '') {
      return precheck(ctx, 'submit_bonus', '答案是空的，沒有送出', '請在步驟 5 的輸入框輸入答案');
    }
    const rec = await callKucgu(ctx, 'submit_bonus', 'POST', '/submit/bonus',
      { body: { bonus_id: b.bonus_id, answer: answer } }, SPECS.submit_bonus, isCorrect);
    return verdictOutcome(rec);
  }

  function makeChallenges() {
    return [
      { id: 'hello', order: 1, title: 'Hello（連線測試）', status: 'idle', run: runHello },
      { id: 'weather-mission', order: 2, title: '取得 Weather 任務', status: 'idle', run: runMissionWeather },
      { id: 'weather-submit', order: 3, title: '抓天氣並提交', status: 'idle', run: runWeatherSubmit },
      { id: 'bonus-get', order: 4, title: '取得 Bonus 題目', status: 'idle', run: runMissionBonus },
      { id: 'bonus-submit', order: 5, title: '提交 Bonus 答案', status: 'idle', run: runBonusSubmit }
    ];
  }

  /** 執行單一挑戰：防重複、更新狀態、未預期例外也一律視為失敗並記錄。 */
  async function execute(item, ctx, onChange) {
    if (item.status === 'running') return null;
    item.status = 'running';
    item.message = '';
    if (onChange) onChange(item);
    let outcome;
    try {
      outcome = await item.run(ctx);
    } catch (e) {
      const secrets = ctx.secrets ? ctx.secrets() : [];
      const msg = Mask.scrub(Mask.maskUrl(String((e && e.message) || e)), secrets);
      const rec = Http.localFailure({ kind: 'exception', message: msg }, 'local', '');
      rec.nextAction = nextAction(rec);
      ctx.log(rec);
      outcome = { state: 'failure', message: '發生未預期的錯誤：' + msg };
    }
    item.status = outcome.state;
    item.message = outcome.message || '';
    if (onChange) onChange(item);
    return outcome;
  }

  return {
    MISSION_KEY: MISSION_KEY, BONUS_KEY: BONUS_KEY, STATUS_LABEL: STATUS_LABEL, STEP_TITLES: STEP_TITLES,
    SPECS: SPECS, validate: validate, nextAction: nextAction, makeChallenges: makeChallenges,
    CHALLENGES: makeChallenges(), execute: execute
  };
});
