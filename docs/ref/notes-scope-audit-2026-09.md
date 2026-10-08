# 2.0.0 scope 盤點 — App↔Web 互通機制與冗餘功能（2026-09-16）

> 對象：`airmeishi` `2.0.0` @ `f0733310`、`airmeishi-web` `feat/identity-card-landing` @ `c6d8103`、`airmeishi-backend` @ `81bc567`。
> 方法：全部以 code 為準（import graph + 路由 inbound 掃描 + shared export 消費掃描），文件只用來對照裁決。與 06/07/08 的差異在文中標明。
> 規模基準：`apps/expo/{src,app}` 共 **105,963 行**。

---

## 1. 現在真的存在的 App↔Web 互通通道（8 條）

| # | 通道 | 方向 | 現況 | 證據 |
|---|---|---|---|---|
| 1 | **Passkey PRF root vault**（08） | App→服務→Web | **主路徑**。App 用 Keystone `PasskeyPrf` 建 credential、seal 助記詞(+nostr scalar) 上傳 `PUT /vault/root/:locator`；Web 用 discoverable passkey 取回 PRF 解封，記憶體內簽名 | `src/identity/rootVaultSync.ts`、`web/src/identity/syncedRootVault.ts`、`backend/src/routes/rootVault/index.ts` |
| 2 | **websign**（07） | Web→App→Nostr | **後備**。Web 出 request JWS → QR/deeplink → App `/websign/review` 逐欄 diff＋Face ID → 發布。**App 端已無入口**，只剩掃描器與 deep link 兩條被動路徑 | `src/websign/*`(645)、`app/websign/review.tsx`、`web/src/websign/*`、`shared/src/webSign.ts`(505) |
| 3 | **Nostr kind-30078 / kind-0** | 雙向 | 真正的共享狀態層；兩端同一組 `DEFAULT_RELAYS` | `src/nostr/publish.ts`、`web/src/services/nostr/*` |
| 4 | **NIP-05 目錄**（creds.id/id/*） | 雙向 | 單一實作在 shared，兩端只注入簽名器與 origin — **互通做得最乾淨的一條** | `shared/src/nip05/client.ts`、`src/nip05/client.ts`、`web/src/builder/claimName.ts` |
| 5 | **分享連結** `#<jws>` / `#nostr:` / `/@name` | App→Web | 現行 | `src/components/me/meProfileModel.ts`、web router |
| 6 | **Deep link** `solidarity://…` / `https://creds.id/…` | Web→App | 現行 | `src/deeplink/parser.ts` |
| 7 | **atproto / PDS（Bluesky）** | 各自一套 | App 有完整 OAuth+DPoP+PDS 寫入面(2,089 行)，Web 只有唯讀驗證 | `src/atproto/*`、`web/src/services/atproto/*` |
| 8 | **shared + conformance vectors** | 規格層 | 17 組向量；**CRD1 仍無向量**（05-spec §5-4 未關） | `packages/shared/vectors/` |

App-only、但在使用者心智裡與 #1 重疊：iCloud Drive / Google Drive 封存備份（`src/backup/*` 2,992 行）。

---

## 2. 冗餘清單（依「刪起來的風險」由低到高）

### A. 純死碼 — 零生產引用，刪掉沒有任何產品行為變化

靜態掃描（`@/` 與相對 import 全解析，排除測試與 `app/` 路由）：**48 檔 / 8,174 行**。重點：

| 行數 | 位置 | 說明 |
|---|---|---|
| 1,931 | `src/onboarding/steps/{BackupStep,PageStep,CompleteStep,SecureKeysStep,ConnectStep,ShareStep,TerminalWelcomeStep}.tsx` | 舊 onboarding 殘骸。現流程只有 welcome→username→passkey→links→complete（`src/onboarding/state.ts:7-11`） |
| 996 | `src/sharing/**` | 選擇性揭露政策引擎。全 repo 只剩 `src/settings/productionWipe.ts:47` 在清它的 store；`app/settings/share-settings.tsx` 走的是 `cards/solidarityQrPayload` |
| 662 | `src/components/share/ShareLinkOptions{,Sheet}.tsx` | `maxUses`/`currentUses` 殭屍欄位的 UI（05-spec §6-5）；收端 `scan/envelopeHandler.ts:164-166` 還在讀，但**沒有任何發射端會填** |
| 795 | `src/components/groups/*` 三檔 + `src/groups/credentialService.ts` | 群組 VC 發行殘件（引擎凍結） |
| 285 | `src/pro/{entitlement,entitlementStore}.ts` | StoreKit2/Play Billing/did:key license 的完整 entitlement 模型，**零消費者**。`app/settings/pro.tsx` 只是靜態行銷頁 |
| 288 | `src/identity/importHelper.ts` | |
| 227+202 | `src/sakura/{webrtc,pinnedFetch}.ts` | |
| 190 | `src/components/me/IdentityCredentialRows.tsx` | **唯一推 `/settings/identity-export` 的地方**（見 §B） |
| 154+78 | `src/identity/{businessCardEnvelope,didDocumentExporter}.ts` | |
| 144 | `src/offline/manager.ts` | 06 §2 已裁「砍」，零 caller |
| 109 | `src/feedback/webhookManager.ts` | 從 Swift simulator-stub 移植的**對外 POST**，零 caller。留著是白給的外送面 |
| — | `src/cards/qrCodeManager.ts:137` `parseQrPayload` | 整個函式死碼（只有測試引用）；`SOLIDARITY_VC::`/`AIRMEISHI_VC::` 分類器只活在裡面（05-spec §6-3） |

Web 端相對乾淨：只有 `web/src/data/foundation.ts`(31) 無引用。

### B. 走不到的入口 — 功能在、路徑斷

`app/` 下 **19 條路由沒有任何 inbound 導航**：
`/cards/ocr`、`/contacts/{manual,picker}`、`/credentials/issue`、`/dev/*`(6)、`/id/*`(3)、`/settings/{disclosure,oidc-request,solidarity-qr,vc}`、`/share/qr`、`/vault`。

**其中最痛的一條**：`/settings/identity-export` — 全 app 唯一能「Face ID 顯示 24 字助記詞 / 匯入助記詞」的畫面（`identityExport.reveal` / `identityExport.import`），只被 §A 那個死元件推。北極星是「公司倒了這套還能用」，而**唯一的救援碼在設定裡走不到**。

同時，**三個備份入口互相打架**：
- Settings › `Backup & Recovery` → `/settings/backup`（其實是 iCloud 封存，不是助記詞）
- Settings › `Cloud Backup` → `/settings/data-sync` → 再 push 回 `/settings/backup`
- 真正的「Backup & Recovery」語意 → 孤兒的 `/settings/identity-export`

`app/settings/pro.tsx:20,47` 的按鈕開 `https://creds.id/upgrade` — **web 沒有這條路由**（只有 `/`、`/edit`、`/$handle`），會落到 `/@upgrade` 的 not-found。

### C. 06 §2 已裁定要砍、但 code 原封不動

| 行數 | 子系統 | 06 裁決 | 現況 |
|---|---|---|---|
| 4,795 | `src/sakura` + `src/shoutouts` + `src/components/shoutouts` + `app/shoutouts/*` | **砍（含 push rail）** | 全在。`/shoutouts` **沒有任何 UI 入口**（只有子樹內互相導航），但推播 opt-in 還在 onboarding `ReadyStep.tsx:41` 與 `settings/notifications`，`app/_layout.tsx:358` 開機重註冊 — 而這條 push 的**唯一收件人就是走不到的 Shoutouts**。backend 還在跑 inbox worker＋APNs |
| 4,510 | `src/dag` 沙盒 8 檔 + `src/components/sandbox` + `app/dev/*` | **搬 2 檔、刪其餘** | 未動。`nostrAdapter`/`node` 仍是生產命脈（不可刪），其餘是 developerMode 才進得去的沙盒，且 `/dev/*` 6 條連 dev 頁面自己都沒連結 |
| ~1,561 | `src/vault/{secretsKeychain,shardDistribution,recovery,shardEnvelope}` | **defer** | 在。分片保護的是**錯的鑰**（`vault/storage.ts` 實際用 `getMasterKey`），一旦出給用戶＝Rule 8 假功能；也是 vault→sakura 的唯一牽連 |
| — | `src/vault/cloudSync.ts` | 砍 → **B1a 勘誤：有 caller** | 在。刪它＝重工 vault store 的 sync 路徑，需獨立一刀 |
| ✓ | airdrop | 砍 | 已執行（`386cbf9`） |

### D. 斷裂 / 未被消費的基建

- **wallet-pass `solidarity://contact`**：`components/walletpass/passBundle.ts:342` 等三處發射（pkpass 條碼、app 內 QR、剪貼簿），`deeplink/parser.ts` **至今沒有 `contact` 分支** → 自家 QR 自家讀不了。05-spec §6-1 記錄在案，未修。
- **NIP-44 v2 原語**（`shared/src/crypto/nip44.ts` 189 行＋官方向量）：Q5 裁決延後，**零消費者**。
- **shared 其他零消費出口**：`importer/twitterArchive.ts`(91 全未用)、`handles/didPointer.ts`(105 全未用)、`crypto/nip44.ts`(全未用)、`types/cardError.ts`(13/14 未用)、`types/oidc.ts`(14/19 未用 — DCQL / presentation definition)、`qr/base45.ts` 的 named export。
- **web `config/index.ts:26` `proofWorker: https://proof.solidarity.gg`**：指向未部署的 worker（03 §4 的例外基礎設施），目前純佔位。
- **Q2（`solidarity.cardKeyAttestation.v1` 長效版）未做**：`src/oidc/cardKeyBinding.ts` 仍只有綁 `aud`+`nonce`+300s 的 A5b 版本 → 名片訂閱指標只能 refresh 已存的人（`cardSubscriptionBootstrap` 的 `skippedNewDid`），Q2 的產品價值尚未兌現。
- **CRD1 沒有 app↔web 向量**（05-spec §5-4）：三代 wire 裡最重要的那代沒有相容性護欄。

### E. 兩端重複 — 同一件事做了兩套

1. **websign vs passkey sync**：兩套完整的「在電腦上編輯 → 發布」路徑。成本＝app 645 + web ~570 + `shared/webSign.ts` 505 + 向量 + `deeplink/parser.ts` 的 3 個分支 + 掃描器分類器。08 把它降級為「PRF 不支援或金庫不存在時的後備」，但**維護成本是全額，而 App 端連入口都沒了**（`EditOnWebCard` 在 `9cdb2803` 換成純 passkey）。這是目前最大的一筆「要嘛講清楚要嘛砍掉」。
2. **`publishToRelays` 抄了兩份**：`shared/src/nostr/quorum.ts:83`（web 在用）vs `apps/expo/src/nostr/publish.ts:168`（app 自己重寫一份同語意的）。常數共用、迴圈不共用 → quorum/retry 行為會漂移。
3. **atproto 兩套**：app 2,089 行（OAuth+DPoP+PDS **寫入**）vs web 唯讀驗證。2.0.0 的 spine 已經是 Nostr + creds.id，Bluesky 寫入面是否還要維護是個沒被 06 裁過的題。
4. **三個備份/救援語意**（§B）。

---

## 3. 建議批次（每批獨立可驗）

**批次 1 · 純刪（S，零產品行為變化）**
§A 全部：48 檔 8,174 行 + `sharing/` + `offline/` + `pro/` + `webhookManager` + `parseQrPayload` + shared 的零消費出口。跑 `typecheck && lint && test` 即可收工。

**批次 2 · 執行 06 §2 已裁但未做的刀（M）**
sakura + shoutouts + push rail（連帶決定 backend inbox worker 的去留）；dag 搬 2 檔刪 8 檔 + sandbox + `/dev/*`；vault 分片群 defer 落地。不變量照 06 §3B：`dag/nostrAdapter`＋`node` 只搬不刪、vault 核心加密不可壞。

**批次 3 · 入口修復（S，但是產品面的）**
`/settings/identity-export` 補正式入口並把「Backup & Recovery」的語意對回助記詞；三個備份入口收斂成一個；`pro` 的 `creds.id/upgrade` 修或拔；wallet-pass 補 `contact` parser 分支或整組刪。

**批次 4 · 需要你裁決（本文件不代決）**
1. **websign 留還砍？** 留＝補回 App 端入口＋把「什麼時候會用到」寫進 UI；砍＝連 `shared/webSign.ts`、web `WebSignPanel`、deeplink 分支、向量一起清。
2. **atproto 寫入面**（app 2,089 行）在 Nostr-first 之後還留嗎？
3. **NIP-44**（189 行＋向量）繼續養著等 per-recipient 設計，還是先移出？
4. **Q2 cardKeyAttestation** 這版做不做（不做＝名片訂閱指標就停在只 refresh 已存）。
5. **19 條無入口路由**：06 說「這次不裁」，但 §B 顯示其中一條是救援碼入口 — 至少該單獨處理。
