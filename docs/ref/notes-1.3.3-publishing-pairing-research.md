# 1.3.3 連結 / 發布 / 配對 / 導入 — 解決方案(研究整併,待 grill)

> 2026-07-19 · 來源:codex 深度研究(session `019f75dd-1d00-7773-81c6-f97486c3d091`)+ repo 現況實查。
> 定位:`docs/ref/01`(SSOT)之下的落地方案;本文檔是 grill 標的,定案後改寫進 01/04。
> 範圍:短連結與 @handle、VC 子集上 Nostr 的隱私分級、app↔web QR 互簽、Pear 相互導入。

## 0. 已定規則(使用者拍板,非討論項)

- **R1** Web 永遠靜態、不存使用者資料(01 §1 no-server 不動搖)。
- **R2** Web 編輯的儲存/發布必經 App 端簽名(web 是不受信任的草稿面,人審 + Face ID 是安全邊界)。
- **R3** Linktree 整體匯入:App 端已落地(A2.4;Me 編輯 sheet + People declared 快照)。Web 端不自己抓頁(CORS + 靜態原則)— web 貼 URL 後併入 R2 的簽名流由 app 抓取,或走 §8 無狀態 proxy。
- **R4** 短網址的兩條既有註冊表路線 — **domain(`_did` TXT / `.well-known/did`)與 ENS(`.eth`)— 本版都要做到讀取支援**(至少 resolve → 取 record → 驗證)。→ 已開實作單(見 §6)。
- **R5** 不做資料庫;任何映射表必須是「別人已營運的註冊表」或可重算的無狀態層。

## 1. 核心架構句

> **Handle 負責定位;root DID 負責認證;Nostr 複製「公開或收件人加密」的產物;Pear 承載私密成對交換。**

四個問題全部從這句展開,互不越界。

## 2. 短連結(@handle)

### 現況(實測)

| 形態 | 長度 | 限制 |
|---|---|---|
| `app.solidarity.gg/#<fragment>` | ~670–740 字元 | 只能活在 QR;離線自足 |
| `app.solidarity.gg/#nostr:<npub>` | ~96 字元 | 需已 provision Nostr |
| `/@<atproto-handle>` | ~40 字元 | 只有綁 Bluesky 的人有;app 端未把它當分享連結提供 |

### 方案(codex 建議 + spec D6/D7 一致)

1. **主推 `https://app.solidarity.gg/@<handle>`** — 純 client-side 解析的別名,零資料庫(Cloudflare Pages 無 404.html 時 unmatched path 落回 SPA `/`,不需 Function/redirect 表)。
2. Handle 是**別名不是身份**:解析必 fail-closed —— handle → DID → DID doc `alsoKnownAs` 含 `at://<handle>` → PDS 取 record → JWS 驗簽 → **record 也反向宣稱同一 handle**。缺一不畫綠勾。
3. 分享 UI 三選一、誠實排序:`@handle`(短,需綁定驗證通過才提供)> `#nostr:<npub>`(Nostr-only 用戶)> fragment(離線簽名連結;**印刷物預設用它** — handle 可變、可被回收重用,印出去的 @handle 會斷或指向別人)。
4. R4 的 dns/ens resolver 落地後,`/@example.com`、`/@alice.eth` 同一 router 生效(D7 seam,first-match-wins)— 有網域/ENS 的人自帶短網址,我們零營運。
5. **不做 Solidarity 自營 username registry**(需要 namespace 所有權、防搶註、仲裁、可變伺服器儲存 — 全部違反 §1;且 @xxx 蹲名經濟會把產品拖進 moderation 泥沼)。純 did:key 且無任何外部 handle 的用戶,答案是引導綁 Bluesky(免費 handle)或接受 npub 長度。
6. 附帶:`@handle` 路徑對 CDN/網路中介可見(fragment 不會)— 保持 `Referrer-Policy: no-referrer`;瀏覽器解析 handle 需 DoH(瀏覽器發不了原生 DNS),DoH 是傳輸基建不是信任根,雙向檢查仍在本地跑。

## 3. VC 子集上 Nostr — 隱私分級

### ⚠️ 研究挖出的既有問題(先修才能談發布)

