# 天氣查詢

純 HTML、CSS、JavaScript 的天氣網頁。沒有 build 步驟，沒有相依套件，用瀏覽器直接開 `index.html` 就能執行。

資料來自 OpenWeatherMap：Geocoding API、目前天氣、5 天 / 3 小時預報。

## 檔案結構

```
.
├── index.html   頁面骨架與設定面板
├── style.css    樣式
├── app.js       搜尋、定位、渲染、錯誤處理、設定面板
├── mask.js          key 遮罩（純函式）
├── http.js          共用傳輸層：timeout、錯誤分類、紀錄物件（KUCGU 與 OpenWeatherMap 共用）
├── kucgu.js         KUCGU client：request(method, path, {headers, query, body})
├── challenges.js    五項挑戰的設定陣列、流程、欄位驗證、Next Action
├── api-console.js   API Console（記憶體內最近 20 筆）
├── challenges-ui.js 挑戰區畫面與分頁切換
├── worker/          KUCGU 的 CORS 代理（Cloudflare Worker），部署步驟見 worker/README.md
├── tests/           Node 內建測試（遮罩、傳輸層、挑戰流程、Next Action、伺服器網址、Worker）
├── .gitignore
└── README.md
```

## 部署（GitHub Pages）

push 到 `main` 或手動觸發 workflow 時，`.github/workflows/pages.yml` 會把網頁需要的檔案（不含 `tests/`、README 等）發佈到：

`https://<GitHub 帳號>.github.io/<repo 名稱>/`

key 只存在使用者自己瀏覽器的 localStorage，不會上傳到伺服器，也不在發佈的檔案裡。

## 本機執行

1. 取得程式碼後，直接用瀏覽器開啟 `index.html`（雙擊，或把檔案拖進瀏覽器）。
2. 到 [openweathermap.org](https://openweathermap.org) 註冊並在 API keys 頁面取得 key。
3. 在頁面右上角按「設定」，把 key 貼進「OpenWeatherMap API key」並儲存。
4. 輸入城市名稱搜尋，或按「使用目前位置」。

如果瀏覽器的定位在 `file://` 下不能用，可以在專案資料夾執行 `python3 -m http.server 8000`，再開 `http://localhost:8000`。這不是 build 步驟，只是一個靜態檔案伺服器。

新申請的 OpenWeatherMap key 可能要等幾十分鐘到數小時才會生效，期間所有請求都會回 401，頁面會明確提示。

## API key 怎麼處理

- 程式碼裡沒有任何 key。
- key 由你在「設定」面板輸入，存在這個瀏覽器的 `localStorage`（欄位 `owm_api_key`、`kucgu_api_key`）。它們不在專案檔案裡，所以不可能被 commit。
- 設定面板不會把已儲存的 key 回填到輸入框。
- `.gitignore` 另外擋掉 `.env`、`*.local`、`keys.js` 等常見的 key 檔名，避免日後有人手動建立這類檔案。
- 沒有 key 時，主畫面會顯示設定引導，不會顯示空白或假資料。

注意：OpenWeatherMap 規定 key 要放在請求網址的 `appid` 參數，所以你自己的瀏覽器開發者工具的 Network 頁籤會看得到它。這是 API 的設計，key 仍只存在你的機器上。程式的錯誤訊息不會印出請求網址。

## 錯誤處理

所有 fetch 都經過同一個函式，有 10 秒 timeout 與錯誤分支。任何一個請求失敗，整個畫面改顯示錯誤，不會留下過期或不完整的資料。

| 情況 | 畫面提示 |
| --- | --- |
| 沒有 key | 設定引導 |
| 401 | key 無效或尚未生效 |
| 404 / 查無結果 | 找不到城市 |
| 429 | 超過頻率上限 |
| 網路中斷 | 無法連線，列出常見原因 |
| 逾時 | 請求逾時 |
| 5xx | 伺服器錯誤 |
| 回應格式不符 | 不顯示資料並說明 |
| 定位被拒絕 / 無法取得 / 逾時 | 各自獨立的說明 |

## KUCGU 挑戰

切到「KUCGU 挑戰」分頁使用。設定面板有 KUCGU key 與「認證方式」：預設 Header（`X-API-Key`），若瀏覽器因 CORS 擋下請求，可切成 Query 參數（`?api_key=`）。

- 五個步驟固定順序：Hello、取得 Weather 任務、抓天氣並提交、取得 Bonus 題目、提交 Bonus 答案。
- 頁面載入與切換分頁不會呼叫任何 KUCGU endpoint，只有點按鈕才會。執行中所有步驟按鈕都會 disabled。
- 步驟 3 用任務回傳的 city 與 country 查 OpenWeatherMap（`units=metric`），`main.temp` 不是有限數字或 OpenWeatherMap 失敗時，完全不呼叫 submit。
- 回應不是 2xx、不是 JSON、缺少必要欄位，各自顯示不同訊息，不會當成成功，也不會用預設值補欄位。
- 畫面只顯示伺服器最後一次回應的 `total_score`，前端不自己計分。
- 逾時：KUCGU 30 秒，OpenWeatherMap 15 秒。

### 伺服器網址與 CORS 代理

KUCGU 伺服器沒有回傳 CORS 標頭，瀏覽器讀不到回應。解法是部署 `worker/` 的 Cloudflare Worker 代理（手機即可，步驟見 [worker/README.md](worker/README.md)），再到設定面板的「KUCGU 伺服器網址」填入 workers.dev 網址。預設值是 `https://kucgu.replit.app`，網址必須是 https，結尾斜線會自動去掉。key 會送到你填的網址，只填你信任的伺服器。

### API Console 與 key 遮罩

每次呼叫（含 OpenWeatherMap）都會顯示 Request、Response、Next Action，以及伺服器回傳的 status、message、pts_earned、total_score。紀錄只在記憶體，最多 20 筆，不寫入 localStorage。

KUCGU key 與 OpenWeatherMap 的 `appid`，在 header、網址、回應內容、錯誤訊息中一律只顯示前 4 碼加 `****`。遮罩在紀錄物件建立時（`http.js`）完成，顯示層與 console 拿到的就已經是遮罩後的資料，不靠 CSS。程式不使用 `console.log` 輸出請求內容。

## 測試

```
node --test tests/*.test.js
```

需要 Node 18 以上，沒有任何相依套件。測試用的 key 全部是假的（`cguku_test0000`、`owm_test0000`），fetch 也是假的，不會連網。
