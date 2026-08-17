# solidarity — App / Web 機制分工(收斂版)

> 對應 01-spec。原則:金鑰與發行在 App;渲染與驗證在 Web 也要能獨立完成;兩端共用同一份規格與測試向量;例外基礎設施只有無狀態 proxy 與 HyperDHT bootstrap,皆可自架。

---

## 1. App(iOS 優先)持有的機制

| 機制 | 內容 | 為什麼必須在 App | 對應現有模組 |
|---|---|---|---|
| 金鑰保管與簽名 | did:key(P-256)於 Secure Enclave;簽名經 Face ID 閘控 | 硬體金鑰不可能在網頁 | keychain vault、Face ID gating(保留) |
| 恢復與輪替 | 紙本碼 / iCloud Keychain;supersession 簽署;圖譜反向背書流程 | 觸及私鑰 | 新模組(day-one) |
| Profile 編輯與發布 | 簽 JWS;寫 PDS(atproto OAuth);發 Nostr relay;產 fragment blob | 需要簽名權 | nostrAdapter(保留沿用) |
| 護照 NFC → SD-JWT | NFC 讀取、裝置端 Passive Auth、發 SD-JWT(cnf 綁 did:key) | NFC 硬體 + 個資不離機 | passport 模組(瘦身;OpenAC 移出) |
| `_did` 綁定精靈 | Domain Connect 探測與 deep link;NS 偵測;DoH 輪詢 | 引導流程 + 推播 | DomainVerificationManager(演化) |
| OIDC / OpenPubkey | ASWebAuthenticationSession;nonce 承諾公鑰;PK Token 保存與刷新 | OAuth redirect + 金鑰承諾 | 新模組 |
| 手機端驗證引擎 | 原生 DNS + DoH 交叉、JWS / Nostr event / PK Token 驗簽 —— 掃描他人時**完全本地驗證,不經任何網頁** | 離線場景 | 新模組(與 Web 共用測試向量) |
| QR | 生成(fragment blob)與掃描 | 相機 | 沿用現有 QR 元件 |
| 聯絡人儲存 | 本地(Core Data / SQLite)+ 選配 iCloud 私有備份;快照 + 回訪重驗 | 私人資料留本機 | 聯絡人模型保留;CloudKit 群組同步移除 |
| Linktree 匯入 | 解析 Linktree / 純文字連結頁 → 預填 `links[]`(宣稱)→ 逐條升級精靈;他人頁 → `declared` 聯絡人 | 寫 profile 需簽名權 | 新模組(小) |
| **Pear lane(v1 · day-0)** | Bare worklet 跑 Hyperswarm;topic = hash(DID);Noise 通道內簽 challenge 證明 DID 持有;前後景生命週期管理 | P2P socket + 私鑰簽 challenge,瀏覽器不可能 | 新模組(§8;nostrAdapter 的 DAG 事件模型直接餵入) |

## 2. Web(靜態 SPA)持有的機制

**Viewer(`/@handle`、`/#…`)**:

| 機制 | 內容 |
|---|---|
| 解析與取回 | atproto handle → DID(客戶端)、PDS `getRecord`(CORS)、Nostr relay(WebSocket)、fragment 解壓 |
| 客戶端驗證 | JWS 驗簽;DoH 雙 resolver(Cloudflare + Google)交叉查 `_did`;rel=me 公開 API 直抓;PK Token 對 JWKS 驗章;DNSSEC AD flag 判定 |
| 徽章狀態機 | `verified / stale / revoked / declared` 渲染;每枚附證據 deep link |
| 零狀態 | 無 cookie、無帳號、無寫入、無 PII analytics;`#` 內容不出網路 |
| 轉化 | footer「get yours」;App deep link(把當前 profile 帶進 App 存 People);「Request private view」= `solidarity://` deep link,未裝 App → 導安裝 — viewer 不含任何 P2P 程式碼 |
| 可替換性 | 規格與程式碼開源;任何人可自架 viewer;viewer 死亡 ≠ 頁面死亡 |

**Builder(`/edit`,Web 軌 🌐 — 同一顆 SPA)**:

| 機制 | 內容 |
|---|---|
| 金鑰 | BIP39 助記詞生成(= 唯一恢復碼,強制抄寫確認)→ HKDF → P-256 → WebCrypto `extractable:false` → IndexedDB;清除站台資料 = 金鑰消失,UI 講死 |
| 簽名與發布 | JWS 簽 profile;Nostr WS 直發 ≥3 公共 relay(預設家);fragment 連結 / QR 下載;atproto OAuth 可選 |
| 徽章綁定子集 | S 級(Bluesky OAuth、Nostr、DNS 手動 + DoH 輪詢、did:web、GitHub、did:pkh 經錢包擴充)、B 級 OIDC redirect、C 級 bio;A 級與 Pear 顯示「需要 App」 |
| 升級到 App | 助記詞恢復舊 key → 簽 supersession 指向 App 的 SE 新 key(01 §3 既有機制,無新原語) |
| 共用 | 與 App 同一份 profile schema、badge registry、驗證規則、conformance 測試向量(§3) |

