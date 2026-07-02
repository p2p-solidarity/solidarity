# solidarity — Verified Page 規格(收斂版)

> 2026-07 · 定位:驗證版 Linktree。一張你自己持有、任何人可驗證、不依賴我們的伺服器也能存活的身份頁。
> 本文件為單一事實來源(SSOT);user stories 見 02、App/Web 分工見 03。

---

## 1. 產品原則(不可違反)

1. **No-server**:我們不儲存使用者資料、不營運帳號系統、不成為驗證流程的必經之路。公司消失,頁面與所有證明仍可被任何人驗證。
2. **綠勾語意 = 控制權**:「已驗證」只代表「此人此刻控制該帳號 / 網域 / 金鑰」,不代表本名、名氣或可信度。UI 文案與規格都不得越界宣稱。
3. **一鍵到證據**:每個綠勾距離平台原生證據(DNS 應答、簽名貼文、gist、JWKS 驗章結果)不超過一次點擊。
4. **輕量預設**:JWS / SD-JWT 為主幹;ZK(OpenAC/Noir)僅為 opt-in 模組,永不進 hot path。
5. **金鑰生命週期是唯一不許輕量的地方**:恢復機制 day-one 強制,不是 v1.1。

## 2. 資訊架構:三個 Tab

| Tab | 職責 |
|---|---|
| **People** | 聯絡人。已儲存的他人 profile 快照 + 回訪時即時重驗與徽章變化提示。 |
| **Me** | 我的已驗證名片。卡片本體(合併原 Share tab 底部的 QR 展開卡)+ 編輯 profile、分享 QR、Linktree 匯入、恢復與輪替設定。 |
| **Verify** | 驗證中心。相機掃描 QR、深連結處理、驗證結果卡(徽章 + 證據,一鍵存入 People)+ 我的徽章綁定管理(自原 Me 下半遷入,擴充為 §5 各平台綁定精靈)。 |

Sharing tab 移除;MultipeerConnectivity P2P 交換流程刪除。加聯絡人 = 在 Verify 掃對方 QR → 本地驗證 → 存入 People。互換自然湧現(我掃你、你掃我),不需要配對 session。

**Linktree 匯入(遷移漏斗)**:貼上既有 Linktree(或任何純文字連結頁)URL → 解析為 `links[]` 預填我的頁,每條連結標示「宣稱」→ 逐條引導走綁定精靈升級綠勾(plaintext → 可驗證)。同一機制反向用於 People:把別人的連結頁存成 `declared` 快照聯絡人,對方日後建頁,回訪重驗自動升級。

## 3. 身份核心

**根身份**:did:key(P-256),由 BIP39 seed 派生(verify-core 統一派生規則 — **同一助記詞在 App 與 Web 得到同一個 did**,身份天然可攜);seed 存 Keychain,簽名操作經 Face ID 閘控(沿用現有 keychain vault)。SE 硬體保管與金鑰 attestation 列 roadmap(可攜與硬體不可匯出互斥,v1 選可攜)。

**Profile Record**(canonical JSON + JWS,由 did:key 簽):

```json
{
  "v": 1,
  "did": "did:key:z...",
  "displayName": "...",
  "avatar": "<url | blob-hash>",
  "bio": "...",
  "links": [{ "label": "...", "url": "..." }],
  "alsoKnownAs": ["at://alice.bsky.social", "nostr:npub1...", "dns:example.com"],
  "badges": [{ "type": "dns", "subject": "example.com", "attestation": "<ref|inline>" }],
  "supersededBy": null,
  "updatedAt": "2026-07-03T00:00:00Z"
}
```

**金鑰生命週期**:
- 備份(建檔時必須完成一種;**預設推薦 iCloud Keychain,但必須徵求使用者同意**):① iCloud Keychain — seed 以 synchronizable item 存放,跨裝置自動、零記憶負擔;② 不同意 iCloud 者走助記詞抄寫(強制抽驗確認)。助記詞儀式只在使用者主動選擇時出現 — 它的 UX 成本我們認了,但不強加給預設路徑。
- 自由匯入匯出:設定內隨時可匯出助記詞(Face ID 後顯示)、或以助記詞匯入既有身份 — App ↔ Web 同一 did 無縫可攜,不需要任何遷移儀式。
- 輪替(supersession):正常輪替 = 舊 key 簽署指向新 key 的 supersession record,發布到所有儲存面。舊 key 不可用 = **圖譜反向背書**:≥2 個已綁定表面用各自原生機制為新 key 作證(atproto 新 record、Nostr 新 kind-0、DNS `_did` 換值),viewer 據此接受遷移並顯示提示。
- 撤銷語意:`supersededBy` 非空 → 舊頁面灰化並導向新 DID。

