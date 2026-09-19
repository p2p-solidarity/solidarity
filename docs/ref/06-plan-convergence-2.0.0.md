# 2.0.0 收斂決策與執行計畫（grill 產物）

> 2026-08-26 · 這份是 grill 出來的**下一版 plan**：所有決策定案在此，**code 尚未動**。
> 流程：本文件＋相關文件先寫好 commit → 你完整審過 → 再由 multi-agent 執行＋對抗驗證。
> QR/交換的 wire 細節在 `05-spec-qr-exchange.md`；本文件是**批次層**（北極星、判準、Q1–Q6、舊功能去留、執行計畫）。

---

## 0. 北極星與批次判準（所有去留的尺）

**北極星**：最大化 sovereignty ——**「公司倒了，這整套機制還能運作」**。落地＝**用戶自己的雲（iCloud/gDrive）＋ local ＋ 最少的基礎建設**。creds-design 為了簡潔大幅放寬了這一層，**但它才是硬限制**，任何功能去留都用「撐起還是侵蝕『公司倒了還能用』」來裁。

**批次規則**：**airmeishi 的 code／`docs/ref` ＝事實來源；creds-design ＝PM 寫的、含幻想成分**，衝突時以 code＋北極星為準，creds-design 當構想而非硬限制。凡只活在 creds-design、code 裡沒有的，先當可選構想。

---

## 1. 決策帳 Q1–Q6（QR 細節見 05-spec）

| # | 決策 | 這版 | 出處 |
|---|---|---|---|
| **Q1** | **Pear iOS＋Android 都留、都不砍**。理由：傳輸層（Bare/Hyperswarm/holepunch）非我們維護、mobile 友善。**更正**：CREDS §8「不做 Android 對等支援」實指**備份/AirDrop 類 Android 受限特色功能**，**非**核心 P2P 名片交換——後者兩平台都做。convergence「Android 對等去留仍開放」是假議題，作廢。 | 兩平台留 | grill Q1 |
| **Q2** | 名片訂閱指標**做到底**。缺口只在 card-key↔root 那段（did↔npub 雙向綁定已存在＝發 kind-30078＋badge）。走 `oidc/cardKeyBinding` **長效版**綁 card-key↔root；收端要求 `attested root === npub 解析出的 page.did`（後者已驗）→ 放寬 `cardSubscriptionBootstrap` 的「新 did 一律不動」成「**綁定成立的新 did 可自動追**」。 | 做（見 §3-A） | grill Q2 |
| **Q3** | **透明日誌＋creds.id 副署都丟**，並從 creds-design 刪；清單同屬非本版。耐久性改**export 到用戶自己雲端**（走已修的 `backup/cloudProvider.ts`，不經我們的手）。 | 丟 | grill Q3 |
| **Q4** | `/c/<code>` 金屬卡**出貨才做**；屆時 vanity 碼進 **creds.id id-db**（＝現有 username/NIP-05 目錄延伸；CREDS §3.5 本就允許「卡號解析」上伺服器）、**NFC 為主**、刻字裝飾。**更正**：「不自營 registry」(G1) 指不做名字 marketplace，**非**不做解析目錄——解析目錄 code 裡已在跑。 | 延後 | grill Q4 |
| **Q5** | NIP-44 加密**消費端延後**（構思未完整、Pear 當面私密 lane UX 更好；async relay 送達是之後拓展）。**pubkey(npub) 地基本版就有**（＝Q2；npub＝secp256k1 公鑰，`npubDecode` 還原原始 32 bytes）；標注為 NIP-44 conversation-key forward-compat 輸入，之後接加密不必重新交換。原語 `packages/shared/src/crypto/nip44.ts` 已落地、過官方向量、無消費者。 | pubkey 做／加密延 | grill Q5 |
| **Q6** | **VC/OIDC4VP/VCI 憑證皮夾整套保留、不瘦身**（推翻 convergence「瘦身成只留 passport-SD-JWT」）。理由：**「驗證用戶社群平台→發憑證」＝差異化 aha point**；為 convergence/降複雜度瘦身＝丟掉差異化與開源做這專案的意義。**這版收在二層/dev**（不升一級 tab）；近期整合＝**passport-SD-JWT 進名片/present 流**；「驗證社群→發證」＝roadmap。全數**補注 creds-design**（別再被淡化）。 | 保留/二層 | grill Q6 |

**已確認過去對的抉擇**：Sharing → 進二層 ✓；Present → 只留 QR、換 CRD1（非完整 JWT）、少做 chunking ✓；清單(group) → defer ✓。

---

## 2. 舊功能去留（grounded map 2026-08-26 · 北極星為尺）

> map 中途電腦睡著，6 agent 只回 2（vault、websign/wallet-pass）；其餘刀口以 grep 逐條核實（行號在下）。**這版只以文件約束、不動 code。**