## 3. 兩端共用(單一規格)

- profile schema、badge registry、驗證規則、狀態機 —— 01-spec 為 SSOT。
- **Conformance 測試向量**:一組固定的 profile / 徽章 / 攻擊樣本(壞簽章、單向 alsoKnownAs、過期 PK Token、NXDOMAIN),App 與 Web 的驗證結果必須逐項一致。單向宣稱不畫綠勾是最重要的一條。

## 4. 唯一的例外基礎設施

無狀態 proof-fetch worker(Cloudflare Workers 免費層):只服務圍牆花園(X / IG / TikTok / YouTube / OnlyFans)的 bio 抓取;激進快取;不記 PII;開源、任何人可自架。**軟依賴**:worker 不可用 → 該類徽章顯示 `stale`,不阻塞其他任何功能。此外 PLC directory 查詢在兩端都做客戶端快取(TTL 24h)以尊重速率限制。

## 5. 三個 Tab 的畫面 ↔ 機制對映

| Tab | 畫面 | 用到的機制 |
|---|---|---|
| **People** | 聯絡人列表、聯絡人詳情(徽章 + 變化提示) | 聯絡人儲存、驗證引擎(回訪重驗)、PDS / relay 取回;🗺:雙方在線時 Pear 複製增量 |
| **Me** | 已驗證名片(卡片 + QR 展開)、頁面編輯、Linktree 匯入、恢復設定 | 金鑰簽名、發布、QR、恢復輪替 |
| **Verify** | 掃描器、驗證結果卡(徽章 + 證據 + 存入 People)、深連結處理(`https://…#` / `solidarity://`)、我的徽章綁定管理(S/A/B/C 各平台精靈) | QR 掃描、本地驗證引擎、fragment 解壓、`_did` 精靈、OpenPubkey、NFC |

**畫面轉換(自 1.3.2)**:新 Me = 現 Me 上半(identity 卡)+ 原 Share tab 底部 QR 展開卡,合併為一張可展開分享的已驗證名片;現 Me 下半(憑證 / 選擇性揭露 / OIDC 區塊)遷入 Verify 並擴充為徽章庫各平台綁定精靈;ZK / 群組區塊依 §6 處置(移出 / 凍結);Share tab 移除。

## 6. 現有 repo 處置表

| 模組 | 處置 |
|---|---|
| nostrAdapter.ts(DAG ≡ NIP-01) | **保留**:profile event 發布核心 |
| keychain vault / Face ID gating | **保留** |
| 聯絡人模型 | **保留**:改本地 + iCloud 私備 |
| DomainVerificationManager | **演化**:`_did` 綁定精靈 + 驗證器 |
| SpruceKit 整合 | **瘦身**:僅留 JWS + SD-JWT 最小面 |
| passport 模組 | **瘦身**:NFC + PA + SD-JWT;OpenAC 呼叫移除 |
| passport-noir circuits | **移出 App**:留在原 repo 作 opt-in 模組(roadmap US-18) |
| GroupCredentialContext / Semaphore | **凍結**(roadmap US-17) |
| MultipeerConnectivity / Proximity 交換 | **刪除**(App 對 App 由 Pear lane 接手 — v1、day-0 共同設計,近場升級為跨網路,僅私有通道 — §8) |
| Sharing tab | **刪除**(底部 QR 展開卡併入新 Me) |
| CloudKit 群組同步 | **刪除** |
| P2P chat 相關規劃 | **不做** |
| nitro-modules 橋接面 | **瘦身**:隨 proximity 刪除與 SpruceKit 縮面同步縮減 HybridObject 表面;新增的 P2P 面(Pear)走 bare-kit,不再自寫 bridge |

## 7. 建置順序建議

**App 主軌**(Pear day-0 進線,不是尾巴):