## 4. 儲存面(無伺服器)

本地(App)為 source of truth;「發布」= 同步至以下表面,依可用性優先:

1. **atproto PDS**:lexicon `app.solidarity.profile`,寫入使用者自己的 repo(atproto OAuth)。PDS 端點 CORS 開放,viewer 直接取。
2. **Nostr**:parameterized replaceable event(kind 3xxxx,`d=solidarity.profile`),發至 ≥3 個公共 relay。發布只需 keypair、無帳號 —— **純 did:key 使用者的預設家**。
3. **URL fragment**:profile 壓縮(deflate + base64url)嵌在 `#` 後 —— QR 與離線形態;fragment 不會送出網路,CDN log 也看不到內容。

## 5. 徽章庫(S / A / B / C)

| 級 | 徽章 | 綁定協定 | 驗證方式 |
|---|---|---|---|
| **S** 純密碼學(可離線) | Bluesky/atproto | atproto OAuth + 簽名 record,`alsoKnownAs` 雙向 | 驗 DID doc 鏈 + record 簽章 |
| | Nostr | kind-0 `alsoKnownAs` + profile 反向 | 驗 npub 簽章 |
| | DNS 網域 | `_did.<domain> TXT "did=..."` + profile 反向 | 原生 DNS / DoH 交叉;DNSSEC AD → 徽章升級 |
| | did:web / 個人網站 | `.well-known/did` | HTTPS 取回比對 |
| | 鏈上地址(did:pkh) | 用鏈金鑰簽 challenge | 純驗簽 |
| | PGP(Ariadne 相容) | 互簽 / notation | 驗簽(吃下 Keyoxide 使用者) |
| | GitHub(金鑰法) | 以 SSH/GPG key 簽 challenge | 對比 `github.com/<user>.keys` 公開 API |
| **A** 政府/硬體 | 護照 NFC | 裝置端 Passive Auth → 自簽 SD-JWT(over_18 / over_21 / nationality,`cnf` 綁 did:key) | 驗 SD-JWT + 選擇性揭露 |
| | 自然人憑證 | 卡片簽章 → SD-JWT | 驗發行鏈 |
| | (roadmap)mDL / EUDI PID | ISO 18013-5 / OID4VP | 驗發行鏈 |
| **B** 平台簽名(時間框定) | Google / Apple / Microsoft / LINE / Discord / Twitch 等一切 OIDC | **OpenPubkey 模式**:OAuth nonce = hash(did:key 公鑰 + 亂數) → id_token 即平台簽名的綁定證書(PK Token) | 驗 IdP JWKS;顯示「驗證於 T」;到期可刷新;JWKS 輪替需歷史金鑰處理 |
| **C** 公開表面(Keybase 式) | Mastodon / Threads | rel=me(公開 API,CORS 開放) | 客戶端直抓 |
| | GitHub gist、Reddit、HN | 簽名聲明貼於公開表面 | 客戶端直抓 |
| | X / IG / TikTok / YouTube / OnlyFans | bio 內放 profile URL 或 DID 字串 | **無狀態 proxy** 抓取(§8) |
| | LinkedIn | 不可驗 | 僅顯示「宣稱」 |

凍結至 roadmap:群組成員徽章(Semaphore)、人際背書(vouch)、zk-email、OpenAC 不可連結出示、SIOPv2 登入。

## 6. `_did` DNS 綁定(本版重點功能)

- 記錄:`_did.<domain> TXT "did=did:key:z..."`(TXT 為主、URI record 為輔;label 品牌中立,對齊 IETF draft-carter-high-assurance-dids-with-dns)。
- 反向:App 自動將 `dns:<domain>` 寫入 profile `alsoKnownAs`(使用者零動作)。**兩向都成立才畫綠勾。**
- Onboarding 三層:
  1. **Domain Connect**(GoDaddy / IONOS / Cloudflare / Aruba / EuroDNS / WordPress.com / Plesk…):App 探測 `_domainconnect` → deep link 註冊商 → 使用者按一次同意 → 記錄自動建立。
  2. **引導複製貼上**:NS record 偵測 DNS 商 → 顯示該家教學 + host/value 複製鍵 → DoH 每 30 秒輪詢,偵測到即完成。
  3. **`.well-known/did`** fallback:動不了 DNS 但有 hosting 的人。
- 手機端驗證:原生 resolver + DoH(Cloudflare / Google JSON API)雙路交叉;DNSSEC AD flag → 顯示加成徽章。
- 撤銷:刪記錄 → NXDOMAIN → 徽章灰化(draft-carter 語意)。金鑰遺失時這是網域徽章的逃生門。

## 7. 徽章狀態機

