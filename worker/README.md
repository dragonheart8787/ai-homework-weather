# KUCGU CORS 代理（Cloudflare Worker）

KUCGU 伺服器沒有回傳 CORS 標頭，瀏覽器讀不到回應。這個 Worker 站在中間轉發請求，並補上 CORS 標頭。

它只做這幾件事：

- 只轉發到 `https://kucgu.replit.app`（寫死在程式裡）。
- 只開放 `GET /mission/hello`、`/mission/weather`、`/mission/bonus` 與 `POST /submit/weather`、`/submit/bonus`，其餘回 404。
- 只接受來自 `https://dragonheart8787.github.io` 與 `http://localhost:8000` 的請求，其餘回 403。
- 只轉發 `X-API-Key` 與 `Content-Type` 兩個 header，query string 與 body 原樣轉發。
- 不儲存、不記錄任何內容，程式裡沒有 `console`、沒有 Secret、沒有 KV。

## 在手機上部署

不需要電腦，也不需要 wrangler。

1. 用手機瀏覽器登入 Cloudflare 網頁（dash.cloudflare.com），沒有帳號就先免費註冊。
2. 開啟選單，點 Workers & Pages。
3. 點 Create（建立）。
4. 選 Hello World 範本。
5. 名稱隨意填（例如 kucgu-proxy），點 Deploy。
6. 部署完成後點 Edit code。
7. 在編輯器裡全選並刪除原本的程式碼。
8. 到 GitHub 開啟 `worker/worker.js`，點 Raw，全選複製。
9. 回到 Cloudflare 編輯器，貼上。
10. 點右上角 Deploy。
11. 回到 Worker 頁面，複製 `workers.dev` 網址（格式像 `https://kucgu-proxy.你的帳號.workers.dev`）。
12. 在瀏覽器開啟「複製的網址加上 `/mission/hello`」。看到 `{"error":"origin_not_allowed"}` 代表 Worker 已經在運作（直接用網址列開啟不帶 Origin，所以被擋是正常的）。
13. 開啟天氣 App，按「設定」，在「KUCGU 伺服器網址」貼上複製的網址（不要加路徑），按儲存。
14. 切到「KUCGU 挑戰」分頁，按步驟 1 測試。

## 從 GitHub 部署

不想手動貼程式碼時，可以讓 Cloudflare 直接從這個 repo 部署。`worker/wrangler.jsonc` 已經設定好 Worker 名稱與入口檔。

1. Cloudflare 網頁，Workers & Pages，Create，選 Import a repository（連結 GitHub）。
2. 授權並選這個 repo。
3. Worker 名稱填 `kucgu-proxy`，必須與 `wrangler.jsonc` 的 `name` 相同。
4. Root directory 填 `/worker`。
5. Build command 留空。
6. Deploy command 填 `npx wrangler deploy`。
7. 把 Preview builds 關閉。
8. 把 Cloudflare Access 關閉（否則瀏覽器的請求會被擋在登入頁，App 讀不到回應）。
9. 點 Save and Deploy。之後每次 push 到連結的分支都會自動重新部署。
10. 部署完成後複製 workers.dev 網址，之後的步驟與上面第 13 步相同。

名稱不一致時部署會失敗或建立出另一個 Worker。

## 注意

- 要換成別的網站來源時，修改 `worker.js` 最上方的 `ALLOWED_ORIGINS`，再重新 Deploy。
- 從 `file://` 直接開啟 `index.html` 的 Origin 是 `null`，會被這個 Worker 拒絕。請用 GitHub Pages 網址，或在本機用 `python3 -m http.server 8000` 再開 `http://localhost:8000`。
- Worker 看得到經過它的請求（包含 key），這是代理的本質。請只部署在你自己的 Cloudflare 帳號，並確認程式碼沒有被改動。
- 免費方案有每日請求次數上限，個人使用通常夠用。
