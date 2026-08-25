# solidarity — QR 與交換統一規格（App／Web／creds 設計對齊版）

> 2026-08-24 · 對象：`airmeishi` 分支 `2.0.0`（HEAD `f0a9529`＋本輪修正）、`airmeishi-web` 分支 `feat/creds-design-alignment`（`b06ab7e`）、`creds-design`（CREDS.md v5 · mock v3.9）。
> 目的：QR 的三代 wire、Nostr 交換核心、與 creds 設計（已定案 #17、§3.3、§3.5）之間的**單一對照表**。之前這些事實散在四份互相過時的文件裡（見 §7）。
> 引用規則：程式碼行號以本日 HEAD 為準；與程式碼不符時以程式碼為準並回來改這裡。

---

## 1. Wire 格式總表 — 現在真的存在的每一種

「發射端／接收端」都經過 caller 追蹤，不是檔名印象。三代 wire 並存是**刻意的**：`crd1Envelope.ts:14-16`「old wires keep scanning forever; CRD1 is the preferred emission, not a flag day」。

| # | 格式 | 識別方式 | 編碼鏈 | 簽章／加密 | 容量／效期 | 發射端 | 接收端 | 狀態 |
|---|---|---|---|---|---|---|---|---|
| 1 | **CRD1 名片 wire** | `CRD1:` 前綴 | claims→CBOR→COSE_Sign1(tag 18)→zlib→Base45 | ES256 單簽（名片簽名 did:key，`signRaw` 64B r‖s） | 2,420 字元硬限 · exp 夾 30 天 · EC-Q | `buildCrd1CardWire`（`cards/crd1Envelope.ts:46`），`solidarityQrRuntime.ts` 優先嘗試；08-25 起 claims 可帶 `subscription.nostr` 訂閱指標（§3 v1.1，僅綁定 verified 時） | `envelopeHandler.ts` → `verifyCrd1Wire`（含 holder-binding fail-closed）；指標經簽章覆蓋才萃取 | **現行首選** |
| 2 | **CRD1 證據包** | `CRD1:` ＋ claims `typ === 'gg.solidarity.evidence-pack.v1'` | 同上 | ES256 單簽（**root** did:key，`identity/rootKey`） | 同上；UI 即時字數表（`estimateCrd1` 不觸發生物辨識） | `app/me/evidence-pack.tsx` → `signEvidencePack` | `envelopeHandler.ts:182-202` 以 `typ` 分流 → `rebuildCardFromEvidencePack` | **現行** |
| 3 | legacy didSigned（裸 VC-JWT） | `eyJ` 開頭＋三段 | base64url JWT（無外包裝） | ES256 JWT | 無硬限；QR 級聯自 L 起 | `solidarityQrRuntime.ts` 在 CRD1 回傳 null 時後備 | `qrEnvelope.ts:75` 合成 v2 envelope → `handleDidSigned` | 永久後備（同一個 claims builder，掃出同一張卡） |
| 4 | legacy zkProof envelope | `sce1:`（raw-DEFLATE）或裸 JSON | JSON envelope(version:2) 內嵌 `encryptedPayload` | AES-GCM **同發送者主鑰**（收方須持同鑰＝同帳號多裝置模型，不是收件人加密） | 預設 24h 效期 | `buildZKEnvelope`（`solidarityQrPayload.ts`）；**新卡預設格式**（`sharing/defaults.ts:86`） | `handleZkProof` → 解密＋lazy 驗 `sdProof`／`issuerProof`（08-24 起：issuerProof 收發兩代 wire 都吃、且 scope/signal 須綁定本 envelope，見 §7） | legacy（Swift parity；§3.3 落地後應讓位） |
| 5 | legacy plaintext envelope | 裸 `{` JSON | stableStringify，無壓縮 | 無 | 無 | 僅作為 didSigned／zkProof 建構失敗的自動後備 | `handlePlaintext`（一律 `Unverified`） | legacy 後備 |
| 6 | Verified Page fragment | `https://app.solidarity.gg/#<blob>`（或裸 blob） | profileJws→deflateRaw→base64url | JWS（root did:key 自驗）；離線、零網路 | 軟預算 2048B（僅旗標）；decode 硬限 16KB/64KB | `meProfileModel.ts`（Me 分享面、onboarding） | 掃描：`verifiedPageHandler`；deep link：`parser.ts`（僅信任網域） | **現行** |
| 7 | Nostr 短指標 | `…#nostr:<npub>` | — | 解析後走 kind 30078＋反向綁定檢查 | — | `meProfileModel.ts:79`（僅在 JWS 已確認發布時） | `resolveProfileByNpub`（app）／`ViewerLandingPage`（web） | **現行** |
| 8 | @handle URL | `https://app.solidarity.gg/@<handle>` | — | 解析鏈各自驗證（atproto／dns／ens／nip05） | — | `meProfileModel.ts:73-78` | app `verifiedPageHandler`＋web `/$handle` | **現行** |
| 9 | sqc1 多頁 QR | `sqc1.<session>.<i>.<n>.<sha256>.<b64url>` | 分片框架（`shared/src/qr/chunking.ts`） | 由內層 payload 決定 | 幀 ≤2,950B · 重組 ≤256KiB · ≤512 片 | VP 出示、護照 show、webSign 回應 | `QrScanner.tsx` 先重組再進分類器 | **現行**（運輸層） |
| 10 | passport_show_v1 | JSON 內含 `gg.solidarity.passport.show-presentation.v1` | JSON→`sce1:`→sqc1 | Noir ZK proof＋裝置簽名；nonce（challenge 或 time-bucket） | challenge 有效窗 | `PassportShowPresentation` | `handlePassportShowScan`（vk 釘死；ZK 模組缺席回 `zk-unavailable` 不降級） | **現行** |
| 11 | webSign req／res | `solidarity://websign?req=`／`https://<product-host>/websign#req=`；web 端 QR 為裸 compact JWS | — | 會話 P-256（web 拋棄式）＋root 簽最終 record | req 效期 300s | web `WebSignPanel`；app 回應走 Nostr 為主、QR 為離線後備 | app `classifyWebSignScan`（dev-mode 閘） | **現行**（dev-mode） |
| 12 | wallet-pass 匯入串 | `solidarity://contact?name=&job=&did=` | URL | 無 | — | `passBundle.ts:346-359`（pkpass 條碼＋app 內 QR＋剪貼簿） | **無** — `deeplink/parser.ts` 沒有 `contact` host 分支 | **斷裂**（發而不收；§6-1） |
| 13 | vCard | `BEGIN:VCARD` | vCard 3.0 文字 | 無 | — | 僅檔案分享（share sheet／AirDrop），**不進 QR** | 實際掃描路徑直接回 unknown（`envelopeHandler.ts:80-82`「no parser exists yet」）→ raw | 半死（§6-2） |
| 14 | `SOLIDARITY_VC::`／`AIRMEISHI_VC::` | 前綴 | — | — | — | **無**（全 repo 無建構點） | 只有 `qrCodeManager.parseQrPayload` 認得——而那整個函式**零 caller**（僅自身與一個測試引用），本列與「vCard 分類為 card」都只存在於死碼裡 | 死分類器（§6-3） |