`verified`(即時查驗通過)→ `stale`(上次驗證於 T,目前不可達或憑證過期)→ `revoked`(NXDOMAIN / 記錄移除 / superseded)。另有 `declared`(結構上不可驗,如 LinkedIn)。

規則:Web viewer 每次載入即時驗 S / C 級;B 級驗簽章與效期;A 級驗發行鏈(可離線)。所有狀態附證據 deep link。

## 8. Web Viewer 與例外層

**Viewer(靜態 SPA,CDN 免費層)**:無 cookie、無帳號、無寫入、無 analytics PII。URL:`/@<atproto-handle>`(客戶端解析)、`/#did:key:...`、`/#<blob>`。規格公開,任何第三方可自架 viewer;QR 承載 fragment 資料,不依賴我們的域名存活。頁上「Request private view」按鈕 = `solidarity://` deep link(未裝 App → 導安裝)— **viewer 本身不含任何 P2P 程式碼**。Footer:「Verified with solidarity — get yours」(唯一成長迴圈)。

**Web Builder(`/edit`,Web 軌 🌐)** — 同一顆靜態 SPA 的建頁路由,讓無 App 的人進同一個成長迴圈;零伺服器、零帳號:

- **金鑰**:瀏覽器生成 BIP39 助記詞(**它就是恢復碼** — §1 第 5 條在 web 同樣成立,建檔時強制抄寫確認)→ HKDF 派生 P-256 → WebCrypto `extractable: false` 匯入 → IndexedDB 保存 handle。清除站台資料 = 金鑰消失,唯一救援是助記詞;UI 必須把這句話講死。
- **發布面**:Nostr(瀏覽器 WS 直發公共 relay — 預設家)、fragment 連結 / QR 下載;atproto OAuth(PDS)可選。三個面全部瀏覽器可達,無需任何我們的伺服器。
- **可綁徽章子集**:S 級(Bluesky OAuth、Nostr、DNS 手動貼 TXT + DoH 輪詢、did:web、GitHub、did:pkh 經錢包擴充)、B 級 OIDC(redirect 流程)、C 級 bio。**不可**:A 級護照(要 NFC)、Pear 私下出示 — 顯示「需要 App」。
- **升級到 App**:裝 App → 匯入助記詞 → **同一個 did 直接延續**(§3 統一派生規則),頁面、徽章、印出去的 QR 全部不變;supersession 只在之後主動輪替時才用。
- **誠實邊界**:web 金鑰是軟體金鑰、無硬體保護;v1 viewer 不宣稱金鑰保管等級(金鑰 attestation 列 roadmap)。

**例外基礎設施(軟依賴,皆可自架)**:
1. 無狀態 proof-fetch worker(Cloudflare Workers 免費層),只為圍牆花園 bio 抓取;狠快取、無 PII log、開源可自架。worker 掛 → 該類徽章降 `stale`,其餘一切照常。
2. **HyperDHT bootstrap 節點**(Pear lane;預設 Holepunch 營運、支援自架)— 掛了只影響私有通道建立,公開頁驗證路徑不受影響。與 DoH resolver 同一類。

另:PLC directory 有速率限制,DID doc 客戶端快取(TTL 24h)。

## 9. 刪除 / 凍結清單(本次決策)

刪除:Sharing tab、MultipeerConnectivity P2P 交換、CloudKit 群組同步、P2P chat(不做)。
MultipeerConnectivity 刪除維持;「App 對 App」這條線由 **Pear lane**(v1、day-0 共同設計;Bare + Hyperswarm,見 03 §8)以更好的原語接手,從近場升級為跨網路 — 前提:**永遠只做私有通道,公開頁的儲存與驗證一步不涉**(瀏覽器連不上 hyperswarm,零安裝觀看者是成長迴圈核心)。
瘦身:SpruceKit 全棧 → 僅留 JWS + SD-JWT(護照憑證);OpenAC/Noir circuits 移出 App、留在 passport-noir repo 作 opt-in 模組。
保留:聯絡人(改本地儲存 + 選配 iCloud 私有備份)、nostrAdapter、keychain vault、Face ID 閘控、DomainVerificationManager(演化為 `_did` 驗證器)。

## 10. 非目標

不宣稱「唯一真人」(v1 無 nullifier,只宣稱「真實護照持有者」);不做分數聚合;不上鏈;不做聊天;不驗 LinkedIn;不做集中式徽章資料庫。

## 11. 成功指標(建議)

頁面觀看 → 安裝轉換率;各級徽章綁定完成率(`_did` 走 Domain Connect 的完成率單獨看);W1 留存;被貼到 Bluesky/Nostr bio 的頁面數;第三方 viewer 出現(生態健康信號)。
