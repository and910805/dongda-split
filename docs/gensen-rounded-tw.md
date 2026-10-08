# 全站源泉圓體 TW

全站可選取文字使用 GenSenRoundedTW，包含公開首頁、帳本、管理介面、表單與 body Portal 的 Modal，保留原有字級、字重、間距、顏色、文案和操作

手寫 Logo 及圖片內的字樣不重繪，emoji 或未收錄的字使用無襯線備援

字型作者與 TW／TC 說明：https://github.com/ButTaiwan/gensen-font
授權：SIL Open Font License 1.1

使用 emfont 的純 CSS Webfont，不載入第三方 JavaScript、不傳送帳本或成員文字給動態切字 API

服務說明：https://font.emtech.cc/docs/css

400、500、700、900 字重並行載入，採 WOFF2、unicode-range 按需分片和 font-display:swap，保留原有字重值，由瀏覽器匹配實際 face

只替換 CSP 的 style-src、font-src 來源，script-src 和 connect-src 仍為 self，沒有新增 npm 套件

CDN 不可用時文字仍顯示原有備援字型，金額輸入、切換帳本等操作不依賴字型服務