掃描優先序（`app/scan/index.tsx` `finalize`，106-211）：dev-only 閘（OID4VP／offer／webSign 非 dev 一律「無法讀取」）→ webSign → credential offer → Verified Page（fragment／pointer／handle）→ envelope 家族（#1-5、#10）→ legacy `classifyPayload`（vp_token）→ raw。
**2026-08-25 起**：finalize 在 Verified Page 分類後多一個分支——`parseDeepLink` 認出 **card／groupInvite／pear** 就轉交 `handleDeepLink`（§8-D 裁決），掃自家連結與 tap 行為一致。其餘 deep link kind（webSign／offer／OID4VP）維持各自的掃描儀式；`envelopeHandler.ts:74-77` 的 custom-scheme 跳過仍在（它現在只是讓 payload 落到上面那個新分支）。

---

## 2. 交換儀式 — 對 creds 已定案 #17

**設計**（CREDS.md:59＋mock `#pg-scan` 工程標註 4311）：交換全部走 QR，一次一個方向；主按鈕「加入，換我出示」把反向掃描接在加入後面，不假裝是同步配對；「只加入」保留單向。不做 NFC／藍牙**配對**（金屬卡的 NFC 是單向 NDEF URL 載體，不是配對，不衝突）。邀請連結型 QR 七天效期。