| 子系統 | 裁決 | 刀口/理由（file:line 已核） |
|---|---|---|
| **vault 核心** `src/vault/{store,storage,vaultManifest}.ts` ＋ `app/vault/*` | **留＋接線** | 真 AES-GCM 本地加密、reachable-but-dead-end（route 有、無 UI 導入）。是 local-first 儲存骨幹，只是沒入口。`storage.ts:56-87` 用 `getMasterKey()`。 |
| **vault `cloudSync.ts`** | **砍** | 重蹈生產地雷：`cloudSync.ts:58-62,284-298` 自建 CloudKit 自訂型別 `AirmeishiVaultManifest`，正是 `backup/cloudProvider.ts:1-25` 記載「讓 TestFlight/App Store 備份全掛」那個 bug（memory：vault/groups 同 latent bug）。零 caller、死碼。**export-to-cloud 改走 `backup/cloudProvider.ts`。** |
| **vault 分片復原** `secretsKeychain/shardDistribution/recovery/shardEnvelope`（1561 行） | **defer** | 復原的是**錯的鑰**：`storage.ts` 實際用 `getMasterKey`，非分片保護的 hardware-wrapped vault root secret → 一旦出給用戶＝Rule 8 假功能。也是 vault→sakura 唯一牽連（`shardDistribution.ts:40` 用 `@/sakura/client`），defer 後 sakura 砍變乾淨。 |
| **sakura ＋ shoutouts** | **砍（含 push rail）** | Shoutouts 收件匣＝違反「不做收件匣」。依賴盤點（grep 已核）：leave-a-card **不依賴** sakura（顧慮解除）；`pushRegistration` 被 onboarding/boot/notifications 用著，但**唯一用途是喚醒 app 收 Shoutouts**，CREDS §18 通知是裝置端自產、v1 不經伺服器 push（mock F8：真 APNs 選配未來）→ **push rail 一起砍**。動到 `app/_layout.tsx:68-69`、`onboarding/steps/ReadyStep.tsx:11`、`app/settings/notifications.tsx:36`、`settings/productionWipe.ts:42-45`。 |
| **dag** | **砍沙盒、搬 2 檔** | 生產命脈靠 `dag/nostrAdapter.ts`＋`dag/node.ts`（`nostr/publish:63`、`fetchKind0:19`、`resolveProfile:28`、`userKey:67-68` → Q2＋整條 §3.3）。**刀口＝把 `nostrAdapter`＋`node` 搬進 `src/nostr/`，刪其餘 8 檔沙盒**（`devKey/instance/replay/store/storeMmkv/sync/webrtc/wire`）＋`components/sandbox/DagGraph3D`＋dev 路由。 |
| **wallet-pass** | **先留（休眠）** | map 建議 CUT（`/cards` 本身也無入口、`solidarity://contact` round-trip 斷），但你裁「先留」——現在看不出合理性但需要。當休眠碼；入口問題落「17 無入口路由這次不裁」。 |
| **websign** | **留；2026-09-09 解除 dev gate（07-plan P3）** | 核心（creds.id 真 builder 用手機 root 簽名靠它，跟 Q6 憑證/發證同線），creds 只是沒提。原裁「triple-gated developerMode」被 `07-plan-web-standalone.md` P3 推翻：進 Page 流程，安全邊界是 review 畫面的逐欄 diff＋Face ID，不是開發者開關。 |
| **airdrop / offline/manager.ts** | **砍** | 零 caller（airdrop：QR-only 交換裁決；offline：自承未接線）。 |
| **17 無入口路由** | **這次不裁** | 子系統去留照裁，但「哪條路由補入口/刪」整批延後（含 `/vault`、`/cards` 之後要不要開入口）。 |
| **groups/zk/semaphore（清單引擎）** | **凍結** | Lists defer 已定，不刪。 |

---

## 3. 執行計畫（**尚未動 code**；審核後交 multi-agent）

### A. Q2 名片 root 綁定（feature）
1. `oidc/cardKeyBinding.ts` 加**長效版** builder/verifier：drop `aud`/`nonce` 要求、長 `exp`，`{typ, rootDid, cardDid, iat, exp}`，root 簽。**鑄一次快取**（掛在本來就要 Face ID 的簽名動作上）。
2. 名片 emit（`solidarityQrRuntime`）：在簽名 claims 附上這個長效 attestation（隨 CRD1/JWT 走）。
3. 收端（`envelopeHandler` + `cardSubscriptionBootstrap`）：驗 attestation（`cardDid===` 名片簽名 did、`rootDid` 用解析回來的 record 驗簽）→ 放寬 bootstrap：`resolved page.did === attested rootDid` 成立時，**新 did 也可自動追**（不再只 refresh 已存）。
4. pubkey(npub) 標注為 NIP-44 forward-compat 輸入（型別/註解）。
5. 測試：綁定成立→新追；綁定不符→維持 `skippedNewDid`；attestation 過期/偽造→拒。

