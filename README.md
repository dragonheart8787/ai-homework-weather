# 天氣查詢

純 HTML、CSS、JavaScript 的天氣網頁。沒有 build 步驟，沒有相依套件，用瀏覽器直接開 `index.html` 就能執行。

資料來自 OpenWeatherMap：Geocoding API、目前天氣、5 天 / 3 小時預報。

## 檔案結構

```
.
├── index.html   頁面骨架與設定面板
├── style.css    樣式
├── app.js       搜尋、定位、渲染、錯誤處理、設定面板
├── kucgu.js     KUCGU client 骨架（只有基礎設施，沒有任何 endpoint）
├── .gitignore
└── README.md
```

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

## KUCGU

`kucgu.js` 只有 client 骨架：base URL（目前是空字串）、key 讀寫、統一的 `request()` 與錯誤分類。沒有任何 endpoint，驗證方式也尚未定義，相關位置都標了 `TODO(KUCGU 規格)`。在填入規格之前，呼叫 `request()` 會直接拋出 `not_configured`。目前沒有任何功能使用 KUCGU。