1. 金鑰核心 + 恢復(不可後補)+ **DID-challenge 簽名格式定案** — Verify 掃描與 Pear 通道共用同一份格式與測試向量
2. profile schema + JWS + fragment/QR — schema 定案時即滿足 append-only 複製形狀(hypercore 可直餵,不做破壞性更新)
3. **Bare worklet 骨架 + Pear PoC**(topic 相遇 + challenge 互驗)— dev client / prebuild 管線同步建立,Expo Go 從此不是開發路徑
4. Nostr 發布(最快能跑通的儲存面)
5. 靜態 viewer(驗 Nostr + fragment)→「掃 QR → 瀏覽器看到已驗證頁」最小魔法時刻
6. **Pear v1 面:遠端完整卡交換 + SD-JWT 私下出示**(viewer 掛上「Request private view」deep link)
7. atproto OAuth + PDS → 8. `_did`(手動層先行,Domain Connect 隨後)→ 9. OpenPubkey → 10. 護照 SD-JWT → 11. proxy 例外層(C 級圍牆花園)

Pear 排第 3 是刻意的:bare-kit(native module)與 NAT 打洞是全案最大的未知數,PoC 越早越好;第 1、2 步的兩個共用決策(challenge 格式、append-only schema)就是「day-0 跟著設計」的具體意思。People P2P 複製與 blind peer 非同步送達留 🗺。

**Web 軌 🌐**(與 App 主軌並行,共用 viewer codebase 與 §3 測試向量):
W1 builder 金鑰(助記詞 → WebCrypto)→ W2 Nostr 發布 + fragment/QR → W3 徽章子集(OIDC / DNS 手動 / GitHub)→ W4 supersession 升級到 App。

每一步結束都是可 demo 的整體。

## 8. Pear lane(v1 · day-0 共同設計)— App 對 App 私有通道

MultipeerConnectivity 刪除維持、Sharing tab 不復活、配對交換流程不做。「App 對 App」由 Pear(Bare + Hyperswarm)以更好的原語接手,並從近場升級為跨網路。**鐵律:只做私有通道 — 公開頁的儲存與驗證(Nostr / PDS / fragment + 靜態 viewer)一寸都不走 Pear。** 瀏覽器沒有 UDP、「DHT in browser」七年未解、hyperswarm 的 WebRTC 支援自 2020 年是開著的 issue;而成長迴圈核心是零安裝觀看者,這條線不能糊。

**Day-0 共同設計約束**(在建置順序第 1–3 步就要做對,晚了會重工):

1. DID-challenge 簽名格式與 Verify 掃描共用 — 同一份格式、同一組 conformance 測試向量;
2. profile / DAG 事件維持 append-only(≡ NIP-01),hypercore 可直接複製,不做破壞性更新;
3. dev client / prebuild 進 day-0 工程管線(bare-kit 是 native module,Expo Go 不再是開發路徑);
4. `solidarity://pear/…` deep link 保留於 URL 規格;viewer 只放 deep link 按鈕,不含任何 P2P 程式碼。

| 項目 | 內容 |
|---|---|
| Runtime | `react-native-bare-kit` Bare worklet;iOS/Android 同一份 P2P 程式碼;worklet 內直接 `require` Hyperswarm / Corestore,寫法同桌面版;官方 bare-expo config plugin 與 apps/expo 相容。**Expo 注意:native module — 需 dev client / prebuild,Expo Go 跑不了。** |
| 發現與連線 | swarm topic = hash(DID);HyperDHT 公鑰即全球位址;Noise IK 握手 + NAT 打洞(隨機化 NAT 亦可穿),穿不過退 blind relay — 中繼者只轉發 E2E 密文,讀不到內容 |
| 身分證明 | 連上後於 Noise 通道內簽 challenge 證明 DID 持有權 — 無配對 session、無 browse/advertise 狀態機 |
| 生命週期 | 前景才跑;進背景必須停掉所有 I/O,否則 OS 強制終止 — worklet 生命週期接 app 前後景事件 |
| 用途(v1) | ① 遠端私下交換完整名片(私人欄位不經任何伺服器);② SD-JWT 選擇性揭露對具體 verifier 私下出示 |
| 下一步(🗺) | ③ People 回訪重驗由輪詢 PDS/relay 升級為雙方在線時 P2P 複製增量 — DAG 簽名事件(≡ NIP-01)天然是 append-only log,對方 profile 可為一條 hypercore,nostrAdapter 資料模型幾乎不用改 |
| 入口 | 公開頁「Request private view」→ deep link 開 App → Pear 通道 → 對方看到你願意給他看的那張臉(US-20) |
| 軟依賴 | HyperDHT bootstrap 節點(預設 Holepunch 營運、`hyperdht` 支援自架)— 已列 01-spec §8 例外層,與 DoH resolver 同類 |
| v1 不做 | 非同步送達(需 blind peer — Keet 的解法,對我們是新軟基建,對方離線即送不到);真離線近場(DHT 要網路 bootstrap;QR/fragment 已覆蓋該格);行動網路對稱 NAT 穿透 — 新版靠 blind relay 緩解,但需實測後才承諾 |
