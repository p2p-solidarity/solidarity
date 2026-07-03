# 06 — Web Builder Implementation Plan(1.3.3 Verified Page,Web 軌 🌐)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 對應 spec:`docs/ref/01` §8 Web Builder 段、`02` US-21/US-22、`03` §2 Builder 表 + §7 Web 軌 W1–W4。前置:`05-plan-web-viewer.md` V0(同一顆 SPA)、`04-plan-app.md` A1(verify-core 簽名原語與向量)。


> **AMENDMENT(2026-07-03)**:`@solidarity/verify-core` 不另建 — 一律改讀為擴充既有 `packages/shared`(@solidarity/shared),詳見 04-plan Phase A1 amendment。
> **AMENDMENT 2(2026-07-03)**:web 程式碼**不住在本 repo 的 apps/web**(該目錄為未入庫 WIP,不 commit)— 正式 web 在獨立 repo `~/workspace/solidarity/solidarity-web`。本 plan 的 `apps/web/...` 路徑改讀為該 repo 對應路徑;`@solidarity/shared` 的跨 repo 消費策略(bun link / 發佈 / vendored vectors)於 V0 開工時定案。

**Goal:** solidarity.gg `/edit` — 無 App 的人在瀏覽器建立、簽名、發布同規格的 Verified Page;之後可 supersession 升級到 App 的 SE 金鑰。全程零伺服器、零帳號。

**Architecture:** Builder 是 viewer SPA 的另一條路由,共用 verify-core 與 config。金鑰派生規則放進 verify-core `derive.ts`(**app 的 US-22 匯入流程用同一份常數,兩端必須一致**)。私鑰以 WebCrypto `extractable:false` 匯入後只留 handle 在 IndexedDB;助記詞 = 唯一恢復碼。

**Tech Stack:** 同 apps/web(Vite+React+TS)+ `@scure/bip39`、`idb-keyval`;簽名 = WebCrypto ECDSA P-256(不可匯出);Nostr 發布 = 原生 WebSocket(復用 verify-core 的 event 編碼)。

## Global Constraints(每個 task 隱含)

- **零伺服器、零帳號**:builder 的所有網路呼叫僅限 Nostr relay、(可選)atproto OAuth/PDS、DoH、OIDC provider — 與 viewer 同一份 `config.ts` 白名單。
- 助記詞顯示期間:禁止任何網路請求發出(防外洩面);不落 localStorage/IndexedDB;離開建立流程即從記憶體清除。
- 誠實邊界文案(01 §8):web 金鑰 = 軟體金鑰;「清除瀏覽器資料 = 金鑰消失,只有助記詞能救」必須在建立流程與設定頁各出現一次,不得弱化。
- 徽章語意與狀態機同 01 §5/§7;A 級與 Pear 顯示「需要 App」+ 下載連結,不偽裝可用。
- profile 更新 = 產新 record(append-only),與 app 端規則一致。

---

## Phase W1 — 金鑰:助記詞 → did:key → IndexedDB

**Spec:** `/edit` 首訪 = 建立流程:生成 24 詞 BIP39 → 強制抄寫確認(隨機抽 3 詞回填,同 app A1.4 的 UX 規則)→ 派生 P-256 → WebCrypto `importKey(extractable:false)` → handle 存 IndexedDB → 顯示 did:key。回訪 = 從 IndexedDB 取 handle 直接進編輯器;「用助記詞恢復」入口永遠存在。

**Files:**
- Create: `packages/verify-core/src/derive.ts`、`apps/web/src/builder/{keys.ts,CreateFlow.tsx}`
- Test: `packages/verify-core/test/derive.test.ts`、`apps/web/test/keys.test.ts`

**Interfaces:**
```ts
// verify-core derive.ts 已於 04-plan A1.3 建立(HKDF_INFO_ROOT / HKDF_INFO_NOSTR)— web 直接 import,
// 同一助記詞在 App 與 Web 派生同一個 did(US-22 可攜的基礎),vectors/derive.json 兩端共用。
// apps/web builder/keys.ts
createIdentity(): Promise<{ mnemonic: string; did: string }>     // 生成;私鑰 import 後 scalar 立即清零
restoreIdentity(mnemonic: string): Promise<Result<{ did: string }>>
getSigner(): Promise<Result<Signer>>                              // verify-core Signer 介面,WebCrypto sign 包裝
```

**Web 端備份 UX 注意(01 §3 同一原則)**:瀏覽器沒有 iCloud Keychain — web 建立流程無可避免要過助記詞儀式,但把它做成「一頁完成」:生成 → 抄寫 → 抽 3 詞回填,全程強調「這是你身份的唯一備份」;passkey/PRF 派生列 roadmap(等支援面夠廣再換掉儀式)。

- [ ] Task W1.1: `keys.ts`(import verify-core `derive.ts`;WebCrypto import 不可匯出、idb-keyval 存 handle、scalar 清零)+ happy-dom 測試:簽名可被 `verifyCompact` 驗過;同助記詞與 app 向量派生同 did(吃 `vectors/derive.json`)
- [ ] Task W1.2: CreateFlow UI(生成 → 抄寫 → 抽驗 → 完成;助記詞畫面掛「無網路請求」守衛 — dev 模式 assert Network 空)+ 恢復/匯入入口 + 誠實邊界文案;Commit each

