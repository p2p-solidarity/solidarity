# 04 — App 主軌 Implementation Plan(1.3.3 Verified Page)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 對應 spec:`docs/ref/01`(SSOT)、`02`(US)、`03`(機制分工)。Web 軌已移至 `~/Workspace/solidarity/solidarity-web/docs/ref/05-plan-web-viewer.md`、`~/Workspace/solidarity/solidarity-web/docs/ref/06-plan-web-builder.md`。

**Goal:** 把 apps/expo 從名片交換 app 轉換為 Verified Page holder:did:key 根身份 + 徽章綁定 + 無伺服器發布 + Pear 私有通道,同時執行拆除清單(Sharing/proximity/CloudKit 群組/SpruceKit 瘦身)。

**Architecture:** 驗證與格式邏輯全部住在新的純 TS 套件 `packages/verify-core`(app 與 web 共用,同一組 conformance 測試向量);app 只持有金鑰、IO 與 UI。Pear lane 是 day-0 設計:challenge 格式在 A1 定案、schema 在 A2 承諾 append-only、A3 立刻 PoC。

**Tech Stack:** Expo RN(bun、prebuild、dev client)、`@noble/curves`/`@noble/hashes`(已在 deps)、`@scure/base` + `fflate`(新增,零依賴小庫)、react-native-bare-kit + Hyperswarm(A3+)、既有 keychain / passport / oidc / dag 模組。

## Global Constraints(每個 task 隱含)

- UI 一律 `ThemedButton` / `ThemedText` / `ThemedSurface` / `Colors` token;禁止 inline hex 與自製按鈕(apps/expo/CLAUDE.md 規則 1–5)。
- 禁 `Alert.alert` — 用 `confirmDialog` / `appAlert` / `showError`(既有 error popup 系統)。
- 安全路徑(簽名/NFC/金鑰):回傳 `Result`、不 force-unwrap、不 log PII;**簽名動作一律過 Face ID 閘控**。
- No fake data:任何資料驅動 UI 只有 `loading / ready / error` 三態。
- i18n:新字串進 `src/i18n/` en + zh-Hant 兩份。
- 首繪不 await(規則 10);新 store 走 zustand + MMKV 既有模式。
- 驗證基準:repo 的 bun test / lint 底線是髒的 — 驗收以「不新增失敗」為準(stash-diff 比對)。
- Nitro `ArrayBuffer` 參數不得在 `Promise.async` 內讀取(先 copy)— apps/expo/CLAUDE.md 錯誤處理章。

---

## 方向決策 2026-07-16(grill 定案 — 本區覆蓋下方 phase 順序與相關 spec 條文)

> 與使用者 grill 後定案。這些決策**改寫優先序**:先打穿一條主流垂直線,再鋪廣度。
> 下方 A6–A12 的原始順序作廢,改依 **D6 v1 脊椎** 執行。對應 spec 條文改動見
> `01-spec-verified-page.md` 頂部同日 amendment。決策依據見「完成階段真相」:
> 十種徽章只有 Nostr 能端到端亮綠勾;viewer 目前是靜態 mock(徽章讀
> `airmeishi-web/src/data/foundation`、驗證明文延到 web Phase V2–V3、且 web 未
> depend `@solidarity/shared`),「無伺服器也能驗」的地基尚未接上線。

**D1 — 單一 did:key 根身份(收斂)。** 舊 Spruce `master.v2` 第二根鑰匙 + 舊
business-card 交換 QR wire 退場;新 seed 派生 did:key 為唯一身份。同一助記詞 = 同一
did(§3 既有原則,現正式收斂,不再並存)。coexistence 決策 #3 = **收斂,不等 A10**。
使用者第一性原則:did:key 是核心不退場;助記詞對用戶應**不可感知**;VC+VP 是給
Nostr/profile/Pear 的**附加**價值。

**D2 — 交換 QR 收斂成 profile fragment。** 互掃行為保留,但那顆 QR 的 payload 從舊
wire 改為新 profile fragment(Verify 掃描器 A2.3 已能解)。兩顆 QR 塌成一顆。

**D3 — SpruceKit SDK 退場、留簽名殼。** 砍 SPM `sprucekit-mobile` + Android Maven
`com.spruceid.mobile.sdk` + `withSpruceIdSpmPackage.js` + 5 個死方法(`didKeyFromAlias`/
`didDocumentJson`/`verifyJws`/`signCredentialJwt`/`verifyCredentialJwt`);留 8 個硬體
簽名方法(住 `SpruceDidKeyStore.swift`,無 Spruce import)。= 原 A10.3,盤點見
`notes-sprucekit-slim.md`。殼改名 `nitro-signing-key` 選配。**注意:nitro module 本體
不可整包拔**(硬體簽名殼是 did:key 簽名的必要面),只拔 SDK。

**D4 — ZK 定位澄清(非反轉)。** 原則不動:ZK(passport-zk == zkmopro/OpenAC)
**仍 opt-in、永不進 hot path**。唯一改動:它是徽章庫**頂層 opt-in 徽章、保留在 App
內、不移出不刪**。A10 由「移除 OpenAC 呼叫、circuits 移出」改為「**OpenAC 保留為
opt-in 頂層;default passport 仍 SD-JWT(hot path)**」。zkmopro(Mopro mobile prover)
是「讓 device 端出證變簡單」的方向,深設計(zkmopro 換不換 passport-noir、passport
產 SD-JWT vs ZK attestation)另開 scoping。