**App 現況**：wire 層已符合（單向、一掃一存、無配對 session），而且**「換我出示」的接續 UX 也已經做了**——`ReceivedCardSheet` 的主按鈕就是 `receivedCard.saveAndPresent`（zh-Hant 字串即「加入，換我出示」），存檔成功後 `onShowMine()` 直接 `router.replace` 到 Present tab（`ReceivedCardSheet.tsx:100-127,201-214`＋`_layout.tsx:339-342`）。尚缺的只剩掃描失敗文案（還不是 mock 的「這不是 creds.id 的 QR」語意）與邀請連結七天效期概念。1.3.3 spec（01 §2:30）「互換自然湧現，不需要配對 session」與 creds 設計在這一點**完全一致** —— 舊新之間沒有衝突。

---

## 3. 舊 Nostr 解法 — 核心對應（creds §3.3）

| §3.3 要求 | 現況（2026-08-25 起） | 證據 |
|---|---|---|
| 交換 payload 含**雙方 pubkey ＋ relay 提示**＝日後自動更新的訂閱憑據 | 🟡 **Verified Page 流已有**（npub 隨簽名 record 的 `alsoKnownAs` 走）；名片流（CRD1 claims）與 relay 提示欄位仍缺 | `people/contactAutoRefresh.ts` 直接吃 `record.alsoKnownAs`；`solidarityQrPayload.ts`／CRD1 card claims 仍無 npub/relay 欄位 |
| 掃後**自動更新**（訂閱對方 HEAD，本地 diff 產生「X 更新了」） | ✅ **v1 已落地**（前景節流掃描；詳下） | `people/contactAutoRefresh.ts`＋`_layout.tsx` AppState hook＋`contactAutoRefresh.test.ts` |
| HEAD 走 **NIP-78 replaceable event** | ✅ **已有** | kind 30078 · `d='solidarity.profile'`（`nostr/publish.ts:74-77`）；publish＋fetch＋反向綁定檢查全通；web 端同一套（`fetchProfilePointer.ts:3-4`） |
| 名片限定欄位以 **NIP-44** 加密給收件人 | **可選 lane（2026-08-25 裁決）**——Pear lane 留任私密通道；全 repo 目前零 NIP-44 | 唯一近親是 Sakura 的 X25519 ECIES（不同曲線、不同子系統）與 zkProof 的同鑰 AES-GCM（同帳號模型，不是收件人加密） |
| 交換單向 QR、換手再掃 | ✅ 形狀已符 | §2 |

**基座已就緒的部分**（做 §3.3 時直接沿用）：Nostr publish key（`nostr/userKey.ts`，root mnemonic HKDF 派生或 nsec 匯入）、relay 集（`DEFAULT_RELAYS = damus/nos.lol/primal`，app 與 web **逐字元一致**）、kind 0 `alsoKnownAs` 合併（不覆寫他人欄位）、NIP-05 註冊（`solidarity.gg/id/*`，NIP-98 簽頭）、事件驗證信任邊界（`dag/nostrAdapter.verifyNostrEvent`）。

**裁決（2026-08-25，使用者）**：**Pear lane 留任私密欄位／完整名片通道；NIP-44 改為「可選的後續 lane」**（不是必要路徑、不擋任何工）。§3.3 的公開面訂閱層因此解鎖。

