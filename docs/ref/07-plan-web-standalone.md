# 07 · Web 獨立上手 ＋ websign 對齊 Page 預覽（執行計畫）

> 2026-09-09 · 使用者裁決三題（見 §1），本文件是**live plan**，與 `06-plan-convergence-2.0.0.md` 並行：06 管 2.0.0 批次去留，本文件管「web 端獨立上手」這條線。QR／wire 細節仍以 `05-spec-qr-exchange.md` 為準；身份與備份原則以 `01-spec-verified-page.md` §3 為準（本文件不改它，只落實它）。

## 0. 動機與事實（2026-09-09 盤點）

- 北極星不變：公司倒了機制還能用。web 能獨立建立、簽署、發布一張 Verified Page，是這句話在瀏覽器上的落地。
- **passkey 現況**：app 的 `PasskeyStep` 只是步驟名，做的是助記詞派生 root did:key ＋ iCloud Keychain 備份；web 與 app 都沒有 WebAuthn。01-spec §3 已定方向：seed 為本，passkey 用 PRF 當外殼；passkey 不可直接當身份（可攜性）。
- **web 現況**：viewer 完整（fragment／`#nostr`／`/@name`，四態徽章）；`/edit` 只能改 name、bio、links，page 的 blocks 與外觀原樣帶回；金鑰儀式核心（`builder/keys.ts`、`signProfile.ts`）存在但無 UI、無保存；不能發 Nostr、不能註冊 NIP-05。websign（web 出 request、手機簽）已通（web PR #5、app `170a6f3`）。
- **app 現況**：`PageLivePreview` 是唯一的 Verified Page 渲染，web 的 `PageBlocks`／`pageAppearance` 是同一份 creds mock v3 移植，兩邊對齊的地基都在。websign 入口 triple-gated developerMode（06-plan §2 裁決）。
- **NIP-05 目錄**已上線於 creds.id（`name@creds.id`，worker `solidarity-id`）。

## 1. 裁決（2026-09-09，使用者）

| # | 題目 | 裁決 | 理由 |
|---|---|---|---|
| **P1** | web 的 passkey 語意 | **PRF 外殼包 seed**。助記詞仍是唯一根與恢復碼；passkey 只負責解鎖。不支援 PRF 的瀏覽器退回重輸助記詞。 | 01-spec §3；同一助記詞在 app 與 web 同一個 did，可攜。passkey 直接當身份會把身份鎖進平台 credential manager。 |
| **P2** | builder host | **只在 creds.id**。`app.solidarity.gg/edit` 轉到 `creds.id/edit`；viewer 兩邊照舊。 | passkey RP ID、CSP、IndexedDB 都是 per-origin；兩個 host 各一組鑰匙會讓使用者以為身份不見。 |
| **P3** | app 的 websign 閘 | **拿掉 developerMode 閘，進 Page 流程**。安全橫幅與逐欄 diff 照舊。 | 「對齊在 Page 預覽裡」的前提。推翻 06-plan §2「留（dev-gated）」，該表已註記。 |

## 2. 階段

### 階段 1 · Web 編輯器對齊 Page 預覽（web）

- `/edit` 變成真的頁面編輯器：blocks 目錄、每型允許的 style、上限（16 blocks／24 items／標題長度）**全部取自 `@solidarity/shared` 的 schema**（`PUBLIC_PAGE_STYLES` 自本日起 export），與 app 的 `PAGE_BLOCK_CATALOG` 同源；外觀（template／font／background／customBackground／showBrand／footerText）與 app 的 `PageAppearanceSheet` 同一組選項。
- 即時預覽就是 viewer 的 `ProfileCard`＋`PageBlocks`：使用者看到的預覽＝訪客會看到的頁面，不另做一套。
- 草稿模型：canonical `PublicPageDesign` 直接編輯，`canonicalDraftFrom` 帶編輯後的 `page`，送 request 前過 `parseProfile`；規範順序（`order === index`、links block 置頂且可見）由編輯器維持。
- websign 路徑不變（手機簽）；手機端 review 已會顯示 page 的項目增減與版面變更（`170a6f3`）。
- 驗收：從 `creds.id/@name` 按「編輯此頁」→ 改 blocks／外觀 → 產 QR → 手機 review 顯示對應 page diff → 發布後 `creds.id/@name` 呈現新版面。

### 階段 2 · App 把 websign 放進 Page 流程（app）

- `technicalFlowGate`：`webSign` 不再是 developer-only（scanner 與 deep link 兩條），`/websign/review` 拿掉 Redirect。安全橫幅、diff、Face ID 照舊。
- Page tab 新增「在電腦上編輯」卡片：把現有的分享連結（fragment 或 `/@name`）複製／分享到電腦，網頁開啟後按「編輯此頁」，改完掃 QR 回來簽。不另造新的 wire。
- 驗收：關閉 developerMode 的裝置能完成整條 websign；`technicalScanGate` 測試改為 webSign 不受閘。

