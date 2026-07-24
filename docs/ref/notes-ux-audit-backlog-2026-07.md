# UX 審計 backlog(2026-07-24,R1 onboarding / R2 導航 / R5 重複實作)

> 來源:三份唯讀 codex 審計(R1/R2 完整報告在 2026-07-23 會話;R5 於 07-24)。
> 已做掉的不列(C2/C3 + dual-verify,見 04-plan 執行紀錄)。R3(填寫機制)/R4(重複行為)審計尚未完成。
> 標 🔒 = 安全敏感,執行時 size L + 人工審查;標 🗳 = 已在 07-24 grilling 定案(G1–G4)。

## Critical(R5 排序)

1. **OID4VP 請求自斷**:`/share/qr` 與 `/settings/oidc-request` 產的 `direct_post` + `solidarity://` response_uri 會被自家 responder(https-only)拒絕 → 掃了也完不成;45 秒「防重放」只是 UI 倒數,請求無真實效期;`/share/qr` 文案方向反了(是「請對方出示」不是「送出我的欄位」)。修法:單一 `Oid4VpRequestSession`(nonce/state/效期/https 端點),UI 收斂到 Verify 一處。🔒 size L
2. **PageStep replay 毀資料**:onboarding 迷你編輯器只載 `links[0]`、存檔時整批替換 → replay 會刪掉第 2…N 條連結並把可見度重置為 public。最小修 = merge 而非 replace(C1 內做);全量修 = PageStep 改為 Me 編輯器的 onboarding 殼(R5 #2)。
3. **Nostr 結果語意五處各表**:同一個 partial-success 結果,store 記「已發布」、/verify/nostr 顯示 partial 面板、PageStep 靜默過、Me toast、Bluesky 說失敗、WebSign 拒絕。修法:單一 `full|partial|none|cancelled|failed` 結構化結果 + 本地化錯誤碼,五個呼叫端變薄 adapter。size L

## High

4. **/settings/vc 與 /credentials 重複實作 VC 管理**(整屏抄寫、`vc.*`/`vcManage.*` 雙 namespace 會漂移):/credentials 為準,settings 改薄殼。🔒 size L
5. **onboarding 分享面 vs Me 分享面揭露不一致**:onboarding QR 永遠帶 shared 投影(含 link-only),Me 預設 handle/短連結(只有 public)→「link-only 會進你發的連結」承諾在 Me 為假;「Full offline link」其實不含 private。修法:onboarding 復用 Me 的 share-selection 模型 + 傳輸別名明示範圍。🔒(揭露語意)size L
6. **根身份恢復/匯出三處漂移**(SecureKeys/BackupStep/identity-export:iCloud 恢復跑兩次、mnemonic-only 不清除已同步 iCloud 詞組 → 記錄狀態與現實矛盾、Android 鑄新前無手動匯入、Settings 無法為新身份開 iCloud 備份):單一 RootIdentityRecovery controller。🔒 size L(與 🗳G3/G4 銜接)
7. **加密封存還原雙軌**(onboarding 只還原最新、錯誤分類粗;copy 說 replace 實為 merge/upsert;Settings 大段英文硬編碼):單一 typed restore controller。size L
8. **🗳G2 舊名片隱私模型退場**(share-settings + solidarity-qr 重複建同一 QR、Profile Image 開關是死的、「Private…never shared」對 Pear 為假):tiers 唯一化,legacy 搬「名片 QR 與 VC 欄位」並排刪除。🔒 size L
9. **D9 違規清單**(R2):`/verify/nostr`、`/verify/bluesky` 從 Me 進;Verify 內有自己的護照取得與憑證管理。修法:綁定路由遷 `/me/connections/*` + 舊路由 redirect。size M
10. **自訂 custody 曝光**:🗳G4(Me 備份狀態列)+ 匯出/備份 5-6 taps 問題。size L

## Medium / Small(quick wins 池)

- R1:首次發布同意兩次 Publish 且不揭露三個目的地(publish API 要求)→ 收斂單次知情同意 🔒;Welcome 打字機動畫閘;PageStep 三個可延遲欄位(bio/link/preset)應砍到只剩名字;badge 驗證 Connect/Complete 重複打網路 + 無重試;分享 host 不一致(`app.solidarity.gg` vs `solidarity.gg`)→ 單一 viewer origin 常數 + 部署煙霧測試;onboarding 行話(DID keys/relays/wss///npub/nsec)
- R2:`components/me/` 錯置元件搬 `components/verify|credentials`(6 個);孤兒路由群定奪(/cards、/contacts/manual、/credentials/issue、/id/*、/legal(頁面做好了但 settings 只彈 toast)、/settings/privacy、/settings/disclosure、/shoutouts/*、/vault/*);QR 分享後的 solidarity-qr 永久 spinner
- R5:Me 匯入 dedupe 用 normalized URL key、「已加入」改「已加入草稿」;LinkPageImportSheet 批次可見度選項(若要);`/share/qr` 與 legacy QR 都自稱「Solidarity QR」的命名混淆