**已落地（2026-08-25 · v1）——公開 HEAD 自動更新 lane**：
1. `people/contactAutoRefresh.ts`：已存的 VerifiedSnapshot 只要簽名 record 的 `alsoKnownAs` 含 `nostr:<npub>`，那就是它自帶的訂閱憑據。App 開啟／回前景時跑**一次節流掃描**（每 6h 至多一次、每次至多 30 人、開始前先蓋時間戳防 relay 轟炸），逐一走**與掃描器同一條**驗證管線（`resolveProfileByNpub`：JWS＋反向 npub 綁定）與**同一套**新鮮度合併（`mergeVerified`），真的變新才進「最近更新」。裝置端產生、無伺服器無推播（mock F8 v1 誠實面）。掛載點：`_layout.tsx` AppState hook（onboarding 完成後才啟用）。
2. 安全規則（測試釘住，`contactAutoRefresh.test.ts`）：**掃描永不新增／替換人**——解析回來的 record.did 必須等於已存 did，否則丟棄（npub 持有者發布別人的有效簽名 record 也不能讓背景掃描存進新身分）；失敗逐人靜默（離線是常態），不標 stale。
3. **v1.1（2026-08-25 · 同日第二輪）——名片流訂閱＋NIP-44 原語＋root 出處**：
   - **簽名名片 claims 的訂閱指標**：`vc.credentialSubject.subscription.nostr = { npub, relays[] }`——只上**簽名 wire**（CRD1＋legacy didSigned JWT；未簽名的 plaintext／zkProof 永不攜帶，否則改封包者可改訂閱目標）；發射端只在自己的 Nostr 綁定**當下為 verified** 時放（`cards/nostrPointerClaim.ts`，讀 badge-status cache），relay 提示＝`DEFAULT_RELAYS` 前 3。舊掃描器忽略未知欄位，加法相容。證據包另路：其 `verified` 的 nostr binding 列本身就是指標，掃描端同樣萃取。
   - **接收信任邊界（v1，2026-08-25 審查後強化，測試釘住）**：指標只證明「名片簽署者聲稱此 npub」——今天沒有任何東西把名片簽名鑰綁到頁面 root did（A5b 的 `cardKeyBinding` JWS 綁 aud＋nonce＋300 秒，靜態 QR 用不了），攻擊者名片可聲稱**第三人**的真 npub。因此 bootstrap（`people/cardSubscriptionBootstrap.ts`，存卡成功後 fire-and-forget）規則：
     - **先離線閘、後連線**：先在已存的 Verified Page 裡找「自己的簽名 record 已宣告 `nostr:<npub>`」的那一張；**找不到 → `skippedNewDid`，完全不連任何 relay**（否則惡意 QR 會把每次存卡變成對攻擊者選定 pubkey 的 relay 往返＝讀取回執＋IP 洩漏）。學新綁定仍是明確動作（掃他的頁／開他的 handle），等 v2 root 簽名 attestation。
     - **relay 提示 v1 一律不撥號**：提示是攻擊者控制的主機，連上去本身就是攻擊；且今天沒有任何發射端產生非預設提示。解析只走 `DEFAULT_RELAYS`。提示欄位保留作 forward-compat。
     - **只 refresh 命中的同一格**：解析回來的 record 必須 did **與** scope 都等於命中的那張快照，才 `mergeVerified`——保證 `mergeVerifiedSnapshot` 以既有快照為新鮮度基準（真 T5），永不走「建新 slot」的無條件覆寫分支（否則一個 scope-rank 較高的新 slot 會蓋掉並隱藏使用者原本較新的較低 scope 快照）。did 或 scope 不符 → `mismatch`，不動。
   - **v2 設計（未做）——`solidarity.cardKeyAttestation.v1`**：root 鑰簽的長效 JWS `{typ, rootDid, cardDid, iat}`（無 aud/nonce），鑄一次快取、隨簽名 claims 攜帶；接收端以解析回來的 record.did 驗簽＋要求 `cardDid` === 名片簽名 did——成立後「新 did 靜默訂閱」才安全。鑄造時機掛在本來就要 Face ID 的簽名動作上。
   - **NIP-44 v2 原語已落地 shared**（`packages/shared/src/crypto/nip44.ts`）：conversation key（secp256k1 ECDH x → HKDF-extract salt `nip44-v2`）→ per-message HKDF-expand(76) → padding（官方表）→ ChaCha20 → HMAC-SHA256（constant-time 比對）→ base64 `v2‖nonce‖ct‖mac`；**釘官方測試向量**（`vectors/nip44.json`，conversation-key／padding 表／encrypt-decrypt／invalid 全組）。尚無消費者——限定欄位的每收件人發布（事件 kind／gift-wrap 與否）是下一個設計決定，該決定前不接線。
   - **仍待做**：限定欄位 per-recipient 發布設計＋接線；v2 attestation；per-contact relay 提示持久化（等有非預設 relay 的真實需求）。