### 階段 3 · Web 獨立上手（web ＋ shared；**動工前先過 grill ＋ opus 安全審**）

- **建檔**：`creds.id/edit` 無既有頁面時走「一頁式」助記詞儀式（生成 → 抄寫 → 抽三詞回填），派生 did:key（`deriveP256Scalar` + `HKDF_INFO_ROOT`，與 app 同一條路）。
- **保存與解鎖（P1）**：seed 以 passkey PRF 輸出經 HKDF 派生的 AES-GCM 鍵包裹後存 IndexedDB，連同 credential id；回訪 `navigator.credentials.get` 帶 `prf` 取回鍵、解包、`importKey(extractable:false)` 供本次 session 簽名。無 PRF（或使用者拒絕 passkey）→ 每次重輸助記詞，不持久化任何秘密。**明文助記詞永不落地**；「清站台資料＝鑰匙消失，只有助記詞能救」在 UI 講死。
- **Nostr**：同一助記詞派生 secp256k1（`deriveSecp256k1Scalar` + `HKDF_INFO_NOSTR`，與 app 相同 → 同一 npub）。NIP-01 事件建構／schnorr 簽名／驗證搬進 `packages/shared/src/nostr/event.ts`，app 的 `userKey.ts` 與 web 共用；web `relayClient` 補 `publishEvent`（quorum 與 app 同）。
- **發布**：簽 public projection（web 無 link 分級，即 `scope: 'public'`）→ kind-30078 ＋ kind-0 `alsoKnownAs`（did）；以現有 `confirmByNostr` 回讀確認。
- **NIP-05**：web 以 NIP-98（Nostr 鍵簽）打 `https://creds.id/id/register`，kind-0 寫 `nip05: name@creds.id`；client 核心搬進 shared（注入簽名器），app 的 `nip05/client.ts` 改用。
- **分享**：`encodeFragment(jws)` → `creds.id/#<fragment>`；註冊後 `creds.id/@name`（既有 `viewerShare`）。
- **升級到 app**：app 匯入助記詞 → 同一 did／npub 直接延續（01-spec §3）；反向：app 使用者在 web 輸入助記詞一次，再建 passkey 外殼。
- **安全前提（擋門）**：creds.id 先上嚴格 CSP（`public/_headers`——已上：`script-src 'self'`、無 inline、HSTS／COOP／CORP）；builder 只在 creds.id（P2）；不引入新的 runtime 依賴做簽名以外的事；XSS 威脅模型寫進 `progress.md`。
- 驗收：全新瀏覽器 → 建檔 → 發布 → `creds.id/@name` 綠勾；清站台資料後用助記詞復原同一 did；同一助記詞匯入 app 得到同一 did 與 npub；conformance 向量兩端一致。
- **狀態（2026-09-09）**：已在 web PR #6（`5a9d79b`，已合併）落地；opus 安全審 13 項（1 critical：relay 事件未驗簽就被 kind-0 重簽）已在 web PR #7（`ba9e726`）修完並合併（2026-09-09），creds.id 已跟上。已驗：localhost 建檔 → 抽詞 → 解鎖，did／npub 與 shared 派生一致。未驗：真實 authenticator 的 passkey PRF、瀏覽器對真 relay 發布、`creds.id/@name` 全程驗收。安全不變式：relay 是不可信輸入（`acceptRelayEvent`）；只簽本鍵可證明擁有的 base；儲存讀不到時絕不呈現成「沒有身分」。XSS 威脅模型：`public/_headers` 檔頭註解＋ PR #7 說明（CLAUDE.md 所指的 `.superpowers/sdd/progress.md` 目前不在 repo 內）。

## 3. 順序與規模

1 → 2 → 3。階段 1、2 各約一個 session，可先上；階段 3 是 L，多 session，含 grill 與安全審。每階段結束都跑 root `bun run typecheck && bun run lint && bun run test`、web `bun run typecheck && bun run lint && bun test && bun run verify`；shared 一改就重打包 web vendor（同版號重打包必須清 bun 快取，見 05-spec §5）。

## 4. 不做／待裁

- 不做「passkey 直接當身份」（P1）。
- avatar 上傳：web 沒有媒體儲存，階段 1 avatar 唯讀（沿用 origin）；是否接第一方 blob 另裁。
- link 分級（public／link-only／private）在 web 不做；web 草稿一律 public。
- 手機只回 response 不發布時本機不更新（既有行為）——留待 websign 回應通道重整時一併處理。
