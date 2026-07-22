# 東大小羅 Dongda Split

一個以旅行情境設計的響應式分帳網站。包含品牌首頁、群組儀表板、餘額摘要與互動式新增支出流程。

## 本機開發

```bash
corepack enable
pnpm install
pnpm dev
```

## 正式建置

```bash
pnpm build
pnpm preview
```

## Zeabur 部署

Repository 內含 `Dockerfile`，Zeabur 從 GitHub 匯入後可直接建置與部署，服務監聽 8080 port。

目前是純前端展示版本，資料存在 React 記憶體中，重新整理頁面會恢復範例資料，因此不需要外部資料庫。

若要支援正式多人使用、登入、群組邀請與永久保存帳本，建議加入 PostgreSQL，並由後端 API 存取資料庫；不要讓瀏覽器直接連線資料庫。