1. **現在的「選擇性揭露」是 UI 選擇،不是密碼學揭露**:`credentials/presentationProof.ts:63` 把 `selected_claims` 旁邊整包嵌入完整 raw VC JWT;`oidc/presenter.ts:188` 同。刪欄位/抄值都是 self-assertion — 真揭露需要 issuer 簽的 SD-JWT(RFC 9901)disclosure 可逐條省略,或原子化憑證。
2. **`credentials/vcImportExport.ts:52` 匯入只 decode 不驗簽** — 匯入的憑證不得因「存在於 StoredCredential」就進發布流。

### 四層分級(取代「public/professional/personal」欄位語意 — 那不是密碼學受眾)

| 層 | 傳輸 | 允許內容 | 誠實限制 |
|---|---|---|---|
| 本機保險庫 | 加密本地儲存 | 原始 VC、護照資料、識別碼 | 永不發布 |
| 成對即時 | Pear / verifier QR | SD-JWT+KB 或原子化證明,綁 `aud`+nonce | 對方仍可留存轉發 |
| 收件人加密非同步 | NIP-59 kind 1059,**每收件人獨立 wrap** | 同上,最好回應對方簽名請求 | relay metadata 可見;NIP-44 無前向保密 |
| 公開 | NIP-78 kind 30078 | **僅刻意公開、可驗證的抽象宣稱**(`age_over_18`,不是生日) | 複製到 relay 即不可撤(NIP-09 刪除只是請求) |

### 公開揭露的落地形狀(不改 ProfileRecord schema)

- `d=solidarity.profile` 不動;每條公開揭露佔獨立 NIP-78 槽:`d=solidarity.disclosure.public.v1:<slot-id>`,content = root 簽的 `PublicDisclosureRecord` JWS(`{v, typ, subject: rootDid, slot, evidence:{format,value}, issuedAt, expiresAt}`)。
- ProfileRecord 用既有開放槽引用:`badges[] += { type:'solidarity.publicDisclosure.v1', subject:'age_over_18', attestation:'nostr:30078:<pubkey>:<d>' }`。
- Viewer 顯示的宣稱**必須由驗證後的 evidence 派生**,不得有第二事實來源。
- 驗證 8 道閘:event 簽章 → author == 已雙向驗證的 Nostr 綁定 → 內層 JWS 對 root DID → issuer 簽章與信任政策 → evidence subject == root DID(1.3.3 拒收僅綁 card DID 的 evidence)→ 揭露集合白名單 → 效期/狀態 → **不得暴露穩定識別碼**(護照號、生日、憑證 ID、完整 VC 的 hash)。
- 護照特殊性:我們的護照 SD-JWT 是**裝置端自簽**(Passive Auth 後 app 發)— 公開徽章的誠實語意是「此 did 的裝置聲稱完成護照 Passive Auth」,不是政府背書。文案與 trust tone 不得越界(呼應 fallback-白 永不扮 ZK 的既有規則)。
- **1.3.3 界線**:分級模型 + 發布閘 + UI ship;公開層 evidence 在真 SD-JWT / 原子化憑證進來之前**先 gate**(presence-only 徽章可先行,evidence 後補)。NIP-59 非同步層 defer(需獨立威脅模型審查)。

## 4. App↔Web QR 互簽(R2 的機制)

### 決策形狀:per-action 遠端簽名(不搬助記詞、不做永久瀏覽器授權)

```
Web 草稿(draft-store 已存在)
  → 簽名請求 QR(web 以「臨時 P-256 session did」簽)
  → App 掃描:驗 nonce/requestId/digest/效期(≤5min)→ 顯示逐欄 diff → Face ID
  → App 以 root did 簽最終 canonical ProfileRecord + 綁定該請求的回應封套
  → 回傳:App 直接發 Nostr(web 訂閱 30078 看到新 record = 儲存成功)
         或 response QR / 固定 host 的 fragment callback(fragment 不出網路)
  → Web 驗回應(requestId/nonce/digest/session key 全對上)→ session 作廢
```

- `solidarity.webSignRequest.v1` / `solidarity.webSignResponse.v1` 為封閉型別:app 只接受編譯期已知 action、拒未知欄位、拒任意 callback URL、cap 解壓尺寸。
- web session 簽名提供 payload 完整性與 session PoP,**不證明網站 origin**(釣魚頁可自稱同 originHint)— 所以 app 端人審 diff 是安全邊界,不是裝飾。
- 大 record 用既有 `fragment.ts` + `qr/chunking.ts` 多幀原語。
- 傳輸三變體:桌機(QR 來回)/ 同裝置(deep link 去、fragment callback 回)/ 無相機(複製完整簽名字串)。
- 發布權:v1 **不給 web 常駐 root 或 Nostr 簽名能力**;web 自有助記詞模式保留為「進階 web-only 身份」路徑,不是連結 app 身份的預設。NIP-46 是好前例但簽的是 secp256k1 Nostr event,不能直接搬。