**D5 — onboarding 收在真綠勾(選項 1)。** 新路徑結尾帶**一枚真徽章**(脊椎定 Bluesky
後即 Bluesky;純 did:key 用戶走 Nostr 免帳號 fallback)。Nostr(公開)× Pear(私密)
串聯 = A+B:Nostr 在 onboarding 拿真綠勾 + 一頁「公開頁 vs 私密房」兩面模型;
**Pear 天生兩方、不可 solo 假演**,第一次真實體驗獨立設計成 person-to-person 時刻。
CompleteStep 的空 `[ SYSTEM READY ]`(零綠勾)作廢。

**D6 — v1 脊椎 = Bluesky(凍結其他廣度)。** 先讓 **app OAuth → 寫 PDS record →
viewer 真的 getRecord + 驗 JWS 渲染 → 可分享於人類可讀 handle** 這一條端到端打穿。
一條線收掉 P1(viewer 由 mock 轉真)/ P2(主流徽章)/ P4(handle)/ D5(onboarding
綠勾)。`_did` DNS 由「本版重點功能」**降為第二條**,給有網域的 power user。原
A6.2–A6.4 升為主線;A7/A8/A9/A11 延後。

**D7 — Handle resolver seam:`solidarity.gg/<handle>`。** viewer 路由走可插拔的
`HandleResolver` 介面(定義住 `packages/shared`,app + web 共用);v1 只出
`AtprotoHandleResolver`(`@alice.bsky.social` → did:plc → PDS getRecord),但介面設計成
ENS(`alice.eth` → did:pkh,軟依賴一個 RPC,同 §8)、DNS(`_did` TXT)、NIP-05
未來**註冊即接、不改 router**。Router:第一個 `matches()` 為真者勝,皆不中落回
`#<fragment>`。

**D8 — viewer 必須 import `@solidarity/shared`、吃同一組 conformance 向量。** 目前 web
不 depend shared、徽章讀靜態 `data/foundation` = 「無伺服器也能驗」地基未接。web
V2–V3 落地時必須用 app 端同一份純函式驗證(03 §3 一致性鐵律:單向宣稱不畫綠勾)。

**D9 — IA:自己的徽章綁定歸 Me,不歸 Verify(建議,待使用者確認)。** Connect
Bluesky/Nostr 精靈從 Verify(驗別人)移到 Me(你的頁);Verify 專責掃描與驗別人。
降低「綠勾藏在錯分頁」的 P6。

**D10 — v1 beachhead = ATProto/去中心社交早期用戶(2026-07-16 定案)。** 一句承諾:
「你自己持有、任何人可驗、我們消失也活的身份頁 —— 你的 Bluesky handle + 你控制的
一切。」這群人「verified = 你此刻控制這個帳號」是 feature 不是 under-sell(自帶
handle、懂 did、在找可攜自持的身份頁)。onboarding/Me 全部文案以此語氣書寫。
創作者防冒充(US-07)= phase-2 擴張(撞 A11 bio 徽章);可驗證名片語境退居輔助。
產品北極星信號:早期用戶自發把頁貼進 Bluesky bio(spec §11)。

**Parked(另開 scoping,不在本輪):** passkey(did→passkey→助記詞,Architecture A:
seed 為本、passkey 用 largeBlob/PRF 當外殼,**不可讓 passkey-PRF 直接當身份**否則
助記詞可攜性死);ZK 深架構(見 D4);**A12 金鑰救援 + Android 救援故事(P5,已知
重大缺口 —— iCloud 只有 iOS、Android 掉手機沒抄 12 字 = 身份歸零 + 印出的 QR 全死,
需盡快排期)**。

**新增/改動任務(取代 A6.2 起的原順序)— 執行紀錄 2026-07-16(codex 實作 R1–R4,Claude 逐輪驗收 commit;S7 Claude 親做):**

- [x] **S1** atproto handle → DID resolver + `HandleResolver` seam(`390f863`;向量含 userinfo-host-injection、wrong-repo)
- [x] **S2** A6.2 PDS putRecord + 讀回驗證(`28c7b68`;connect 流程「aka→簽→put」建構上不可倒序,identityMatchesSession 防 OAuth 後 handle 劫持)
- [x] **S3** `badges/atproto.ts` 雙向驗證(`390f863`;stableJSON 精確比對防舊版 profile 頂替)
- [ ] **S4** viewer 接 `@solidarity/shared`(D8;`airmeishi-web` — **唯一未動工項,web 軌**)
- [x] **S5** onboarding connect 步 + Bluesky 精靈 + CompleteStep 真徽章(`8223774`;replacement 確認 pin session 身份;`clientMetadataUnavailable` 一等錯誤 — **client-metadata 部署到 solidarity.gg 仍 pending**)
- [x] **S6** Me = WYSIWYG 分享頁 + QR 收斂 + IA 搬遷(`911e9d2`;/share/qr 經查是 OID4VP 出示請求 QR,不在 D2 範圍,保留)
- [x] **S7a** SpruceKit SDK 退場(spec 13→8 方法、iOS SPM + Android Maven + config plugin + SPM pin 整包拔、nitrogen 重生成、prebuild + `-disableAutomaticPackageResolution` 驗證過;順修 prepare-ios-workspace.sh 的 stale 小寫 scheme 名)
- [x] **S7b** 身份收斂 — **落地語意(D1 精煉):舊 SE 硬體鑰「退位身份、留任簽卡鑰」**。硬體鑰物理上不可由助記詞派生,故「一個 did」= root did(seed、可攜)是唯一對外身份;SE 鑰簽 VC/SD-JWT/ZK 並經 A5b `solidarity.cardKeyBinding.v1` 錨定至 root。settings/dids 改為「根身份(主)+ 簽卡金鑰(錨定,非身份)」兩區呈現。憑證不需重發、既有資料不需遷移。ZK 面板的恆 null `didDocumentJson` 死狀態屬凍結面,不動(最小接觸)。

