# solidarity — User Stories(收斂版)

> 對應 01-spec。格式:身分 / 想要 / 以便 + 驗收條件。標 ⭐ 為 App v1 必須;標 🌐 為 Web 軌(與 App v1 並行的獨立里程碑);標 🗺 為 roadmap。

---

## 建檔與身份

**US-01 ⭐ 第一次開 App**
作為新使用者,我想在 3 分鐘內擁有一張帶至少一枚綠勾的頁,以便立刻有東西可以分享。
- 開 App → 生成 did:key(seed 派生)→ 備份設定不可跳過:「用 iCloud 備份你的金鑰?」(推薦、一鍵、**須同意才開**)/ 不同意 → 助記詞抄寫 + 抽驗 → 引導綁第一個帳號(Bluesky / Nostr / Google 擇一)→ 產出頁面連結與 QR。
- 全程無帳號註冊、無 email、無密碼;助記詞儀式只出現在拒絕 iCloud 的路徑。

**US-02 ⭐ Bluesky 使用者帶身份進來**
作為 Bluesky 使用者,我想用既有帳號一鍵建立已驗證的頁,以便不用從零開始。
- atproto OAuth → App 寫入 `app.solidarity.profile` record 到我的 PDS → `alsoKnownAs` 雙向成立 → Bluesky 徽章 `verified`。
- 我的頁面資料存活在我的 PDS,不在 solidarity 的任何伺服器。

**US-03 ⭐ Nostr / 純 did:key 使用者**
作為沒有 Bluesky 的使用者,我想只靠金鑰就能發布頁面,以便不依賴任何平台帳號。
- App 將 profile 以 replaceable event 發至 ≥3 個公共 relay;Nostr 徽章 `verified`。
- 純 did:key 使用者(連 Nostr 都不想綁)仍可用 QR / fragment 形態分享完整頁面。

**US-19 ⭐ 從 Linktree 搬家**
作為既有 Linktree 使用者,我想貼上我的 Linktree 連結一鍵匯入,以便不用重打所有連結就換到可驗證的頁。
- 貼 URL → 解析公開連結清單 → 預填 `links[]`(全部標示「宣稱」)→ 逐條引導走綁定精靈升級綠勾。
- 別人的連結頁亦可存入 People 作 `declared` 快照聯絡人;對方建頁後,回訪重驗自動升級。

## 徽章綁定

**US-04 ⭐ 網域一鍵綁定(Domain Connect)**
作為網域擁有者(GoDaddy / IONOS / Cloudflare 等),我想在手機上不碰 DNS 面板就完成 `_did` 綁定,以便拿到最高等級的網域綠勾。
- 輸入網域 → App 探測 Domain Connect → deep link 到註冊商登入 → 按一次同意 → App 以 DoH 輪詢偵測記錄 → 徽章 `verified`;若域有 DNSSEC,顯示加成標記。

**US-05 ⭐ 網域手動綁定**
作為 DNS 商不支援 Domain Connect 的網域擁有者,我想要清楚的引導,以便自己貼一筆 TXT 就完成。
- App 由 NS record 判斷 DNS 商並顯示對應教學;host / value 各一顆複製鍵;背景輪詢,偵測到記錄即打勾;過程可離開 App,完成後推播。

**US-06 ⭐ OIDC 帳號綁定(OpenPubkey)**
作為使用者,我想綁定 Google / LINE / Discord 等登入,以便這些身份也出現在頁上且可被驗證。
- OAuth 流程中 nonce = hash(did:key 公鑰 + 亂數);取得 id_token 即成 PK Token;徽章顯示「驗證於 <時間>」;到期時 App 提示一鍵刷新。
- 公開展示前剝除 email 等個資欄位或僅顯示遮罩值。

**US-07 ⭐ 創作者防冒充(bio-link)**
作為 IG / X / OnlyFans 創作者,我想證明「這些帳號都是我」,以便粉絲能辨識假帳號。
- App 指示我把頁面連結(或 DID 字串)放進平台 bio → profile 自動寫入反向宣稱 → viewer 經無狀態 proxy 驗證雙向 → 徽章 `verified`。
- proxy 不可用時徽章顯示 `stale`(上次驗證時間),不誤標 `revoked`。

**US-08 ⭐ 護照 18+ 徽章**
作為使用者,我想用護照 NFC 拿到「18+ 已驗證」徽章,以便在需要時證明年齡而不暴露證件。
- NFC 讀取 → 裝置端 Passive Authentication → 產出 SD-JWT(over_18 等 claim,`cnf` 綁 did:key)→ 徽章 `verified`,可離線驗。
- 證件影像與 MRZ 原文不離開裝置、不進 profile。

**US-09 開發者組合(GitHub + 鏈上地址)**
作為開發者,我想用 SSH key 和 ETH 地址綁定,以便技術社群一眼確認是我。
- GitHub:以 SSH key 簽 challenge,viewer 對比 `github.com/<user>.keys`。did:pkh:簽 challenge 即成。皆為 S 級、可離線驗。

## 觀看與驗證