---

## 4. 新 QR — CRD1 細節（creds §3.5）

**與設計一致**（`packages/shared/src/qr/crd1.ts`，`__tests__` 有 vectors）：`CBOR→COSE_Sign1(tag 18)→zlib→Base45→"CRD1:"`；2,420 硬限（encode 回 `over-capacity` 不截斷、decode 直接拒收超長）；效期夾 30 天（±300s 時鐘偏移）；EC-Q；`estimateCrd1` 用不可壓縮填充驅動即時字數表（不觸發 Face ID）；zlib 解壓上限 64KB 防 zip-bomb；protected header 恰為 `{alg:ES256, kid:<did>#0}`，任何多出來的成員 fail closed。

**誠實偏離設計稿（archive/CREDS-MASTER.md §12 的 payload 形狀）——已在程式碼註解記錄，這裡是文件面的正式紀錄**：
- 無 `creds.id` 副署、無透明日誌位置（`log:{id,index,hash}`）——這兩樣需要尚不存在的伺服器基礎設施；repo 規則「不假造」，所以**誠實缺席**而不是塞假值（`crd1.ts:22-25`、`evidencePack.ts:9-13`）。透明日誌（tlog-tiles＋Tessera）落地時再補欄位＋bump `typ`。
- `iss`＝holder 的 did:key（不是設計稿的 `"creds.id"`）；`iss === kid` 的 did 且與內嵌 subject key 互相綁定（holder-binding fail-closed，`crd1Envelope.ts:96-117`，對應 progress.md 的 holder-binding bug class）。
- 證據包 claims 的誠實規則：`verified` 列只來自 badge-status cache 的**已完成即時查驗**（`checkedAt` 隨包攜帶）；stale/declared/純連結一律 `declared`；`revoked` 不可入包（`evidencePack.ts:55-99`）。

**兩種 CRD1 一個掃描口**：名片 wire（無 `typ`）重建整張卡、狀態 `Verified`；證據包（`typ` 判別）重建最小聯絡卡，卡級 `Verified` 需**每一列**皆 verified 且非空集，否則 `Unverified` —— 單列 declared 永不升級。

**容量超限的後備**：設計說「減少項目，或改用可查驗連結」——不做多頁 QR（sqc1 是 VP／護照／webSign 的運輸層，證據包刻意不用）。

---

## 5. Web 表面（airmeishi-web）

**現況**：真 SPA（Vite＋React＋TanStack Router），**不是** static mock。三條路由：`/`（landing＋`#fragment`／`#nostr:npub`／`#did:key`）、`/edit`（builder＋webSign）、`/$handle`（`/@handle` viewer）。解析鏈與 app 同源：NIP-78 HEAD＋反向綁定、atproto 雙向、dns/ens/nip05 反替換檢查、presence-only disclosure badge —— 全部無假綠。web 產生的 QR 只有 webSign request（裸 JWS）與 `/@handle` 分享連結；**web 沒有任何掃描（相機）能力**，回應通道是 Nostr 輪詢或貼上。