---

## Phase A0 — 拆除與畫面轉換

**Spec:** 執行 01 §9 刪除清單 + 03 §5 畫面轉換。先刪後建:縮小 surface、砍 nitro 橋接面、讓後續 phase 在乾淨的 IA 上落地。此 phase 結束時 app 三 tab = People / Me / Verify,功能等同現狀(憑證區塊只是搬家,不加新功能)。

**Files:**
- Delete: `apps/expo/app/(tabs)/share/`(整個 tab)、`apps/expo/src/proximity/`、`apps/expo/src/groups/cloudSync.ts`、proximity 對應的 nitro module(以 Task 1 盤點結果為準)
- Create: `apps/expo/app/(tabs)/verify/index.tsx`
- Modify: `apps/expo/app/(tabs)/_layout.tsx`(tab 定義)、`apps/expo/app/(tabs)/me/index.tsx`(下半區塊搬出、QR 展開卡併入)

### Task A0.1: 盤點與刪除 proximity / Sharing / CloudKit 群組同步

- [ ] `ls nitro-modules/` + `grep -rl "proximity\|Multipeer\|L2CAP" apps/expo/src nitro-modules --include="*.ts*" --include="*.swift" --include="*.kt"` 產出刪除清單,貼進 PR 描述
- [ ] 刪 `app/(tabs)/share/`、`src/proximity/`、`src/groups/cloudSync.ts` 與 proximity nitro module;`grep -r "from '@/proximity\|cloudSync"` 清乾淨殘留 import
- [ ] `bunx expo prebuild --clean --platform ios --no-install` 確認 config plugin 不再引用被刪 module
- [ ] `bun run typecheck` 0 新增錯誤;`bun test` 不新增失敗(proximity 相關測試一併刪除)
- [ ] Commit: `refactor(1.3.3): remove Sharing tab, proximity transport, CloudKit group sync`

### Task A0.2: 畫面轉換 — Me 名片化、Verify tab 骨架

- [ ] 新 Me:identity 卡(現 Me 上半)+ 原 Share tab 的 QR 展開卡合併為單一可展開名片元件 `src/components/me/VerifiedCard.tsx`(先渲染現有 DID + 名片資料,徽章列留空狀態)
- [ ] 新 `app/(tabs)/verify/index.tsx`:上段 = 掃描入口(復用 `src/scan/QrScanner.tsx` 導航)、下段 = 自 Me 搬入的憑證 / 選擇性揭露 / OIDC 區塊(元件原樣搬移,路由不變)
- [ ] `_layout.tsx` tab 順序:People / Me / Verify;刪 share tab 定義;ZK / 群組區塊依 03 §6 藏到 developer 設定
- [ ] 手動驗收(dev client):三 tab 全部可達、原 Me 功能在 Verify 內全部可用、無死連結
- [ ] Commit: `feat(1.3.3): Me becomes verified card, credentials move to Verify tab`

### Task A0.3: SpruceKit 瘦身盤點(執行在 A10)

- [ ] `grep -rn "spruceid\|SpruceIDMobileSdk" apps/expo nitro-modules --include="*.ts*" --include="*.swift" -l` 產出依賴面清單:標記「JWS/SD-JWT 必要」vs「可刪」,寫入 `docs/ref/notes-sprucekit-slim.md`
- [ ] Commit: `docs: SpruceKit slim-down inventory`

---

## Phase A1 — verify-core + 金鑰核心 + 恢復 + DID-challenge

> **AMENDMENT(執行時發現,2026-07-03)**:repo 既有 `packages/shared`(@solidarity/shared)已是「純 TS、零 RN 依賴、noble/scure/zod only」的共用套件,且已含 did:key P-256 codec(`identity/didKey.ts`)、ES256 JWT 簽驗(`identity/jwt.ts`)、P-256 keypair、HKDF、`Result` 型別。**不另建 verify-core — A1 起所有「packages/verify-core/...」一律改讀為「packages/shared/...」擴充**:新增 `canonical.ts`、`jws.ts`(compact-over-canonical,復用 jwt.ts 內部)、`challenge.ts`、`derive.ts`(新增 @scure/bip39)、`profile.ts`、`fragment.ts`、`badges/*`、`vectors/*`;既有 didKey/jwt 以向量補測不重寫。原 A1.1(did:key 重寫)縮為向量補測;原 A1.3(derive)併入 A1.2。05/06-plan 中的 `@solidarity/verify-core` 同義改讀 `@solidarity/shared`。

**Spec:** 建立 `packages/verify-core`(純 TS、零 RN 依賴、app/web 共用;**全部純函式、IO 注入 — v1 TS,API 保持可移植,未來可換 Rust 核心(app 走 nitro binding、web 走 wasm)而不動呼叫端**)。定案四個 day-0 格式:BIP39 seed 統一派生規則(同一助記詞在 App/Web 得到同一 did — 可攜的基礎)、did:key 編碼、compact JWS 簽名原語、DID-challenge。備份 UX(01 §3):**預設推薦 iCloud Keychain 且必須徵求同意**;助記詞只服務「拒絕 iCloud」與「自由匯入匯出」兩個場景,不強加給預設路徑。

**Files:**
- Create: `packages/verify-core/src/{didkey,canonical,jws,challenge,derive,index}.ts`、`packages/verify-core/vectors/*.json`、`packages/verify-core/package.json`
- Create: `apps/expo/src/identity/rootKey.ts`、`apps/expo/app/onboarding/backup.tsx`、`apps/expo/app/settings/identity-export.tsx`
- Test: `packages/verify-core/test/*.test.ts`(bun test)