## 5. Pear 相互導入

### 方案:擴既有已認證通道,不引入 Hypercore(一次性交換用不到 append-only 複製)

```
card.exchange.request(exchangeId、profile digest、size、updatedAt)
  → accept / decline(雙方都同意才放行)
  → 雙向 card.exchange.offer(ProfileRecord JWS)
  → 各自獨立驗證 + 儲存
  → 雙向 card.exchange.receipt(saved | alreadyCurrent | keptNewer | conflict | failed)
```

- 驗證規則:JWS 對 `AuthenticatedChannel.peerDid` 驗簽 → 嚴格 parse → `record.did === peerDid` → 尺寸/時戳限制 → 以 root DID 冪等儲存。
- 合併規則:同 → 刷新驗證時間;較新 → 更新;較舊 → 保留並回 `keptNewer`;**同時戳不同內容 → 標 conflict 不靜默覆蓋**。裝置端筆記存 record 外。
- 誠實 UI 三態:「本機已存」「對方確認已存」「對方狀態未知」— 交換**不是原子的**(對方可收完就斷線),不承諾公平性;ack 掉了也不回滾本機儲存。
- **前置修理**:現在 `people/profileSnapshots.ts:240` 是無條件覆蓋 — freshness/conflict 政策是相互導入的前提,不是協定可以假設已存在的東西。
- 範圍:限已知 peer(Pear 握手本來就要雙方先知道對方 DID);面對面用 QR 互掃 bootstrap 兩個 DID。陌生人發現、匿名 responder 是獨立的握手+反濫用決策,不在本版。真機 NAT 矩陣(`notes-pear-poc.md`)仍未跑完,跑完前不宣稱廣域可用。

## 6. 交付順序(合併 codex 建議與進行中工作)

執行策略:平行 worktree(各自 base = 1.3.3 tip、非 isolation:worktree — 見 memory `worktree-isolation-base-gotcha`),Claude 逐一 review + cherry-pick 回 1.3.3。

**Wave 0(已 commit,branch 1.3.3):**
- ✅ **R4** `dns`+`ens` HandleResolver 讀取路徑(`6528cc0`/`76f6560`/`7bc7d64`)

**Wave 1(已全部 merge 回 1.3.3,整合後全套綠:typecheck 0 / lint 0 / 1509 unit + 110 parity):**
- ✅ **T3** `webSignRequest/Response.v1` 型別 + verify 原語 + 24 對抗向量(`3ee540a`;fail-closed:簽章先於信任任何欄位、strict schema、digest 重算、response 反替換綁定)— review 過(修一個 app-tsconfig strict 存取)
- ✅ **T2** `@handle` 分享別名(`af1b762`;只在 S8h 快取 verified+fresh 才給短連結;dns/ens 目前恆 unverified 誠實 fail-closed;dns 用 `@dns:<domain>` 顯式前綴)
- ✅ **T6** 真選擇性揭露(`8a319dc` + opaque 硬化;RFC 9901 SD-JWT:依 bytes 分類、每筆 disclosure 重算 digest、注入 disclosure 拒收;plain JWT 子集 fail-closed;import 驗簽)— 對抗性 review 被 session limit 切斷,關鍵性質改由主線親驗:①plain-JWT 子集拒收 ②unverified import 不可出示 ③SD-JWT 只揭露選定 ④注入 disclosure 拒收。review 中發現並修:`presentationProof.ts` 最終分支對 `opaque` 會連 raw bytes 一起送(buildVpToken 早已 fail-closed 拒 opaque/zk;此處對齊)。誠實殘留:plain-JWT full 揭露未建模欄位、靜態 ZK proof 沿用原集合(真 SD-JWT 攝入為後續票)
- ✅ **T5** Pear 相互導入 + snapshot merge 政策(`ea6bc43`;offer 對 Noise 認證的 `peerDid` 驗簽 + `record.did===peerDid`;merge = saved/alreadyCurrent/keptNewer/conflict,note 留 record 外;誠實三態 localSave×peerReceipt,掉 ack 不回滾)