**US-10 ⭐ 觀看者(無 App)**
作為收到連結的人,我想在瀏覽器直接看到頁面與每個綠勾的狀態,以便不裝任何東西就能判斷真偽。
- 靜態 viewer 客戶端完成全部驗證(JWS、DoH、PDS、relay);無 cookie、無追蹤;`#` 後內容不出網路。
- 每枚徽章可點開證據(DNS 應答原文、平台上的簽名貼文、JWKS 驗章結果)。

**US-11 ⭐ 面對面驗證(Verify tab)**
作為 App 使用者,我想掃對方的 QR 立刻在本地驗證,以便沒有網路也能確認對方身份。
- 掃描 → fragment 解壓 → 本地驗簽;S 級與 A 級離線可判;需連線的徽章標示「離線,未即時查驗」。
- 結果卡一鍵「存入 People」。

**US-20 ⭐ 遠端私下出示 / 完整卡請求(Pear lane)**
作為使用者,我想讓公開頁上的「Request private view」把對方帶進一條 E2E 私有通道,以便完整名片(私人聯絡方式、內部欄位)與 SD-JWT 憑證只給我信任的特定對象,不經任何伺服器。
- 公開頁按鈕 → deep link 開 App → Pear 通道(topic = hash(DID);Noise 通道內簽 challenge 證明 DID 持有 — 與 US-11 掃描共用同一份 challenge 格式與測試向量)→ 選擇性揭露出示。
- 雙方需同時在線(非同步送達 = blind peer,🗺);公開頁的觀看與驗證完全不依賴此通道。
- 公開綠勾頁讓陌生人信任你;Pear 讓被信任的人看到更多。

## 聯絡人(People)

**US-12 ⭐ 儲存與回訪聯絡人**
作為使用者,我想保存驗證過的人並在回訪時看到變化,以便聯絡簿是活的。
- 儲存 = profile 快照 + 驗證時戳,存本地(選配 iCloud 私有備份);回訪時從 PDS / relay 拉最新版,徽章新增 / 灰化 / 金鑰輪替都有標示。
- 無任何伺服器端聯絡人同步。

## 金鑰生命週期

**US-13 ⭐ 金鑰遺失恢復 / 自由匯入匯出**
作為丟了手機(或想換裝置)的使用者,我想取回同一個身份,以便頁面與徽章不歸零。
- iCloud 路:新機登入同 Apple 帳號 → seed 自動同步 → 同 did 直接可用。
- 助記詞路:輸入助記詞 → 派生同 did → 重新發布 profile → 綁定重驗後回復。
- 匯出:設定內 Face ID 後顯示助記詞,隨時可匯出;匯入同上 — App ↔ Web 可攜。

**US-14 ⭐ 金鑰輪替(supersession)**
作為懷疑金鑰外洩的使用者,我想換一把新鑰匙並讓舊頁面自動導向,以便印出去的 QR 不變成死連結。
- 正常路徑:舊 key 簽 supersession record。災難路徑:≥2 個已綁定表面(atproto / Nostr / DNS)以原生機制為新 key 作證。
- viewer 對舊 DID 顯示「已遷移 → 新頁」,對僅單一表面背書的遷移顯示警示而非直接採信。

**US-15 撤銷網域**
作為使用者,我想刪掉 TXT 記錄就撤銷網域綁定,以便控制權變動時徽章如實反映。
- NXDOMAIN → 徽章 `revoked` 灰化;頁面其餘徽章不受影響。

## Roadmap

**US-16 🗺 年齡出示(SIOPv2 / OID4VP)**
作為使用者,我想在年齡受限網站用「Sign in with solidarity」同時完成登入與 18+ 證明,以便不上傳證件、不掃臉。

**US-17 🗺 群組成員徽章**
作為社群主辦方,我想發成員徽章(Semaphore),以便成員的頁上出現「已驗證成員」且成員名單可攜、不隨平台死亡。

**US-18 🗺 不可連結出示(OpenAC)**
作為高隱私需求使用者,我想以不可連結的方式證明屬性,以便多次出示無法被關聯 —— opt-in 模組,不進預設路徑。

## Web 軌

**US-21 🌐 Web 建頁(無 App)**
作為收到頁面但不想(或不能)裝 App 的人,我想直接在瀏覽器建立自己的頁,以便同一個成長迴圈不因平台斷掉。
- solidarity.gg `/edit`:瀏覽器生成 BIP39 助記詞(= 唯一恢復碼,強制抄寫確認)→ 派生 did:key(WebCrypto 不可匯出,IndexedDB 保存)→ 編輯 profile → 發布 Nostr + fragment/QR;全程無伺服器、無帳號。
- 可綁徽章:S 級子集(Bluesky / Nostr / DNS 手動 / did:web / GitHub / did:pkh)+ OIDC + bio;護照與 Pear 出示顯示「需要 App」。
- 誠實邊界:web 金鑰為軟體金鑰;清除瀏覽器資料 = 金鑰消失,只有助記詞能救 — UI 要講死。

**US-22 🌐 Web ↔ App 可攜**
作為先在 web 建頁的使用者,我想裝 App 後匯入助記詞就繼續用同一個身份,以便頁面連結、徽章、印出去的 QR 全部不變。
- App「匯入身份」:輸入助記詞 → 派生出同一個 did(統一派生規則)→ 頁面與綁定直接延續,無任何遷移儀式;反向(App → Web)同理。
- supersession 只在之後主動輪替金鑰時才出現(US-14)。