**Interfaces(後續全部 phase 依賴):**
```ts
// didkey.ts
didKeyFromP256(compressedPub: Uint8Array): string        // 'did:key:zDn…' (multicodec 0x1200 → varint [0x80,0x24] + 33B SEC1 + base58btc)
p256FromDidKey(did: string): Uint8Array                   // throws on非 P-256
// canonical.ts — 自 apps/expo/src/dag/node.ts 抽出,app 端改為 re-export
stableJSON(value: unknown): string
// jws.ts — 唯一簽名原語,profile 與 challenge 都用它
type Signer = (bytes: Uint8Array) => Promise<Uint8Array>  // raw r||s 64B;app 端由 Face ID 閘控的 keychain 實作
signCompact(payload: object, did: string, sign: Signer): Promise<string>   // header {alg:'ES256', kid:`${did}#0`}
verifyCompact(jws: string, did: string): Result<object>   // Result = {ok:true,value}|{ok:false,error}
// challenge.ts
interface Challenge { v: 1; typ: 'solidarity/challenge'; requester: string; subject: string;
  purpose: 'verify.scan' | 'pear.card' | 'pear.present'; nonce: string /*32B b64url*/; ts: number }
buildChallenge(p: Omit<Challenge,'v'|'typ'>): Challenge
respondChallenge(c: Challenge, did: string, sign: Signer): Promise<string>  // = signCompact(c,…)
verifyChallengeResponse(jws: string, expected: Challenge): Result<void>     // 驗簽 + 逐欄比對 + ts ±120s
// derive.ts — 統一派生規則(App 與 Web 同一常數 → 同一助記詞 = 同一 did;06-plan W1 直接 import)
const HKDF_INFO_ROOT  = 'solidarity-root-v1'
const HKDF_INFO_NOSTR = 'solidarity-nostr-v1'
deriveP256Scalar(mnemonic: string, info: string): Uint8Array      // @scure/bip39 seed → HKDF-SHA256 → mod-n reduce
deriveSecp256k1Scalar(mnemonic: string, info: string): Uint8Array
```

### Task A1.1: verify-core 骨架 + did:key 編解碼(TDD)

- [ ] `packages/verify-core/package.json`:name `@solidarity/verify-core`,deps 只有 `@noble/curves @noble/hashes @scure/base fflate zod`;掛進 workspace(root package.json workspaces 已含 `packages/*` 則免動)
- [ ] 寫失敗測試 `test/didkey.test.ts`:已知向量 — P-256 壓縮公鑰 ↔ `did:key:zDn…` 往返、錯誤 prefix throw
- [ ] 實作 `didkey.ts`(varint prefix `[0x80,0x24]` + base58btc `z`);測試轉綠
- [ ] Commit: `feat(verify-core): did:key P-256 codec with vectors`

### Task A1.2: canonical + JWS + challenge(TDD)

- [ ] `canonical.ts`:搬 `stableJSON`(遞迴排序鍵),`apps/expo/src/dag/node.ts` 改 import re-export,dag 測試不變綠
- [ ] 失敗測試:`signCompact`→`verifyCompact` 往返、竄改 payload 驗證失敗回 `Result.error`、`kid` 不符 did 拒收
- [ ] 實作 `jws.ts`(ES256 over `sha256(signingInput)`,b64url 無 padding)與 `challenge.ts`;轉綠
- [ ] 產 conformance 向量 `vectors/{jws,challenge}.json`(固定 test key、含 3 個攻擊樣本:壞簽章、過期 ts、nonce 竄改)— **這份向量是 03 §3 app↔web 一致性的依據,web 軌 V4/W1 直接吃**
- [ ] Commit: `feat(verify-core): compact JWS + DID-challenge with conformance vectors`

### Task A1.3: derive.ts 統一派生(TDD)

- [ ] 失敗測試:固定助記詞向量 → 固定 did:key(deterministic;不同 info → 不同鑰);向量入 `vectors/derive.json`(**06-plan W1 web 端吃同一檔**)
- [ ] 實作 `derive.ts`(`@scure/bip39` seed → HKDF-SHA256 → mod-n reduce);轉綠
- [ ] Commit: `feat(verify-core): unified mnemonic derivation (app/web same did)`

### Task A1.4: App 根金鑰 + 備份 UX + 匯入匯出

- [ ] `src/identity/rootKey.ts`:onboarding 生成 seed → 派生 root did:key;seed 存 Keychain — iCloud 同意 → `kSecAttrSynchronizable`(注意:synchronizable 不能掛 biometry ACL,**Face ID 閘控改在簽名呼叫層以 LocalAuthentication 先驗**,語意不變);`getRootDid()`、`getRootSigner(): Signer` 回傳 `Result`;**助記詞/seed 明文絕不落 MMKV、不進 log**
- [ ] `app/onboarding/backup.tsx`(不可跳過):主問句「用 iCloud 備份你的金鑰?」(推薦、一鍵、講明同步範圍)→ 同意 = 完成;拒絕 → 助記詞儀式(顯示 → 隨機抽 3 詞回填確認)。**助記詞儀式只在拒絕路徑出現**
- [ ] `app/settings/identity-export.tsx`:匯出(Face ID → 顯示助記詞 + 截圖警語)/ 匯入(輸入助記詞 → 派生 did → 若與現有身份不同,確認後切換)— 自由匯入匯出,App ↔ Web 可攜
- [ ] 單元測試(mock keychain):Signer 輸出可被 `verifyCompact` 驗過;匯入同助記詞 → 同 did
- [ ] Commit: `feat(identity): seed-derived root key, iCloud-first backup with consent, free import/export`

### Task A1.5: iCloud Keychain 同步真正接上(執行時新增,2026-07-03)

背景:A1.4 執行發現 expo-secure-store 與 secrets-vault 都不暴露 `kSecAttrSynchronizable`;可行先例在 `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift:119`(該模組 A10 將刪除)。過渡期 iCloud 選項顯示「即將推出」停用(誠實規則)。

- [ ] 把 synchronizable 支援(~20 行)從 SpruceDidKeyStore 移植進 `nitro-modules/secrets-vault`(iOS;Android no-op — Android 本來只有助記詞路徑);nitrogen 重生成、prebuild 編譯過
- [ ] `rootKey.ts` iCloud 路徑接真同步(seed 存 synchronizable item、無 biometry ACL、簽名層 Face ID gate 不變);`rootKeySyncChoice` 由 intent 變為實際行為
- [ ] BackupStep 重新啟用 iCloud 選項(文案改回現在式,僅在真的寫入 synchronizable item 成功後前進);onboarding 流程恢復「同意 iCloud = 免助記詞儀式」
- [ ] 實機驗收(двух裝置同 Apple ID seed 同步)列入 checklist;模擬器至少驗 keychain 寫入成功路徑;Commit

---

## Phase A2 — Profile schema + fragment/QR + Verify 最小環 + Linktree 匯入

**Spec:** 01 §3 Profile Record 落地(含 `recoveryKey`);fragment codec(deflate+base64url,QR 承載);Verify tab 掃描 → 本地驗證 → 存入 People 的最小閉環(US-11);Linktree 匯入(US-19)。Schema 即 append-only 事件形狀(Pear day-0 約束 2)。

**Files:**
- Create: `packages/verify-core/src/{profile,fragment}.ts`、`apps/expo/src/profile/{store.ts,linktreeImport.ts}`、`apps/expo/app/me/edit.tsx`
- Modify: `apps/expo/app/(tabs)/verify/index.tsx`(掃描結果卡)、`src/contacts/`(存快照 + 驗證時戳)

**Interfaces:**
```ts
// profile.ts — zod schema,欄位同 01 §3(v/did/displayName/avatar/bio/links/alsoKnownAs/badges/supersededBy/updatedAt)
parseProfile(json: unknown): Result<ProfileRecord>
// fragment.ts
encodeFragment(profileJws: string): string    // fflate deflateSync → base64url;>2048B 回 warning flag(QR 尺寸預算)
decodeFragment(frag: string): Result<string>
```

### Task A2.1: schema + fragment codec(TDD,向量含攻擊樣本:單向 alsoKnownAs、超尺寸)
- [ ] 失敗測試 → 實作 → `vectors/profile.json`(合法 profile、壞 schema、2.5KB 超預算)→ Commit
### Task A2.2: Me 編輯 + 本地 profile store
- [ ] `src/profile/store.ts`(zustand+MMKV,`profile:v1` key;**更新永遠產新 record,不原地改** — append-only);`app/me/edit.tsx` 編輯 displayName/bio/links;儲存 = Face ID 簽 JWS
- [ ] VerifiedCard 掛真資料(loading/ready/error 三態);QR 展開 = `https://solidarity.gg/#<fragment>`
- [ ] Commit
### Task A2.3: Verify 掃描閉環(US-11)
- [ ] 掃描 → `decodeFragment` → `verifyCompact` → 結果卡(徽章逐枚 `verified/declared`,離線徽章標「未即時查驗」)→「存入 People」寫快照+時戳
- [ ] 手動驗收:兩台裝置互掃、飛航模式仍可驗 S 級
- [ ] Commit
### Task A2.4: Linktree 匯入(US-19)
- [ ] `linktreeImport.ts`:fetch 公開頁 → 解析 `<a>` 連結(linktr.ee DOM + 通用 fallback:抓 `og:` 與正文 http 連結)→ 回 `{label,url}[]`;**解析失敗回 error 態,不產假資料**
- [ ] Me 編輯內「從 Linktree 匯入」:預覽清單 → 勾選 → 併入 `links[]` 全標 `declared`;People 側「貼連結頁存聯絡人」= 同 parser + declared 快照
- [ ] 測試:fixture HTML 解析;Commit
### Task A2.5: Onboarding 改版(US-01)
- [ ] 既有 7-step onboarding 收斂為:歡迎 → 金鑰生成(A1.3)→ 恢復設定(A1.4,不可跳過)→ 引導綁第一個帳號(Bluesky / Nostr / Google 擇一,精靈本體在 A4/A6/A9 落地前先放「即將推出」以外的可用項)→ 產出頁面連結 + QR(A2.2)
- [ ] 驗收:新使用者 3 分鐘內拿到帶 ≥1 綠勾的頁(A4 完成後以 Nostr 路徑實測);全程無 email/密碼;Commit

---

## Phase A3 — Bare worklet 骨架 + Pear PoC(spike)

**Spec:** 全案最大未知數,越早撞牆越好(03 §7/§8)。目標只有一個:**兩台實機(iOS+Android)、不同網路,topic 相遇 → Noise 通道 → 雙向 DID-challenge 互驗**。參考 https://docs.pears.com/how-to/run-on-native/embed-bare-in-react-native/。

**Files:**
- Create: `apps/expo/pear/worklet/index.js`(Bare 側,bare-pack 打包)、`apps/expo/src/pear/{lane.ts,lifecycle.ts}`
- Modify: `apps/expo/app.json`(bare-kit config plugin)、`package.json`

**Interfaces:**
```ts
// lane.ts — RN 側對 worklet 的 IPC 封裝
startLane(myDid: string): Promise<Result<void>>
joinTopic(peerDid: string): Promise<Result<PearChannel>>   // topic = sha256(`solidarity/pear/v1|${peerDid}`)
interface PearChannel { send(frame: object): void; onFrame(cb: (f: object) => void): () => void; close(): void }
// 互驗:連上即交換 buildChallenge(purpose:'pear.card') ↔ respondChallenge;verifyChallengeResponse 過才放行 onFrame
```

### Task A3.1: 依賴與管線
- [ ] 加 `react-native-bare-kit`,prebuild(iOS+Android)過;dev client 建置寫進 `apps/expo/CLAUDE.md`(Expo Go 從此非開發路徑);CI(Xcode Cloud / EAS)確認可建
- [ ] Commit: `chore(pear): bare-kit + dev-client pipeline`
### Task A3.2: worklet + IPC echo
- [ ] `pear/worklet/index.js`:hyperswarm join(topic 由 RN 傳入)、IPC JSON 頻道;RN 端 `lane.ts` echo 測試(單機 loopback)
- [ ] Commit
### Task A3.3: 實機 PoC + 前後景生命週期
- [ ] 兩台實機不同網路互連;`lifecycle.ts` 接 `AppState`:background → worklet 停所有 I/O、foreground 重連;LTE↔WiFi、對稱 NAT 場景記錄結果到 `docs/ref/notes-pear-poc.md`(**穿不過的組合誠實記下,01 §8 v1 不做清單據此校準**)
- [ ] Commit: `feat(pear): PoC — cross-network DID-challenge handshake`

---

## Phase A4 — Nostr 發布 + Nostr 徽章

**Spec:** 01 §4 儲存面 2:profile 以 NIP-78 parameterized replaceable event(kind 30078、`d='solidarity.profile'`、content = profile JWS)發至 ≥3 公共 relay;kind-0 `alsoKnownAs` 含 did:key、profile `alsoKnownAs` 含 `nostr:npub…` → 雙向成立才 `verified`(US-03)。復用 `src/dag/nostrAdapter.ts` 的 WS client(publishEvent/subscribeEvents 原樣可用)。

**Files:**
- Create: `apps/expo/src/nostr/{userKey.ts,publish.ts}`、`packages/verify-core/src/badges/nostr.ts`
- Modify: `src/profile/store.ts`(發布狀態)

**Interfaces:**
```ts
// userKey.ts — 產線 Nostr 金鑰(secp256k1),keychain 保存;支援 nsec 匯入;與 sandbox dev key 完全分離
getNostrPubkey(): Promise<string>; signNostrEvent(unsigned): Promise<NostrEvent>
// badges/nostr.ts(verify-core,IO 注入)
verifyNostrBinding(profile: ProfileRecord, fetchEvents: (filter) => Promise<NostrEvent[]>): Promise<BadgeState>
// BadgeState = 'verified' | 'stale' | 'revoked' | 'declared'(01 §7 狀態機,badges/ 共用 enum)
```

- [ ] Task A4.1: userKey(生成/匯入/keychain)+ 測試
- [ ] Task A4.2: publish(30078+d tag,發 3 relay 取 2 OK;預設 relay 清單常數 `DEFAULT_RELAYS`,首次發布前使用者確認)+ kind-0 alsoKnownAs 更新
- [ ] Task A4.3: `badges/nostr.ts` 雙向驗證(TDD,向量含單向樣本 → `declared`)
- [ ] Task A4.4: Me 徽章列接 Nostr 徽章(三態 UI);Commit each

---

## Phase A5 — Pear v1 面:完整卡交換 + SD-JWT 私下出示(US-20)

**Spec:** A3 通道之上的 wire protocol。frame = length-prefixed JSON:`{t:'card.request'}` → `{t:'card.offer', card:<完整卡 JWS>}`;`{t:'present.request', claims:['over_18']}` → `{t:'present.response', sdJwt}`。收到 request 彈同意 sheet(選擇揭露欄位),送出過 Face ID。deep link `solidarity://pear/<did>` 進通道(viewer 端按鈕見 05-plan V3)。

**Files:**
- Create: `apps/expo/src/pear/{protocol.ts,consent.tsx}`、`apps/expo/src/deeplink/`(加 pear route)
- Modify: `src/pear/lane.ts`(掛 protocol)、`src/sakura/oidc/presenter.ts` 復用出示邏輯

- [ ] Task A5.1: protocol frame codec + 狀態機(TDD:亂序/未驗先送 → 拒收)
- [ ] Task A5.2: 完整卡交換 UI(People 詳情「請求完整卡」+ 收方同意 sheet)
- [ ] Task A5.3: SD-JWT 出示走既有 presenter,通道內驗證(復用 oidc/proofVerifier)
- [ ] Task A5.4: deep link `solidarity://pear/<did>`;實機雙向驗收(不同網路完整卡互換);Commit each

---

## Phase A5b — root-did ↔ card-signing-did 綁定(執行時發現,2026-07-03)

**背景(A5.3 review)**:Pear 私有出示中,握手密碼學上綁定 peer 到 **root-did**,但出示的 VP 是用結構上不同的 **card-signing-did** 簽的;`verifyVpToken` 已修成保證「VP 簽名者 == 內嵌 VC 持有者」(A5.3,fail-closed,惠及所有呼叫者含 OIDC),但原先**未**保證「card-signing-did 由認證過的 root-did 持有者控制」。

**落地決策(1.3.3)**:採 root key 簽一張短效 `solidarity.cardKeyBinding.v1` JWS,內含 `rootDid/cardDid/aud/nonce/iat/exp`;Pear responder 把此 binding 放進 VP 的 `solidarity.cardKeyBinding`,requester 用通道握手已驗證的 `peerDid` 作為 `expectedRootDid` 驗證。一般 OIDC/QR 呼叫不傳 `expectedRootDid`,行為維持原本只檢查 VP/VC holder binding。

- [x] Task A5b.1: 定案 card-did↔root-did 錨定機制(root key 簽 card-key 授權)+ `verifyVpToken`/Pear 出示驗證「出示者的 card-did 錨定到認證 peer 的 root-did」;TDD 攻擊樣本(peer A 出示 B 綁定的憑證 → 拒收)

## Phase A6 — atproto OAuth + PDS + Bluesky 徽章(US-02)

**Spec:** atproto OAuth(client-metadata.json 靜態掛 solidarity.gg — web 軌 V0 部署時一併放);lexicon `app.solidarity.profile` record 寫入使用者 PDS(`com.atproto.repo.putRecord`,rkey `self`,value = `{ jws: <profile JWS> }`);Bluesky 徽章 = record 存在(repo 所有權)+ JWS 內 `alsoKnownAs` 含 `at://<handle>` 雙向。PLC 解析快取 TTL 24h。

**Files:**
- Create: `apps/expo/src/atproto/{oauth.ts,pds.ts}`、`packages/verify-core/src/badges/atproto.ts`; Web repo static metadata:`~/Workspace/solidarity/solidarity-web/public/oauth/client-metadata.json`
- Test: verify-core 向量(壞 record、did 不符 repo)

- [ ] Task A6.1: OAuth(expo-auth-session,universal link redirect;token 存 SecureStore)
- [ ] Task A6.2: putRecord + 讀回驗證;斷線/撤權 → 徽章 `stale` 不誤標 `revoked`
- [ ] Task A6.3: `badges/atproto.ts`(公開 XRPC getRecord + did doc 解析,IO 注入;快取由呼叫端提供)TDD
- [ ] Task A6.4: Me 綁定精靈 UI(Verify tab 徽章管理區);Commit each

---

## Phase A7 — People 回訪重驗(US-12)

**Spec:** 開啟聯絡人詳情 → 背景從 PDS/relay 拉最新 profile(**不清畫面、不 skeleton** — 快照先繪,silent revalidate)→ diff:徽章新增/灰化/`supersededBy` 遷移提示。重驗引擎 = verify-core badges 全套,IO 用 app 端 fetcher。

**Files:** Modify `apps/expo/app/people/[id].tsx`、`src/contacts/`(快照 versioning);Create `src/verifyEngine/revalidate.ts`

- [ ] Task A7.1: revalidate(diff 演算法 TDD:新增/降級/遷移三案例)
- [ ] Task A7.2: People 詳情 UI(變化徽章帶標記;`supersededBy` → 「已遷移」卡);Commit each

---

## Phase A8 — `_did` DNS 綁定(US-04/05/15)

**Spec:** 01 §6。三層 onboarding:Domain Connect 探測(`_domainconnect` TXT → 註冊商 deep link)/ 引導貼 TXT(NS 判商 + 複製鍵 + DoH 30s 輪詢)/ `.well-known/did` fallback。驗證:原生 resolver + DoH(Cloudflare `cloudflare-dns.com/dns-query` + Google `dns.google/resolve`,`application/dns-json`)交叉;AD flag → DNSSEC 加成;NXDOMAIN → `revoked`。

**Files:** Create `apps/expo/src/domains/{doh.ts,domainConnect.ts,wizard.tsx}`、`packages/verify-core/src/badges/dns.ts`

- [ ] Task A8.1: `badges/dns.ts`(TXT 解析 `did=…` + 雙向 + AD 判定;TDD,向量含 NXDOMAIN/單向)
- [ ] Task A8.2: DoH client(app 端 fetcher,雙 resolver 交叉,結果不一致 → `stale`)
- [ ] Task A8.3: 精靈 UI 三層 + 輪詢(前景 30s;離開 app 回來續跑;完成本地推播);Commit each

---

## Phase A9 — OpenPubkey OIDC 徽章(US-06)

**Spec:** 01 §5 B 級。OAuth `nonce = base64url(sha256(jwkThumbprint(did:key 公鑰) || rand))`;id_token 即 PK Token。保存 `{idToken, rand, provider}`;驗證 = IdP JWKS 驗章 + nonce 重算 + 效期;顯示「驗證於 iat」;到期一鍵刷新;公開展示剝除 email(遮罩)。首發 provider:Google + LINE + Discord(其餘同機制加 config)。

**Files:** Create `apps/expo/src/openpubkey/{flow.ts,store.ts}`、`packages/verify-core/src/badges/oidc.ts`(JWKS 驗章 + nonce 重算;JWKS 歷史金鑰:驗章失敗時拉 provider metadata 重試一次,再失敗 → `stale`)

- [ ] Task A9.1: `badges/oidc.ts` TDD(向量:過期 token、輪替後 JWKS、nonce 不符)
- [ ] Task A9.2: app flow(expo-auth-session;PII 遮罩)+ 綁定精靈 UI;Commit each

---

## Phase A10 — 護照 SD-JWT 瘦身(US-08)

**Spec:** 既有 passport pipeline 保留 MRZ→NFC→Passive Auth,**移除 OpenAC/Noir 呼叫**(circuits 留 passport-noir repo);裝置端自簽 SD-JWT(claims: `over_18/over_21/nationality`,`cnf` = did:key JWK);影像與 MRZ 原文不落 profile。SpruceKit 依 A0.3 清單縮到 JWS+SD-JWT 最小面(能以 verify-core + 小型 SD-JWT 實作替代者逐個替代)。

**Files:** Modify `apps/expo/src/passport/pipeline.ts`;Create `packages/verify-core/src/sdjwt.ts`(issue/verify/selective-disclosure;TDD 含揭露組合向量);Delete OpenAC witness/proof 呼叫路徑

- [ ] Task A10.1: `sdjwt.ts` TDD
- [ ] Task A10.2: pipeline 改接 sdjwt + cnf 綁定;Face ID 於發證;OpenAC 呼叫移除
- [ ] Task A10.3: SpruceKit 縮面執行(依 A0.3 清單)+ nitro HybridObject 表面同步刪;prebuild + 實機 NFC 迴歸;Commit each
- [ ] Task A10.4: **jwt.ts 單雜湊遷移**(A1.1 review 發現的既有產線 bug):`identity/jwt.ts` 因 noble v2 `prehash:true` 預設而雙重 SHA256,非真 ES256;四個產線驗章點(businessCardEnvelope.ts:122、proofVerifier.ts:87,137、envelopeHandler.ts:165)零跨實作覆蓋(Swift parity fixture 是空的)。**決策(使用者,2026-07-03):既存簽章必須相容 — 走 dual-verify 過渡**(驗章先試單雜湊,失敗 fallback 雙雜湊並標記 legacy;簽章一律改單雜湊;過渡期後移除 fallback)→ 修正 + 補跨實作測試;**任何外部 verifier 接觸這些 JWT 前必須完成**;Commit each

---

## Phase A11 — proxy 例外層(C 級圍牆花園,US-07)

**Spec:** 03 §4。Cloudflare Worker(獨立小 repo dir `workers/proof-fetch/`):`GET /fetch?url=<白名單平台 bio URL>` → 抓頁 → 回 `{url, fetchedAt, excerpt}`;快取 6h;無 PII log;開源可自架。App 與 viewer 共用;worker 掛 → 徽章 `stale`。

**Files:** Create `workers/proof-fetch/{index.ts,wrangler.toml}`、`packages/verify-core/src/badges/bio.ts`(excerpt 內找 profile URL 或 DID 字串 + 反向宣稱)

- [ ] Task A11.1: worker(白名單 host、cache API、429/403 透傳)+ 本地 `wrangler dev` 測試
- [ ] Task A11.2: `badges/bio.ts` TDD(向量:找到/找不到/worker 500 → stale)
- [ ] Task A11.3: 綁定精靈 UI(顯示「把這段貼進 bio」+ 複製鍵)+ 部署;Commit each

---

## Phase A12 — 金鑰生命週期完成(US-13 / US-14)

**Spec:** A1.4 已涵蓋還原與匯入匯出(US-13:iCloud 自動 / 助記詞匯入 → **同 did 直接延續,無需 supersession**);本 phase 補「輪替」與「災難路徑」。① 正常輪替(US-14):設定「更換金鑰」→ 生成新 seed → 舊 key 簽 supersession record(`{v:1, typ:'solidarity/supersession', old, new, ts}` 之 JWS)→ 發布至所有儲存面 → 備份 UX 重跑。② 災難路徑(舊 key 與備份全失):圖譜反向背書 — verify-core `verifySupersessionByGraph(newDid, evidences): Result<{level:'attested'|'warning'}>`,≥2 已綁定表面以原生機制作證 → `attested`,單一表面 → `warning`(viewer 顯示警示而非採信,05-plan V1.3 遷移卡兩種變體)。supersession 原語在本 phase 建立,05-plan V1.3 與 06-plan W4 消費。

**Files:**
- Create: `packages/verify-core/src/supersession.ts`、`apps/expo/app/settings/rotate-key.tsx`
- Test: `packages/verify-core/test/supersession.test.ts` + `vectors/supersession.json`

**Interfaces:**
```ts
buildSupersession(oldDid: string, newDid: string, sign: Signer): Promise<string>   // JWS by old key
verifySupersession(jws: string, oldDid: string): Result<{ newDid: string }>
verifySupersessionByGraph(newDid: string, evidences: SurfaceEvidence[]): Result<{ level: 'attested'|'warning' }>
```

- [ ] Task A12.1: `supersession.ts` TDD(向量:old key 簽 ✓ / 無關 key ✗ / graph 2 表面 → attested / 1 → warning / 0 → 拒;入 conformance)
- [ ] Task A12.2: 輪替 UI(rotate-key.tsx:Face ID → 新 seed → 簽 supersession → 發布 → 備份 UX 重跑)
- [ ] Task A12.3: E2E — 輪替後舊 fragment QR 經 viewer 導向新頁;iCloud 與助記詞兩條還原路實測同 did;Commit each

---

## 完成定義(App 主軌)

- 01 §11 指標可量測:頁面連結可分享、綁定完成率事件有埋點(本地統計,無伺服器上報)。
- 02 的 ⭐ stories US-01…US-15、US-19、US-20 全數驗收通過。
- conformance 向量:app 端 `bun test packages/verify-core` 與 web 端(05-plan V4)同組向量全綠。
- 明確不在本 plan(非 ⭐,post-v1):PGP/Keyoxide 徽章、did:pkh 的 App 側精靈(US-09 web 側見 06-plan W3.4)、自然人憑證、mDL/EUDI、US-16/17/18。
