# Passkey 驗收 · 2026-09-20

狀態：Web／Backend 功能與部署驗收通過；真實手機 Passkey 端到端仍待驗，不宣稱全流程完成。

## 本次修正

- Web 先登入再開編輯器，自動載入自己的 Page；Page 網路失敗可重試而不重新驗 Passkey。
- 同工作階段往返編輯頁保留草稿；忽略過期的非同步載入，身份不符立即登出並顯示下一步。
- 只有 Passkey 不支援／無法在此裝置使用／尚未連接時才出現手機後備。後備接受 App 分享連結，不要求理解 JWS。
- 簡化登入、發布及失敗文案，發布後提供 Page 網址與 QR，不展示整段簽名資料。
- App 保留 onboarding「稍後再說」及 Page 主動連接；移除 Page 首訪自動提示。Pro 未提交修改完整保留。

## 已實際操作

- 使用 App 的加密／上傳函式送至正式 creds.id，再由 Web 解開，根 DID 一致。服務回應只有 v、ciphertext，且 no-store。
- 一次性測試身份在三個公開 Nostr relay 連續發布兩次，均 3/3 接受；重取 Page 驗證內容與身份正確；登出後舊簽署器失效。
- 瀏覽器實際點選：登入前無編輯器；已登入但讀取失敗 → 重試成功；編輯 → 首頁 → 返回，草稿仍在；連續兩次發布成功。
- 模擬瀏覽器不支援 Passkey 後才顯示手機後備，分享連結的載入／壞簽名拒絕已由最小測試驗證。
- 上述測試使用明確標示的一次性身份；認證器輸入為測試產生，**不代表 iCloud Passkey／Face ID 已實測**。臨時瀏覽器驗收頁不提交、不部署。

## 檢查及部署

- App：typecheck、lint、2073 unit + 114 parity 通過；lint 259 個既有 warning。既有空 Semaphore fixture 的 skipped 提示仍在。
- Web：typecheck、lint、186 tests、334 對比檢查、verify、production build 通過。只新增一個分享連結驗證，並強化既有 revision 驗證。
- Backend：103 tests 通過；部署目標 src/nip05-worker.ts 的獨立 typecheck 及 Worker 打包通過。全 repo typecheck 仍卡在既有 Inbox 型別錯誤，未改動該功能。
- Backend 81bc567（及先前 5 個未推送 commit）已 push main；0002_root_vault migration 已套用。正式 Worker 版本 a6d88991-6a2f-45cf-a00a-9012ef4248bf。
- Web 的功能分支原本只部署 Preview，正式站仍是舊版；本次將驗證後的功能分支產物明確部署到 Production。

## 剩餘真機驗收

本機沒有已連接實體 iPhone。仍須以最新 App：略過 → Page 主動連接 Passkey → 在 Safari／Chrome 使用同一 Passkey → 確認自己的 Page → 修改發布兩次。需由使用者完成系統生物辨識。iCloud 一般資料復原與 Android 認證器未做本次實機驗證。
