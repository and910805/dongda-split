# 東大小羅 Dongda Split

給小型旅行或活動群組使用的多人分帳網站。使用者透過 LINE Login 登入，可建立群組、分享邀請連結、共同記錄支出並查看自動簡化的結算建議。

## 功能

- LINE Login（不需要 LINE Bot 或官方帳號）
- 建立多個分帳群組
- 每個群組產生專屬邀請連結
- 成員點擊連結、登入後自動加入
- 指定付款人、分類與任意參與分攤者（例如 14 人群組只分 5 人）
- 平均分攤或自訂每人金額，付款人可不在分攤名單內
- 單人墊付或多人共同湊款
- 指定金額後，剩餘金額由其他成員自動均分
- 依住宿天數、家庭人數等份數／權重比例分攤
- 公費虛擬帳戶、成員入金及公費付款
- 退款／退押金以負數支出沖回原有負擔
- PostgreSQL 永久保存資料
- 即時計算每位成員的應收／應付
- 以淨額與零和子集合最佳化計算真正最少轉帳次數（18 位未結清成員內使用精確演算法）
- 建議付款人可按「我已轉帳」，付款紀錄會更新雙方淨額直到完全結清
- 手機與桌面響應式介面

## 環境變數

複製 `.env.example` 為 `.env`，填入 PostgreSQL 與 LINE Login 設定。`.env` 已被 Git 忽略。

LINE Developers Callback URL：

```text
https://你的網域/api/auth/line/callback
```

## 本機啟動

```bash
corepack enable
pnpm install
pnpm build
pnpm start
```

非 production 環境提供 `POST /api/dev-login`，供本機自動化測試使用；正式環境不會載入此端點。

```bash
pnpm test              # 分攤與最少轉帳演算法測試
pnpm test:integration  # 需要本機 server 與測試資料庫的 14 人資料流程測試
```

## Zeabur

Repository 內含多階段 `Dockerfile`。Zeabur 從 GitHub 匯入後會建置 Vite 前端，再由 Node.js 同源提供靜態網站、LINE OAuth callback 與 API，監聽平台提供的 `PORT`（預設 8080）。服務啟動時會以安全的 `CREATE TABLE IF NOT EXISTS` 自動建立資料表。