**creds 設計要求但完全不存在的 web 路由**：`/p/<id>`（匿名證明驗證頁，核心）、`/list/<id>`（語意錨點）、`/poll/<id>`（瀏覽器投票）、`/join/<code>`（mock 有、CREDS.md §2.2 表漏列）、`/c/<code>`（金屬卡解析）。前三條屬清單線（引擎凍結中）；`/c/<code>` 見 §8-B。

**vendored shared 同步規則（本輪已修的 drift 根因）**：web 以 `vendor/solidarity-shared-1.3.3.tgz` 建置（CF Pages 只 clone web repo）。2026-08-24 的 `d08de91`「vendor 刷新」打包自 08-19 之前的舊 checkout —— **整個 CRD1 codec（crd1/base45/cbor.ts）缺失**＋`handles/nip05.ts` 少了 `redirectExpired()` 安全修正。已於本日以 `2.0.0` HEAD 重打包並強制清快取重裝（106 tests 全綠）。規則：
1. 每次 `packages/shared` 變更後照 `vendor/README.md` 重打包；
2. **同版本重打包必須 `rm -rf node_modules && bun pm cache rm` 再裝**（bun 以版本鍵快取 tgz，檔案變了快取不變）；
3. 驗收：`tar -tzf` 比對 `src/` 檔案清單＋跑 web 測試。長期解是打包時把 git SHA 寫進 tgz 檔名或 CI 比對 shasum。
4. 附帶事實：`vectors/` 無 `crd1.json`，`appParity.test.ts` 只釘 fragment／JWS —— CRD1 的 app↔web 相容性目前**沒有**向量護欄；web 要驗 CRD1 時先補向量。

---

## 6. 斷裂與死碼清點（處置建議，皆 S 級）

1. **wallet-pass `solidarity://contact`**（#12）：pkpass 條碼／app 內 QR／剪貼簿三處發射，parser 無 `contact` 分支 —— 自家 QR 自家讀不了。`/cards` 本身在 41 路由清點中屬無入口組 → 隨無入口路由一起裁（補 parser 分支或整組刪）。
2. **vCard**：`vCard.ts` 模組註解原寫「Used by the Share tab so the QR payload is a vCard」——實際只走檔案分享（註解已於 08-24 修正）；掃描端無解析器，直接 raw。決定要不要真的解析第三方 vCard QR。
3. **`qrCodeManager.parseQrPayload` 整個函式是死碼**（零 caller，僅自身與 `crd1Envelope.test.ts` 引用）——`SOLIDARITY_VC::`／`AIRMEISHI_VC::` 分支、vCard→card 分類都只活在裡面。整個函式可刪或併回真掃描口。
4. **掃描器不吃自家 deep link**：~~印成 QR 後在 app 內掃描顯示「無法讀取」~~ **已修（2026-08-25，§8-D 裁決）**——finalize 新增「認得就轉交 deeplink router」分支（僅 card／groupInvite／pear 三種）。
5. **`maxUses`／`currentUses`**（`solidarityQrTypes.ts:123-124`）：無任何 builder 填值的殭屍欄位。
6. **webSign 回應 QR 未過 `compressForQR`**（`websign/review.tsx:108-111`）：sqc1 家族唯一不壓縮的成員（dev-mode，低優先）。
7. **`buildOid4VpRequestUrl`**：刻意死（兩條路由改 redirect、測試釘住不得回歸）——不是缺陷，保持。
8. **issuerProof root 出處**：~~未驗~~ **已補並修正（2026-08-25 兩輪）**——掃描端以 `zk/issuerProof.isKnownGroupRoot`（本機群組 canonical root 逐一重算比對）判定出處。**關鍵修正（審查發現）**：root 必須取自**已驗證的內層 `proofJson.merkle_tree_root`**，不是外層 wire 欄位——原本讀外層 `merkleRoot` 是無效檢查（native 只驗 `proof.proofJson`，攻擊者對自造群組出有效 SNARK 再把外層 root 設成受害者認得的值就繞過；測試 `does NOT trust a spoofed outer merkleRoot` 釘住）。同理 08-24 的 scope/signal「envelope 綁定」也讀外層，對 crafted wire 是 no-op，**已移除**——字串↔field-element 的健全綁定需要 native hash helper，隨凍結的 Semaphore lane 延後；當前信任僅靠內層 root 出處，而 zkProof envelope 仍是同主鑰 escrow（第三方到不了這條路）。語意三分（測試釘住）：密碼學失敗 → `Failed`；宣稱 `is_human` 卻無任何 issuer proof → `Failed`（說謊，非查不了；所有 `Failed` 條件在任何降級為 `Unverified` 之前先評估，含 `age_over_18` 無 sd proof）；密碼學有效但內層 root 不在本機任何群組 → `Unverified`（查不了，同帳號第二台沒同步群組時落此，誠實）；密碼學有效＋內層 root 已知 → `Verified`／`is_human` 點亮。已知殘留：群組 store 在 boot 背景 hydrate，掃描早於 hydrate 完成時合法證明會暫報 `Unverified`（fail-safe，永不誤判 Verified）。

