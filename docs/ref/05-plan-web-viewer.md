# 05 — Web Viewer Implementation Plan(1.3.3 Verified Page)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 對應 spec:`docs/ref/01` §7–§8、`02` US-10、`03` §2 Viewer 表。App 主軌見 `04-plan-app.md`(V1 依賴其 Phase A1/A2 的 verify-core);Builder 見 `06-plan-web-builder.md`(同一顆 SPA)。


> **AMENDMENT(2026-07-03)**:`@solidarity/verify-core` 不另建 — 一律改讀為擴充既有 `packages/shared`(@solidarity/shared),詳見 04-plan Phase A1 amendment。
> **AMENDMENT 2(2026-07-03)**:web 程式碼**不住在本 repo 的 apps/web**(該目錄為未入庫 WIP,不 commit)— 正式 web 在獨立 repo `~/workspace/solidarity/solidarity-web`。本 plan 的 `apps/web/...` 路徑改讀為該 repo 對應路徑;`@solidarity/shared` 的跨 repo 消費策略(bun link / 發佈 / vendored vectors)於 V0 開工時定案。

**Goal:** 靜態 SPA viewer — 收到連結的人零安裝在瀏覽器看到頁面與每枚綠勾的即時驗證結果與證據;viewer 死亡 ≠ 頁面死亡。

**Architecture:** `apps/web`(Vite + React + TS),全部驗證在客戶端執行,邏輯 100% 來自 `@solidarity/verify-core`(與 app 同一組 conformance 向量)— viewer 只寫 IO adapter(fetch/WS/DoH)與渲染。無任何自有後端;部署 = CDN 靜態檔(Cloudflare Pages 免費層)。

**Tech Stack:** Vite、React、TS、`@solidarity/verify-core`(workspace)、瀏覽器原生 `fetch`/`WebSocket`/`DecompressionStream`(fragment 解壓 fallback 用 verify-core 的 fflate)。

## Global Constraints(每個 task 隱含)

- **零狀態**:無 cookie、無帳號、無寫入、無 PII analytics;`#` fragment 內容不得發出網路(01 §8)。
- 唯一允許的外連:公共 Nostr relay(WSS)、使用者的 PDS、`plc.directory`(快取 TTL 24h,localStorage)、DoH 雙 resolver、GitHub/Mastodon 公開 API、proof-fetch worker。禁止其他第三方資源(字型/analytics/CDN script)。
- **綠勾語意 = 控制權**(01 §1.2):所有文案不得越界;每枚徽章一鍵到證據(01 §1.3)。
- 徽章狀態只有 `verified / stale / revoked / declared`(01 §7);網路失敗 → `stale` + 「上次驗證於 T」,**永不誤標 revoked、永不渲染假結果**。
- 規格與程式碼開源可自架;任何 URL 常數(relay 清單、DoH endpoint、worker base)集中 `src/config.ts` 一檔,fork 改一處即可。

---

## Phase V0 — Scaffold + 部署管線

**Spec:** `apps/web` 建立,workspace 接上 verify-core;Cloudflare Pages 部署(含 `apps/web/public/oauth/client-metadata.json` — App 主軌 A6 的 atproto OAuth 依賴這個靜態檔)。路由:`/@:handle`、`/`(landing + fragment 處理)、`/edit`(builder 佔位,06-plan)。

**Files:**
- Create: `apps/web/{package.json,vite.config.ts,index.html,src/{main.tsx,App.tsx,config.ts,routes/*}}`、`apps/web/public/oauth/client-metadata.json`

- [ ] Task V0.1: Vite scaffold + workspace 接線(`bun install` 後 `import { parseProfile } from '@solidarity/verify-core'` 可編譯);`bun run --cwd apps/web build` 綠
- [ ] Task V0.2: 路由骨架(`/@:handle` 佔位、`#` 偵測);CSP meta(`default-src 'self'; connect-src` 白名單 = config.ts 清單)
- [ ] Task V0.3: Pages 部署(main branch auto-deploy)+ `client-metadata.json`(client_id = 部署 URL,redirect_uris 含 `solidarity://oauth` universal link);Commit each

---

## Phase V1 — Fragment / did:key 渲染 + JWS 驗證 + 狀態機 UI

**Spec:** US-10 的離線半套:`/#<blob>` → `decodeFragment` → `verifyCompact` → 渲染 profile(displayName/avatar/bio/links)+ 徽章列;`/#did:key:…`(無 blob)→ 顯示「此 DID 尚無可取回的頁面」引導。fragment 不出網路 — 解壓與驗簽全在本地。`supersededBy` 非空 → 頁面灰化 + 「已遷移 → 新頁」連結(01 §3)。

**Files:**
- Create: `apps/web/src/{pages/ProfilePage.tsx,components/{BadgeRow.tsx,Evidence.tsx},lib/loadProfile.ts}`
- Test: `apps/web/test/loadProfile.test.ts`(bun test,直接吃 verify-core `vectors/profile.json`)

