# 歸檔 — 2.0.0 前已刪 plans/specs 精華（2026-08-30）

> 原檔已刪：`docs/{adr,migration,superpowers}/`、整個 `apps/expo/docs/`（內容在 git 歷史）。
> 非 plan 的倖存者搬遷：atproto OAuth client-metadata hand-off → `apps/expo/src/atproto/client-metadata.json`（測試 pin 著）；dag sandbox spec → `notes-dev-sandbox-identity-graph.md`。
> 本文只留每份的「還有用的結論」與現在的落點；實作與行為一律以 code 為準。
> **現行唯一 live plan = `06-plan-convergence-2.0.0.md`**；`01–05` 留作規格參考（05 仍是 QR wire SSOT，06 引用之）。

## ADR

- **0001 Portable Backup Key**（accepted、已實作）：備份鑰由 Recovery Phrase 目的分離推導（`packages/shared/src/derive.ts` `deriveBackupKeyFromMnemonic`），Device Storage Key 維持 device-local；拒絕再同步一把隨機 AES 鑰（避免第四把鑰的 sync race）。換 phrase＝換備份鑰，退役舊復原路徑前必須先驗出新 Backup Archive。

## Migration（SwiftUI → Expo，已完成）

- `00-MIGRATION_PLAN` ＋ `01–04` inventories（2026-05-24 產）：320 Swift 檔 → `apps/expo` 的 1:1 遷移計畫與 screens/services/models/entitlements 盤點。遷移完成、Swift 樹 2026-06-27 刪（`3fd308e`）——inventories 描述的是已刪 code，純歷史。仍成立的決策：bundle id 沿用 `kidneyweakx.airmeishi`（in-place upgrade、首啟匯入舊 Keychain/UserDefaults）、`parity-fixtures` 金向量制（凍結）、iOS 走 Xcode Cloud。

## Passport 證明線（specs＋plans，已 shipped）

- **AA-aware routing spec（06-11）**：三段路由 `aaMode: active|passive`——有可用 ECDSA AA 證據走 `requireAA=true`（green）；DG15 在但證據不可用（RSA-AA 大宗）走 passive 且 **witness request 不帶 DG15**（blue）；模擬晶片/被動驗證失敗才落 SD-JWT（white）。活在 `src/passport/openacV3.ts`。
- **Show-presentation spec（06-12）**：present 不再重播 enrollment 的 `openac_show`——witness bundle AES-GCM 落庫（隨 credential 刪），每次 present 換 `nonce_hash` 重簽出新鮮 show proof；QR 只帶輕量 show proof、vk 走 pin 不隨 proof 傳。活在 `src/passport/showPresentation.ts` 一線。
- **Proof-performance spec＋phase1-2 plan（06-13）**：enrollment 砍掉無用的 `openac_show` prove（vk self-pin 改 `getNoirVerificationKey` 取）、show self-verify 收 dev flag、sheet 開啟即 prefetch、假進度片改真 milestone（`proofOverlayStage`）。
- **Phase3 warm-prover plan（06-13）**：跨 repo——passport-noir mopro-binding 加 process-static circuit cache ＋ `warmup_circuit`，app 端 `warmupCircuit` 接 show prefetch/prepare 預熱（`src/passport/showPrefetch.ts`）。註：後來的 Generate-Proof `signFailed` 與 warmup 無關，真因是 Keychain 幻影鑰（見 memory/progress）。
- **Face ID single gate phase4 plan（06-13）**：共享 5 分鐘 grace bucket（`src/keychain/biometric.ts`）；`ALWAYS_PROMPT_ACTIONS`（rotateMasterKey/revealRecoveryBundle/deleteZKIdentity）永遠重新提示——這是 CLAUDE.md 硬規則，加 grace＝安全回歸；vault wrapping key 遷 ACL-free v2（`gg.solidarity.vault.rootSecret.wrapping.v2`，JS gate 為準）；spruce-did `keyAuthMode` 避免原生二次提示。遺留（明列 out-of-scope）：Android 既存 auth-bound 鑰缺 CryptoObject prompt 的先天缺口。

## Backup／身分（apps/expo 內的 plans/specs，已 shipped）

- **Figma parity＋iCloud stability spec（06-02）**：雙軌——UI 對 Figma 細節收斂；iCloud 四類症狀總修。Track A 的 CloudKit 自訂 schema 路線後來被推翻：備份改走 **iCloud Drive Documents 檔案 API**（`src/backup/cloudProvider.ts` 有記載），CloudKit 自訂型別＝TestFlight/App Store 全掛的生產地雷；vault/groups 同款殘留 bug 的處置在 06 §2/§B1a。
- **iCloud-A1 backup coordination plan（06-02）**：純函式 `src/backup/backupPolicy.ts`（timestamp 解析/最新選擇/run-skip 政策）＋單一 `requestBackup(reason)` 協調器與共用 cooldown、restore key-mismatch 與 Drive auth 轉 typed 狀態。
- **Cross-device root key backup/restore plan（07-16）**：JS 層全綠——HKDF Portable Backup Key（同 ADR-0001）、`src/storage/jsonCrypto.ts`、`rootKey.ts` 的 `restoreRootKeyFromICloud`（local-wins，只填空）、SOLB envelope v1/v2 判別、onboarding recover-before-restore。Codex 對抗審核收斂的事實：native 讀取須 pin `synchronizable=true`（不決定性 `SynchronizableAny`＝幻影鑰源頭）；SOLB v2 header 不 AEAD 保護＝僅 denial（版本選鑰、竄改拿不到明文）。遺留 Task 7（signing-key delayed-sync race）後由 keychain 決定性解析修復線收掉。
- **did:plc binding spec（07-02，原已標 superseded）**：被 `01–03` 的 1.3.3 Verified Page 規格取代（v1 spine＝Bluesky）。留下的 rationale：綁定選自訂 lexicon record `gg.solidarity.binding`（rkey `self`，P-256 簽 `did:plc‖did:key‖createdAt`），**拒絕** `alsoKnownAs`（不可簽、任何人可寫）與 post-proof（可刪可改、非結構化）；離線驗證可走 CAR proof。