---

## 7. 對既有文件的修正紀錄（2026-08-24）

| 文件 | 過時之處 | 現況 |
|---|---|---|
| creds-design `docs/2026-08-18-airmeishi-app-convergence.md` 列 10 | 「✅ 交換走 QR」 | 形狀 ✅ 但 §3.3 訂閱憑據整層缺（本文件 §3） |
| 同上 列 18 | 「🔴 格式不是 CRD1」；並引用 `profileQrCapacity` | CRD1 已於 08-19（`472b417`）落地 app＋shared；`profileQrCapacity` 不是 src 模組——只有同名測試檔 `__tests__/unit/profileQrCapacity.test.ts`（測的是 `me/profileShareQr.ts` 的容量門） |
| 同上 列 19 | 「airmeishi-web 是 static mock」 | 已是真 SPA（§5）；缺的是 creds 四條路由，不是「整個 web」 |
| `docs/ref/01/03/04`＋`.superpowers/sdd/progress.md` | 全部停在 1.3.3 合併點（`d0143eb`）之前 | 之後的 creds-v3 重建（Present/Page/Contacts/CRD1/NIP-05/evidence pack）完全未入帳；progress.md 對 CRD1 這一片安全面**零審查紀錄** |
| `docs/ref/03` §6 處置表 | 無 `sakura/` 列 | Sakura（Shoutouts relay＋push routing）可達且被 vault shard 依賴，處置未定 |
| airmeishi-web `docs/design/qr-pairing-*.md`、`README.md` | mock-fragment 時代／React Router v7／`src/routing/` | 皆與現碼不符，僅考古用 |
| 本輪程式修正（一） | — | `buildZKEnvelope` 不再把 `issuerCommitment` 放進分享 payload（lists-anonymity audit 2026-08-18 §5 唯一急件；roster＋commitment＝查表去匿名化）。精確定性：該 payload 整包先經 AES-GCM 同主鑰加密才上 wire，所以不是「wire 上明文」——威脅是**任何能解密的一方**（今天＝同帳號裝置；未來任何脫離 escrow 的傳輸）都能查表識人，故屬 defence-in-depth＋為 §3.3 脫離 escrow 預先關門。`IssuerProofResult` 一併移除 commitment 欄位（結構上不可再犯）；型別欄位保留 parse-only legacy 註記；回歸測試釘住（`envelopeHandler.test.ts` issuerProof describe，audit 要求「要有測試守住」） |
| 本輪程式修正（二） | — | **issuerProof wire 形狀 bug（審查發現，pre-existing）**：發射端原本只放 inner Rust proof JSON，掃描端 JSON.parse 後直接餵 `verifyGroupProof`——但兩平台原生都讀 `proof.proofJson`，所以凡帶 issuerProof 的 envelope 一律掃成 `Failed`。修正：發射端改序列化**完整 `SemaphoreProof`**（與 `vault/zkAgeVerification` 同 convention）；掃描端兩代 wire 都吃（完整 envelope 直通；legacy inner JSON 包回 `proofJson`）；並新增**envelope 綁定**——proof 的 scope／signal 必須等於 payload 的 scope／shareId（或其 32-byte UTF-8 clamp），不綁定不進驗證器（堵「自造群組的有效證明點亮 is_human」，§6-8 的前半）。五條測試釘住 |