**Interfaces:**
```ts
// lib/loadProfile.ts — V2 擴充同一入口
loadFromFragment(hash: string): Result<VerifiedProfile>
interface VerifiedProfile { profile: ProfileRecord; jwsValid: true; source: 'fragment'|'nostr'|'pds' }
// BadgeRow 渲染 BadgeState;Evidence = 每枚徽章的證據 modal(原始 DNS 應答 / event JSON / record JSON,一鍵展開)
```

- [ ] Task V1.1: `loadFromFragment` TDD(向量:合法/壞簽章/壞 schema → 各自 UI 態)
- [ ] Task V1.2: ProfilePage(JWS 失敗 → 全頁錯誤態,**不渲染任何 profile 欄位**;成功 → chrome 即繪)
- [ ] Task V1.3: 徽章列 + 狀態機視覺(verified 綠 / stale 灰黃 + 時戳 / revoked 灰刪線 / declared 空心)+ supersession 灰化 — 遷移卡兩種變體:舊鑰/recovery key 簽署 = 正常導向;圖譜背書單一表面(04-plan A12 `verifySupersessionByGraph` 回 `warning`)= 警示不採信;Commit each

---

## Phase V2 — Nostr + atproto 取回

**Spec:** US-10 線上半套。`/@:handle` → atproto handle 解析(`com.atproto.identity.resolveHandle` 對使用者 PDS 或公共 entryway)→ did → did doc(plc.directory,localStorage 快取 TTL 24h)→ PDS `com.atproto.repo.getRecord`(`app.solidarity.profile`/`self`)→ JWS 驗證。`/#did:key:…` → Nostr relay REQ(kind 30078、`#d=['solidarity.profile']`、authors 由 profile.alsoKnownAs 的 npub 反查)。兩源都有 → 取 `updatedAt` 新者,並列注記。

**Files:**
- Create: `apps/web/src/lib/{atproto.ts,nostr.ts,plcCache.ts}`
- Modify: `lib/loadProfile.ts`(來源合併)

- [ ] Task V2.1: `atproto.ts`(resolveHandle → didDoc → getRecord;每步失敗有明確錯誤態)+ `plcCache.ts`(TTL 24h,尊重 rate limit)
- [ ] Task V2.2: `nostr.ts`(復用 verify-core 的 event 驗簽;3 relay 並發、首個有效者勝、8s timeout)
- [ ] Task V2.3: 來源合併 + `/@handle` 全流程手動驗收(真帳號);Commit each

---

## Phase V3 — 徽章驗證全套 + 證據 + 轉化

**Spec:** 每次載入即時驗 S/C 級、B 級驗簽與效期(01 §7 規則)。全部呼叫 verify-core `badges/*`,viewer 提供瀏覽器 IO:DoH 雙 resolver 交叉(`_did`)、rel=me 直抓(Mastodon 公開 API)、GitHub `.keys` + sshsig、PK Token JWKS、bio 徽章走 proof-fetch worker(A11)。每枚徽章 → Evidence modal 附原始應答與外部 deep link。「Request private view」按鈕 = `solidarity://pear/<did>`(未裝 → 導 App Store);footer「Verified with solidarity — get yours」。

**Files:**
- Create: `apps/web/src/lib/io/{doh.ts,relme.ts,github.ts,jwks.ts,bioProxy.ts}`
- Modify: `BadgeRow.tsx`(逐枚非同步驗證,獨立 loading → 結果;一枚失敗不阻塞其他)

- [ ] Task V3.1: DoH IO(雙 resolver、`application/dns-json`、AD flag、不一致 → stale)接 `badges/dns.ts`
- [ ] Task V3.2: rel=me + GitHub(sshsig 驗證用 `sshsig` npm;`.keys` fetch)+ did:web(`.well-known/did`)
- [ ] Task V3.3: PK Token(JWKS fetch + verify-core `badges/oidc.ts`)+ bio proxy(worker 掛 → stale)
- [ ] Task V3.4: Evidence modal(原始資料 + 外部連結,一次點擊內 — 01 §1.3)+ private-view 按鈕 + footer;LinkedIn 類永遠 `declared`;Commit each

---

## Phase V4 — Conformance 對齊(App ↔ Web)

**Spec:** 03 §3:同一組向量,兩端結果逐項一致 — **單向宣稱不畫綠勾是最重要的一條**。CI job 同跑 `packages/verify-core` 測試(node)與 `apps/web` 測試(瀏覽器環境 happy-dom),向量新增時兩端自動吃到。

- [ ] Task V4.1: `apps/web/test/conformance.test.ts` — 逐向量斷言 UI 級結果(state + 是否渲染)與 app 端一致
- [ ] Task V4.2: CI workflow(GitHub Actions:`bun test` root + apps/web build + test);Commit each

---

## 完成定義(Viewer)

- US-10 驗收全過:陌生瀏覽器開 `/@handle` 與 `/#blob` 都能看到頁 + 每枚徽章可點證據;無 cookie(DevTools 檢查);fragment 無網路外洩(Network panel 零請求於純 fragment 頁)。
- Lighthouse:Performance ≥ 90(靜態頁應輕鬆達標);首繪 < 1s(fragment 路徑無網路)。
- 換一個域名自架(`wrangler pages deploy` 到測試帳號)整站可用 — 「viewer 死亡 ≠ 頁面死亡」實證。
