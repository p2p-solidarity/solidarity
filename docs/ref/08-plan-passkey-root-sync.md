# 08 · WebAuthn PRF 根身份同步（執行計畫）

> 2026-09-14 · 使用者裁決。本文件接續 `07-plan-web-standalone.md`，並取代其中「web 保存本機 passkey vault、可在 web 建立／輸入助記詞」的產品主流程。07 的 JWS/webSign wire 仍保留為相容與故障後備，不再是一般使用者流程。

## 0. 使用者看見的結果

- 新用戶先完成本機根身份與救援設定，再選擇是否連接 passkey；畫面明確提供「稍後再說」，不會先叫出系統視窗逼用戶取消。既有用戶也可略過，之後仍可從 Page 啟用。
- 在 `creds.id` 不顯示助記詞、DID、JWS、金鑰建立或金鑰管理。編輯器內容前的正常入口是「使用 Passkey 登入」，不使用「匯入」或「金鑰解鎖」心智模型。
- 一次 passkey 驗證解鎖整個 web 工作階段；關閉頁面或閒置 15 分鐘即清掉記憶體內的 seed／簽名能力。工作階段內發布不再重複要求 Face ID／Touch ID。
- 解鎖後從 Nostr 讀取最新 Page，編輯並直接發布。QR／貼上 JWS 的 webSign 只在不支援 PRF 或同步金庫不存在時作後備。
- 聯絡人、憑證、護照、私人檔案與一般 App 設定不進本服務；它們仍由使用者登入 iCloud／既有 App 備份復原。

## 1. 安全與資料裁決

1. **seed 仍是身份根。** 同一 seed 依既有 `HKDF_INFO_ROOT` 派生 DID；若 App 使用獨立匯入的 `nsec`，則把那把 Nostr 發布權一併封入密文。Passkey 不直接當 DID，也不取代最終 Profile JWS。
2. **PRF 只作解鎖外殼。** 每個 passkey credential 的 PRF 輸出經 HKDF 派生 AES-256-GCM key；密文只含版本化的 root mnemonic 與選填的 Nostr scalar。PRF 輸出、AES key與明文永不送到服務端。
3. **服務只保存密文。** 服務端 row 只含不可枚舉的 credential locator、版本、AES-GCM 密文與建立時間；不保存 mnemonic、DID、npub、Page、聯絡人或憑證。
4. **第一版金庫不可變。** 同一 locator 只能 create-once/read；沒有覆寫 API，因此沒有遠端回滾新 seed、衝突合併或伺服器竄改成另一份有效密文的路徑。重新建立 passkey 會新增另一個獨立 locator。
5. **完整性 fail closed。** AES-GCM 驗證失敗、解密後 schema 不符、助記詞無效、或派生 DID 不一致，都只顯示「無法解鎖」，不得當成「沒有身份」並自動新建。
6. **可攜性不依賴服務。** iCloud／助記詞仍是 App 復原來源；同步服務只是零摩擦 web 可用性的 opaque cache。`creds.id` 或 credential provider 消失時，不影響既有公開 JWS 的驗證與助記詞復原。

## 2. Wire 與邊界

### 2.1 Passkey PRF

- RP ID 固定為 `creds.id`；iOS 加 `webcredentials:creds.id`，Android 由 `/.well-known/assetlinks.json` 宣告 `common.get_login_creds`。
- PRF input 是版本化固定 32-byte context digest；PRF 本身已 per-credential，因此不需要把隨機 salt 先存在另一個可同步位置。
- App native 建立 credential，Web 以 discoverable credential 取回同一 credential 的 32-byte PRF output；不把 WebAuthn assertion 當任意 Profile 簽名。

### 2.2 Root vault v1

- locator：`base64url(sha256(credentialId))`。
- encryption key：`HKDF-SHA256(PRF output, salt=sha256(credentialId), info="solidarity-root-vault-key-v1", 32)`。
- payload：strict `{ v: 1, mnemonic: string, nostrKey?: base64url }`，AES-256-GCM sealed，wire 為 base64url `nonce || ciphertext || tag`。
- API：`PUT /vault/root/:locator`（create-only，存在時只接受 byte-identical idempotent retry）與 `GET /vault/root/:locator`。Body 與 response 上限固定；全部 `Cache-Control: no-store`；錯誤不洩漏 credential 或解密資訊。

### 2.3 Session

- Web 解鎖後只把 non-extractable P-256 `CryptoKey` 與可清零的 Nostr scalar 留在記憶體。
- 每次有效操作更新 activity；15 分鐘無操作、`pagehide`、登出或身份錯配立即 `lockSession()`。
- 草稿可留瀏覽器本機，但不是身份備份，也不進 root-vault API。
- 草稿綁定解鎖後的 root DID；不同身份解鎖前會先清掉上一個身份的草稿與來源，避免錯簽。
- App 將失敗上傳的 locator 與密文保留在本機加密儲存，下次先作 idempotent retry，成功前不再建立另一把 passkey。

## 3. 實作順序

1. **Shared（TDD）**：root-vault KDF、locator、seal/open、strict payload parser與跨 runtime vectors。
2. **Opaque service（TDD）**：D1 schema、create-only/read handlers、大小與 shape 限制、idempotency、no-store、rate limit；掛到 creds.id 的既有 `solidarity-id` Worker。
3. **Web（TDD + 一個 UI behavior check）**：把本機 IndexedDB vault 改成遠端 opaque store；discoverable passkey 解鎖；15 分鐘 session；移除 IdentityPanel 的建立／助記詞／金鑰管理 UI，只留 passkey 與後備 webSign。
4. **App native + orchestration（TDD on JS boundary）**：Keystone 新增 WebAuthn PRF create；iOS AuthenticationServices、Android Credential Manager 1.6；root seed 只在 JS 記憶體短暫 seal 後上傳；onboarding 與既有用戶 Page 首次提示接線。
5. **驗證與安全審**：root `bun run typecheck && bun run lint && bun run test`；web `bun run typecheck && bun run lint && bun test && bun run verify`；backend typecheck/tests；iOS/Android native compile；最後依 `code-review` 做 Standards／Spec 雙軸審查。

## 4. 驗收

- App 建立或既有 root → 一次 passkey 系統視窗 → 服務端只出現密文 row。
- 清除 web site data／換同 credential provider 的新裝置 → `creds.id` 使用 passkey一次 → 同一 DID 與 npub → 能修改並發布既有 Nostr Page。
- 工作階段內重複發布不再提示；閒置 15 分鐘後下一次簽名必須重新用 passkey。
- 不支援 PRF、取消、密文缺失／損壞、credential 不同步都不建立新身份；顯示單一簡短後備入口。
- App 的 iCloud 一般資料備份與現有未提交的備份 UI 改動不受影響。