---

## 8. 裁決紀錄與待裁決

**已裁決（2026-08-25，使用者）**：
- **A · 私密欄位通道**：**Pear lane 留任**；NIP-44 為**可選的後續 lane**（不擋工）。§3.3 公開訂閱層據此落地（§3）。`pear/*` 與 Android 原生因此**不砍**（convergence §5.3 的 QR 面就此收斂；Android 對等支援的整體去留仍是另一題）。
- **B · creds.id**：**dev mode 先行**——`creds.id` 在 developerMode 下計入 product host（`domainVerification.ts` `DEV_PRODUCT_HOSTS`，deep link＋掃描 `/@handle` 兩個閘都吃這個旗標；一般使用者維持 A5.4 姿態），**預設 origin 維持 `app.solidarity.gg`**（`PROFILE_PAGE_ORIGIN` 不動）。`/c/<code>` 的 registry 問題與路徑同名衝突順延到 creds.id 正式啟用時再裁。

- **C · 分級字母（2026-08-25 裁決，授權代決）**：**採 creds T1（A=公開可複驗／B=一次性授權／C=國家 PKI）為唯一分級**，1.3.3 §5 的 S/A/B/C 字母作廢（映射：1.3.3 S＋C → creds A；1.3.3 A → creds C；B 不變）。理由：驗證卡文案（CREDS.md §3.1 逐級的「驗證卡那一行」）建立在 T1 上，且程式碼裡沒有任何地方用到舊字母——純文件層改動。`01-spec-verified-page.md` §5 已加修訂註記；徽章內容（協定／驗證方式）不變。
- **D · 掃描器吃自家 deep link QR（2026-08-25 裁決，授權代決）**：**吃**——印出來的自家連結掃描時必須和 tap 行為一致。已落地：`app/scan/index.tsx` finalize 在 Verified Page 分類之後、envelope 管線之前，把 `parseDeepLink` 認出的 **card／groupInvite／pear 三種**（僅此三種——webSign／offer／OID4VP 保留各自的掃描儀式，routing `oidc` 會繞過 dev 驗證結果 sheet）交給 `handleDeepLink`（同一套 dev-only 閘）。§6-4 就此關閉；失敗文案的 creds 措辭（「這不是 creds.id 的 QR」）等產品命名定案後再改。

---

> **批次層決策**（北極星、批次規則 airmeishi＞creds-design、Q1–Q6、舊功能去留、執行計畫）在 **`06-plan-convergence-2.0.0.md`**——本文件是其中 QR/交換的 wire 細節。

---

## 9. 驗證方法（複查本文件用）

```sh
# 三代 wire 的發射分派
sed -n '49,100p' apps/expo/src/cards/solidarityQrRuntime.ts
# 掃描口的格式分流
sed -n '60,210p' apps/expo/src/scan/envelopeHandler.ts
# CRD1 codec 與硬限
sed -n '1,60p' packages/shared/src/qr/crd1.ts
# §3.3 缺口三連（應為 0 hits／0 hits／一次性 merge）
grep -rniE "nip-?44" apps/expo/src packages/shared/src
grep -rn "relays" apps/expo/src/cards/ packages/shared/src/profile.ts
grep -n "mergeVerified" apps/expo/src/components/scan/VerifiedPageResultSheet.tsx
# web vendored shared 是否含 CRD1
tar -tzf ../airmeishi-web/vendor/solidarity-shared-1.3.3.tgz | grep qr/
```