**Wave 2 app 端(已 merge 回 1.3.3,整合後全套綠:typecheck 0 / lint 0 / 1547 unit + 110 parity):**
- ✅ **T4a** App 端 per-action root 簽名(`ddb8e69`;`websign/appSigner` 消費 T3 原語;approve 拒 `didMismatch`、adopt 前 `verifyCompact` 驗證;複用既有 Face-ID root signer + Nostr publish;deep-link + QR + 誠實 consent diff「網站簽名不證明 origin」)
- ✅ **T7** 三態隱私分級(`d70abc8`;per-item visibility 只在本地;三份簽名投影 published(public→Nostr)/shared(public+link-only→QR)/full(Pear);shared schema 加 optional `scope`(absent=full,back-compat,壞值 fail-closed);T5 merge 改 key `(did,scope)` 讓 public 投影與 full 卡共存不衝突;發布前 preview)
- ✅ **整合修** `525e525` adoptSignedProfile 重置 T7 投影(防 adopt 新 record 後 republish 舊 public 投影)
- ✅ **web re-bundle** `@solidarity/shared` 重打包進 airmeishi-web/vendor(含 dns/ens resolver + webSign + scope);web typecheck 0

**Wave 2 web 端(進行中 — 兩邊串聯的連接組織):**
- 🔄 **Web-A** viewer `@handle` 解析鏈接 dns/ens(R4 web 完成;DoH + eth RPC 皆 CORS-open;fail-closed 雙向)
- 🔄 **Web-B(T4b)** builder 簽 webSign request → QR → 消費 response(訂閱 Nostr / 掃 response QR 確認 app 已簽發)

**後續(重置後或另排):**
- ⏳ NIP-78 公開揭露 record(§3;真 SD-JWT evidence 接上後)
- ⏳ NIP-59 收件人加密非同步 — defer,獨立威脅模型審查後才排

## 7. 明確不做(1.3.3)

無資料庫 URL shortener;無自營 username registry;無永久瀏覽器授權;QR 不傳助記詞/私鑰;不公開完整 VC、穩定 VC 指紋、護照資料;不說「過期=刪除」(NIP-40 relay 可無限保留);無共享「朋友圈」加密 event;Pear 交換不自動夾帶 VC 匯入;不宣稱 Pear 交換原子/公平;一次性導入不用 Hypercore/Autobase。

## 8. 驗收攻擊面(測試必含)

- Handle:回收重用、DNS/HTTPS 結果衝突、缺反向宣稱、抄襲 PDS record、形近 handle。
- VC:選了 claims 仍整包外洩、不支援 issuer、holder/root 錯配、過期 evidence、竄改 disclosure、公開 event 刪除後重發。
- QR 互簽:過期、重放、請求調包、回應貼錯分頁、draft 被改、未知 action、超大解壓、使用者中途取消、雙 session 碰撞。
- Pear:decline、存檔後斷線、重試去重、錯 peer 的 JWS、新舊 record、同時戳衝突、並發交換、前後景切換恢復。

## 9. 決策定案(grill 2026-07-19,使用者拍板)

- **G1 ✅ 不做自營 @xxx registry。** 純 did:key 用戶 = 引導綁 Bluesky 或接受 npub;power user 走 R4 的 domain/ENS 兩條線。
- **G2 ✅ 護照公開層 = presence-only 徽章先行。** 主要驗證停留在 App 端功能;公開 evidence gate 到真 SD-JWT / 原子化憑證進來後(§6 順序 6→7)。
- **G3 ✅ 回傳通道兩者都留、依 action 選。** 發布類 action(profile.sign→publish)預設 App 直發 Nostr + web 訂閱;離線/非發布類留 response QR / fragment callback。
- **G4 ✅ v1 就上三態(public / link-only / private)+ 發布前 preview,接受雙 record 複雜度。** published subset 與 fragment 全量是同 did 簽的兩份 JWS;supersession/updatedAt 語意在 schema 任務中一併定。
- **G5 ✅ 裸 domain 歧義照實作單方向收:** atproto 優先、`dns:` 顯式前綴走 DNS resolver。
- **G6 ✅ 選擇性揭露修理必做(本版)。** 定性:現況其實是「選擇性 publish」而非選擇性揭露 — 修理 = presentationProof / oidc presenter 不得在選擇 claims 時整包外洩完整 VC;vcImportExport 匯入必驗簽。排進 §6 順序 6。