### B. 舊功能清理（§2 的刀口）
- **不變量（executor 不可打破）**：`dag/nostrAdapter`＋`dag/node` 是生產 Nostr 命脈，**搬不刪**；leave-a-card 與 sakura 無關；vault 核心加密不可壞；`backup/cloudProvider` 是 export-to-cloud 正路。
- 步驟：搬 dag 2 檔→刪 dag 沙盒；砍 sakura＋shoutouts（含 push rail，改 4 個 call site）；刪 vault `cloudSync.ts`、defer 分片群；砍 airdrop/offline；vault 核心接一個入口（或連入口都併入「17 路由」批次——待定）。
- 每砍一塊跑 `typecheck && lint && test`，並確認 Nostr 命脈、backup、Pear、Q2 不回歸。

### B1a. §2/§3B 勘誤（2026-08-30）
- §2 記 vault `cloudSync.ts`「零 caller、死碼」**不成立**——`vault/store.ts:384-437` 有 3 個 lazy import（sync/pull/download）＋ 2 個測試套件在用。刪它＝重工 vault store 的 sync 路徑（產品行為變更），獨立成一刀，不併入 nitro 收斂 commit。

### B2. Nitro 收斂 8→2（已執行 2026-08-30，本節為記錄）
- **動機**：8 個自家 nitro 包維護面過大（nitrogen codegen×8、podspec/gradle×8、CI 觸點、ArrayBuffer 稽核面）。收斂為 2 包，維護面聚攏；binary size 不變（同樣 native code）。
- **`@solidarity/nitro-keystone`**（pod `Keystone`）＝ secrets-vault ＋ spruce-did ＋ cloudkit。裝置信任基座：SE wrap、P-256 簽名鑰＋ES256 JWS、iCloud Drive／Drive 備份。
- **`@solidarity/nitro-attest`**（pod `Attest`）＝ mrz-ocr ＋ nfc-passport ＋ passport-zk ＋ semaphore。attestation 生命週期：採證（MRZ/NFC）→出證（Noir、Semaphore）→驗證。semaphore 維持凍結，純搬遷。
- **不變量（被驗證過）**：Keychain service 名／AndroidKeyStore alias 前綴（`gg.solidarity.secretsvault`、`gg.solidarity.sprucedid.` 等）是**存量用戶金鑰的定址**，隨檔搬但字串不動——改了＝全用戶金鑰孤兒化。HybridObject 名（`SecretsVault`／`PassportZk`…）不變，JS `createHybridObject` 呼叫全相容。
- **搬遷面**：兩包 nitro.json 各聚 3／4 個 HybridObject；Kotlin 重新 package 到 `…gg.solidarity.{keystone,attest}`（uniffi.mopro／uniffi.semaphore_bindings 不動）；semaphore rust／mopro 保持相對佈局搬到 `attest/semaphore/{rust,mopro}`，`build-android.sh` 輸出路徑改指 attest 包根；plugins（withMoproBindingsPod／withSemaphoreBindingsPod／withRustXcframeworkSearchPath／withPassportOpenAcSrsPhase）、`scripts/{prepare-ios-workspace,stage-openac-srs}.sh`、`.gitignore` 路徑同步。
- **同 commit 併刀**：砍 airdrop（module＋wrapper＋test，§2 已裁、零 caller 驗證過）。
- **後續（獨立刀）**：cloudSync 刪除（見 B1a 勘誤）；cloudkit native 面瘦身（等 cloudSync 裁決後只留 file API）。

### C. creds-design 補注＋刪除
- **刪/標移除**：透明日誌、creds.id 副署（§3.5）。**標 defer**：清單(§2)。
- **補注**：passport-OIDC×VC 憑證皮夾願景（整套保留、二層 now、present 整合、社群驗證→發證 roadmap）；北極星；「airmeishi code 比 creds-design 豐富、以 code 為準」。

### D. 驗證
- `bun run typecheck && lint && test`（app）＋ shared ＋ web；重打包 web vendor（若 shared 改）。
- 對抗驗證 workflow（3 opus lens：安全/綁定、密碼學、狀態語意）＋事實查核 doc。

---

## 4. 待裁（本批不決）
- C · 分級字母已裁 creds T1；D · 掃描器吃自家 deep link 已做（見 05-spec §8）。
- NIP-44 限定欄位 per-recipient 發布形狀；v2 attestation 之外的 async relay 送達；per-contact relay 提示持久化；17 無入口路由；`/c/<code>`（金屬卡出貨）；vault 核心入口。