---

## Phase W2 — Profile 編輯 + 簽名 + 發布(Nostr / fragment / QR)

**Spec:** US-21 主體。編輯器欄位同 01 §3(displayName/avatar(URL)/bio/links);儲存 = `signCompact` 產 profile JWS;發布三形態:① Nostr — 由 `HKDF_INFO_WEB_NOSTR` 派生 secp256k1 鑰,kind 30078 + `d='solidarity.profile'` 發 ≥3 relay(與 app A4 同 event 形狀),kind-0 `alsoKnownAs` 寫入 did:key;② fragment 連結(`https://solidarity.gg/#<blob>`)複製鍵;③ QR 下載(PNG)。發布後直接以 viewer 元件預覽自己的頁。

**Files:**
- Create: `apps/web/src/builder/{Editor.tsx,publishNostr.ts,sharePanel.tsx}`
- Modify: `apps/web/src/routes`(/edit 掛編輯器)

- [ ] Task W2.1: Editor(zod 即時驗證,`parseProfile` 不過不給發布;更新 = 新 record)
- [ ] Task W2.2: `publishNostr.ts`(WS 發布、2/3 OK 才算成功、失敗態明確;relay 清單同 config)+ kind-0 更新
- [ ] Task W2.3: sharePanel(fragment 複製 + QR PNG 產生 — 用 canvas,無外部服務;>2KB 顯示尺寸警告)+ 發布後 viewer 預覽;Commit each

---

## Phase W3 — 徽章子集精靈

**Spec:** 01 §8 列表:S 級(Bluesky OAuth、Nostr(W2 已含)、DNS 手動 + DoH 輪詢、did:web、GitHub、did:pkh 經錢包擴充)、B 級 OIDC redirect(OpenPubkey,同 A9 nonce 規則)、C 級 bio 指引。每個精靈結束以 verify-core 對應 `badges/*` 當場驗證後才寫入 profile.badges。A 級護照與 Pear 出示 → 「需要 App」卡。

**Files:**
- Create: `apps/web/src/builder/wizards/{bluesky.tsx,dns.tsx,didweb.tsx,github.tsx,pkh.tsx,oidc.tsx,bio.tsx}`

- [ ] Task W3.1: DNS 精靈(顯示 host/value 複製鍵 → DoH 30s 輪詢 → 偵測即打勾;NS 判商教學連結)
- [ ] Task W3.2: Bluesky OAuth(atproto OAuth web flow;寫 `app.solidarity.profile` record 同 A6 形狀)
- [ ] Task W3.3: GitHub(challenge 檔下載 + `ssh-keygen -Y sign` 指令展示 + 簽章貼回 → sshsig 驗證)+ did:web(`.well-known/did` 內容產生器)
- [ ] Task W3.4: OIDC(OpenPubkey nonce 規則同 verify-core `badges/oidc.ts`;redirect 回 `/edit#oauth-callback`)+ did:pkh(window.ethereum personal_sign challenge)+ bio 指引卡;「需要 App」卡;Commit each

---

## Phase W4 — Web ↔ App 可攜(US-22)

**Spec:** 同一助記詞在兩端派生同一個 did(A1.3 統一派生)— **可攜 = 匯入,不是遷移**:裝 App 後在「匯入身份」輸入助記詞即延續同一頁,web 端不需要鎖定態(兩端持同鑰並存,replaceable event 後寫者勝)。web 端補匯出/匯入 UI;supersession 只在使用者之後主動輪替時出現(04-plan A12 已建原語),viewer 遷移導向 V1.3 已渲染。

**Files:**
- Create: `apps/web/src/builder/exportImport.tsx`(/edit 設定區)
- 依賴(他 plan):app 匯入 = 04-plan A1.4 `identity-export.tsx`;supersession = 04-plan A12

- [ ] Task W4.1: web 匯出/匯入 UI(匯出:確認後顯示助記詞 + 截圖警語;匯入:助記詞 → 同 did → 拉回已發布 profile 續編)
- [ ] Task W4.2: E2E 可攜 — web 建頁發布 → app 匯入同助記詞 → 同 did 繼續發布 → viewer 兩端內容一致
- [ ] Task W4.3: E2E 輪替 — app 輪替(A12)後,web 端偵測 supersession → 提示重新匯入新身份;舊連結經 viewer 導新頁;Commit each

---

## 完成定義(Builder)

- US-21/US-22 驗收全過:無痕視窗完整建頁 → 發布 → 另一台裝置 viewer 看到 `verified`;清站台資料 → 助記詞恢復成功;app 匯入同助記詞 → 同 did 無縫延續。
- 助記詞畫面 Network panel 零請求(守衛測試自動化)。
- conformance:`vectors/{derive,supersession}.json` 兩端(bun/node + happy-dom)全綠。
