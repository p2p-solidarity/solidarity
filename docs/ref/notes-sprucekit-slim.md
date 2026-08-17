# SpruceKit 瘦身盤點(Task A0.3)

執行清單,供 Phase A10(`docs/ref/04-plan-app.md` Task A10.3)照表操課。範圍:
`grep -rn "spruceid\|SpruceIDMobileSdk" apps/expo nitro-modules` 命中的所有檔案,
含 TS spec/呼叫方、Swift/Kotlin 原生實作、config plugin、CI SPM pin、測試 mock。

**結論先講**:production TS 從未直接呼叫 `didKeyFromAlias` /
`didDocumentJson` / `verifyJws` / `verifyCredentialJwt` / `signCredentialJwt`
這 5 個方法 —— DID 推導與 JWS/VC 驗證已經 100% 走 `packages/shared` 的純 TS
實作(`didKeyFromJwk` / `resolveDidKey` / `verifyJwtEs256`),且這條路徑本來
就是 `signingKey.ts` 刻意繞過原生 Spruce 解析器的設計(見該檔第 316 行註解)。
真正呼叫 SpruceID SDK(`SpruceIDMobileSdkRs` / `com.spruceid.mobile.sdk`)的
原生程式碼,只存在於這 5 個死方法內部 —— 也就是說 **SpruceID SDK 本身在
production 路徑上已經是 0 依賴**,A10 可以整包砍掉 SPM package + Android
Maven 依賴,只留 `spruce-did` nitro module 的硬體金鑰管理殼(不再叫用
Spruce SDK,但仍是 JWS 簽署 / Secure Enclave / StrongBox 的必要面)。

## 1. Nitro spec 逐方法分析

檔案:`nitro-modules/spruce-did/src/specs/SpruceDid.nitro.ts`
(`SpruceDid` interface,13 個方法)。逐一對照 iOS
(`nitro-modules/spruce-did/ios/HybridSpruceDid.swift`)與 Android
(`nitro-modules/spruce-did/android/.../HybridSpruceDid.kt` +
`SpruceDidCryptoHelpers.kt` 的 `SpruceSdkBridge`)實作:

| 方法 | 用到的 SpruceID API | 提供的能力 | 分類 | 理由 |
|---|---|---|---|---|
| `generateKey(alias, keyType, requireBiometric)` | 無(iOS: `SecKeyCreateRandomKey`/`SecureEnclave.P256`;Android: `KeyPairGenerator`+`AndroidKeyStore`) | 產生硬體金鑰(SE/StrongBox) | **JWS 必要** | 不呼叫 Spruce SDK,是簽署鏈根源,`signingKey.ts:257` 唯一呼叫方 |
| `hasKey(alias)` | 無 | 同步存在性檢查 | **JWS 必要** | 同上,`signingKey.ts:203` |
| `keyAuthMode(alias)` | 無(iOS: `LAContext` probe;Android: `KeyInfo.isUserAuthenticationRequired`) | 判斷 native-acl vs js-gated 雙重生物辨識閘 | **JWS 必要** | 簽署流程的閘控邏輯,`signingKey.ts:130` |
| `deleteKey(alias)` | 無 | 刪除金鑰 | **JWS 必要** | `signingKey.ts:437`(登出/重置用) |
| `getPublicKeyJwk(alias)` | 無(iOS: `SecKeyCopyExternalRepresentation`;Android: `ECPublicKey`→JWK) | 匯出公鑰 JWK | **JWS 必要** | `signingKey.ts:187`,DID/JWS 驗證都要靠這把 JWK |
| `didKeyFromAlias(alias)` | iOS: `DidMethodUtils(method: .key).didFromJwk(jwk:)`(`HybridSpruceDid.swift:239`);Android: 反射呼叫 `com.spruceid.mobile.sdk.rs.DidMethodUtils.didFromJwk`(`SpruceDidCryptoHelpers.kt:153`) | 由 alias 推導 `did:key:z…` | **可直接刪除** | **無任何 TS 呼叫方**(全 repo grep 0 命中);`signingKey.ts:319-322` 的 `didKeyForCurrentIdentity()` 改叫純 TS `didKeyFromJwk()`(`packages/shared/src/identity/didKey.ts:41`),明確繞過此原生解析器 |
| `didDocumentJson(did)` | iOS: 恆丟 `spruceSdkError`(SpruceID 0.15.x 移除 `DidResolver`,已是死碼,`HybridSpruceDid.swift:251-263`);Android: 反射呼叫 `DidResolver.resolve`(`SpruceDidCryptoHelpers.kt:161-173`) | 解析 DID document | **可直接刪除** | 無 TS 呼叫方;iOS 端本來就打不通(SDK API 已移除),Android 端有實作但從未被呼叫 |
| `signJws(alias, payload)` | 無(CryptoKit/Security `SecKeyCreateSignature` / JCA `Signature("SHA256withECDSA")`) | JWS 簽署(compact serialisation) | **JWS 必要** | `signingKey.ts:300`,`signJwt()` 核心 |
| `signRawP256(alias, digest)` | 無 | 對 32-byte digest 做原始 P-256 簽章(OpenAC device-binding 用) | **JWS 必要** | `signingKey.ts:376`,ZK 憑證與 SD-JWT `cnf` 綁定都要 |
| `verifyJws(jws, did)` | iOS: 恆丟 `spruceSdkError`(`jwkFromDid`/`DidResolver` 已被 SpruceID 0.15.x 移除,`HybridSpruceDid.swift:348-361`);Android: 反射呼叫 `DidMethodUtils.jwkFromDid`(`SpruceDidCryptoHelpers.kt:157,366`,唯一在生產碼路徑真正打進 Spruce SDK 的活呼叫) | 用 DID 解出 JWK 後驗 JWS | **可直接刪除** | 無 TS 呼叫方;production 驗證改走 `resolveDidKey()` + `verifyJwtEs256()`(見 §3),已涵蓋同樣能力且雙平台行為一致(目前 iOS/Android 對這方法的行為根本不對稱——iOS 恆失敗、Android 會動——刪除後消除此落差) |
| `signCredentialJwt(alias, claimsJson)` | 無(內部直接呼叫 `signJws`) | 簽發 VC-JWT | **可直接刪除** | 無 TS 呼叫方;VC/SD-JWT 簽發改由 A10.1 的 `packages/verify-core/src/sdjwt.ts` 承接(`docs/ref/04-plan-app.md` Phase A10) |
| `verifyCredentialJwt(jwt)` | 內部呼叫 `verifyJws`(故 Android 間接觸及 Spruce SDK,iOS 間接恆失敗) | 驗 VC-JWT | **可直接刪除** | 無 TS 呼叫方,依賴的 `verifyJws` 本身要刪 |
| `addEventListener(handler)` | 無 | `keyGenerated`/`keyDeleted`/`biometric*`/`error` 事件流 | **JWS 必要** | 金鑰生命週期事件,伴隨保留的 8 個方法一起留 |

**小計:13 個方法 → 8 個留(JWS 必要)、5 個刪(可直接刪除)。**
被砍的 5 個方法涵蓋了目前程式庫中**全部**真正呼叫 SpruceID SDK 的原生程式碼——
`generateKey`/`hasKey`/`keyAuthMode`/`deleteKey`/`getPublicKeyJwk`/`signJws`/
`signRawP256`/`addEventListener` 這 8 個留存方法在 iOS/Android 兩側都不 import
`SpruceIDMobileSdkRs`、不呼叫 `com.spruceid.mobile.sdk.*`。

## 2. Swift/Kotlin 檔案層級依賴面

| 檔案 | 依賴 | 分類 |
|---|---|---|
| `nitro-modules/spruce-did/ios/HybridSpruceDid.swift:38-40` | `#if canImport(SpruceIDMobileSdkRs)` guard + `import SpruceIDMobileSdkRs` | **可直接刪除**——僅 `didKeyFromAlias`/`didDocumentJson`/`verifyJws` 用到,三者皆刪後這段 import 整塊移除 |
| `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift` | 無 Spruce import(只有 `CryptoKit`/`Foundation`/`LocalAuthentication`/`Security`) | **JWS 必要**,不受影響 |
| `nitro-modules/spruce-did/ios/SpruceDidCryptoHelpers.swift` | 無 Spruce import;`SpruceDidError.spruceSdkUnavailable`/`.spruceSdkError` 這兩個 case 只服務被刪方法 | **JWS 必要**(檔案留),兩個 error case **可直接刪除** |
| `nitro-modules/spruce-did/android/.../HybridSpruceDid.kt:314-321` (`didKeyFromAlias`/`didDocumentJson`) | 呼叫 `SpruceSdkBridge` | **可直接刪除**,隨方法一起砍 |
| `nitro-modules/spruce-did/android/.../HybridSpruceDid.kt:359-372,382-396` (`verifyJws`/`verifyCredentialJwt`) | 呼叫 `SpruceSdkBridge.jwkFromDid` | **可直接刪除** |
| `nitro-modules/spruce-did/android/.../SpruceDidCryptoHelpers.kt:152-193`(`SpruceSdkBridge` object 全體) | 反射存取 `com.spruceid.mobile.sdk.rs.{DidMethodUtils,DidResolver,DidMethod}` | **可直接刪除**——這是 Android 端唯一使用 Spruce SDK 的程式碼,五個呼叫方法全刪後這個 object 變孤兒 |
| `nitro-modules/spruce-did/android/build.gradle:160-169` | `implementation("com.spruceid.mobile.sdk:mobilesdk:0.14.10")` + `exclude group: "com.android.support"` | **可直接刪除**——`SpruceSdkBridge` 是唯一消費者,刪除後這個 Maven 依賴變孤兒(注意這是**反射**存取,不是 compile-time import,gradle 依賴本身也可以直接拔) |
| `nitro-modules/spruce-did/SolidaritySpruceDid.podspec:20-40` | `pod_target_xcconfig` 註解 + SPM 整合說明文字 | **可直接刪除**(文件性質,SPM package 拔除後改寫或整段移除) |

## 3. TS 呼叫方清單(唯一消費者:`signingKey.ts`)

全 repo 對 `@solidarity/nitro-spruce-did` 的 import,只有一個生產檔案:

- **`apps/expo/src/keychain/signingKey.ts`** —— `import { getSpruceDid, type SpruceDid } from '@solidarity/nitro-spruce-did'`(第 71-73 行)。呼叫的方法:`hasKey`(203)、`generateKey`(257)、`getPublicKeyJwk`(187,經 `readPublicJwk`)、`signJws`(300)、`signRawP256`(376)、`deleteKey`(437)、`keyAuthMode`(130,經 `resolveKeyAuthMode`)——與 §1 表格「JWS 必要」的 8 個方法中的 7 個一一對應(`addEventListener` 目前未被 JS 呼叫,但屬同一組必留的事件面,A10 執行時一併確認是否要接上 UI)。

驗證/DID 解析路徑已經是純 TS,**不經任何 SpruceDid 方法**:

- `apps/expo/src/oidc/proofVerifier.ts:15-17,73,87,137` —— `resolveDidKey` + `verifyJwtEs256`(來自 `@solidarity/shared`)驗 VC-JWT / VP-JWT
- `apps/expo/src/identity/businessCardEnvelope.ts:20-22,105,122` —— 同上,驗名片信封簽章
- `apps/expo/src/scan/envelopeHandler.ts:19,165` —— 同上,驗 QR 掃描信封
- `packages/shared/src/identity/didKey.ts` —— `didKeyFromJwk` / `resolveDidKey`,純 TS did:key 編解碼(P-256 multicodec + base58btc),`signingKey.ts:319-322` 直接呼叫這個而非原生 `didKeyFromAlias`
- `packages/shared/src/identity/jwt.ts` —— `signJwtEs256` / `verifyJwtEs256`,純 TS ES256 JWS 簽驗

以上 5 個檔案就是 A10 說的「能以 verify-core + 小型 SD-JWT 實作替代者」——**其實已經替代完成**,只是目前住在 `packages/shared` 而非尚未建立的 `packages/verify-core`。A10.3 若照 04-plan-app.md 建立 `packages/verify-core`,建議把這幾支識別碼 re-export 或搬遷過去,而不是重寫。

間接消費者(透過 `signingKey.ts` 的公開函式,不直接碰 `SpruceDid` 型別,無需改動):
`apps/expo/src/zk/proofManager.ts`(`signRawEs256`/`wrapRawSigningInputForSpruce`)、
`apps/expo/src/identity/coordinator.ts`、`apps/expo/src/cards/solidarityQrPayload.ts`
(註解提及,經 `zk/proofManager.ts` 動態 import)、`apps/expo/app/settings/dids.tsx`、
`apps/expo/app/dev/{identity-tree,p2p,nostr}.tsx`(僅註解提及「production Spruce DID」
一詞,實際走 `identity/coordinator.ts` → `signingKey.ts`)、`apps/expo/src/dag/devKey.ts`
(註解)。這些檔案不需要因為方法刪除而改動簽名,但若 A10 決定把 nitro module
改名(見 §6),字串註解建議順手更新。

## 4. 測試 / mock 依賴面

| 檔案 | 狀態 |
|---|---|
| `apps/expo/__tests__/parity/spruceDid.parity.test.ts` | `InMemorySpruceDidDriver`(52-260 行)對 5 個待刪方法(`didKeyFromAlias`188、`didDocumentJson`188、`verifyJws`229、`signCredentialJwt`233、`verifyCredentialJwt`240)全部只丟 `Error("not implemented in test driver")`——**連 mock 都沒有真正實作**,是刪除安全的強訊號。刪方法時同步從 `SpruceDid` interface 與此 driver 拿掉對應覆寫,否則 TS 編譯會因未實作 interface 成員而報錯 |
| `apps/expo/__tests__/unit/proofManager.test.ts` | stub `wrapRawSigningInputForSpruce`,只碰留存面,不受影響 |
| `apps/expo/__tests__/unit/qrEnvelopeWire.test.ts` | 同上 |
| `apps/expo/__tests__/unit/envelopeHandler.test.ts` | 同上 |
| `apps/expo/__tests__/unit/biometricGate.test.ts` | 註解提及 spruce-did wiring tests,不直接 mock | 

## 5. Build / CI / config plugin 依賴面

| 檔案 | 內容 | A10 動作 |
|---|---|---|
| `apps/expo/plugins/withSpruceIdSpmPackage.js` | 整個 config plugin:`withXcodeProject` 注入 `XCRemoteSwiftPackageReference`(`sprucekit-mobile`,`SPM_VERSION='0.14.10'`,`upToNextMajorVersion`)+ `withDangerousMod` 改 Podfile 幫 `SolidaritySpruceDid` pod target 補 `SWIFT_INCLUDE_PATHS`/`FRAMEWORK_SEARCH_PATHS`/`RustFramework` modulemap | **可直接刪除**(整個檔案),`import SpruceIDMobileSdkRs` 拔除後不再需要把 SPM package 連進 app target 或幫 pod target 開搜尋路徑 |
| `apps/expo/app.json:153` | `"./plugins/withSpruceIdSpmPackage.js"` 掛進 `plugins` 陣列 | 隨上一項一起移除該行 |
| `apps/expo/scripts/ios-spm.Package.resolved:4-12` | checked-in SPM pin,`sprucekit-mobile` @ `0.17.3`(2026-06-27 才由 commit `b6d09ef` 從 `0.15.10` 緊急 bump,因為 Xcode Cloud 上 `0.15.10` 解析不出來) | **可直接刪除**該條目(config plugin 拔掉後 workspace 不會再產生 `sprucekit-mobile` 的 package reference,這個 pin 條目會變成多餘 —— 但要等 A10.3 實機驗證 prebuild 產出的 workspace 確實不再引用它,再一起清掉,避免 `prepare-ios-workspace.sh` 的 stale-pin 檢查誤判) |
| `apps/expo/scripts/prepare-ios-workspace.sh:295-340` | 讀取/驗證/回填 `ios-spm.Package.resolved` 的邏輯 | 不需改動邏輯本身(它是通用的 SPM pin 機制,其他套件如 `swift-algorithms` 仍會用到),只是 sprucekit-mobile 這一條目消失 |
| `nitro-modules/spruce-did/android/build.gradle:160-169` | `com.spruceid.mobile.sdk:mobilesdk:0.14.10` | **可直接刪除**(見 §2) |
| `nitro-modules/spruce-did/BUILD.md:26-51` | iOS/Android SpruceID SDK 手動整合步驟說明 | 整段改寫或刪除,並修正文件已經漂移的版本號(見 §6) |
| `nitro-modules/spruce-did/SolidaritySpruceDid.podspec` | 見 §2 | 同上 |
| `nitro-modules/nfc-passport/android/build.gradle:159-161` | 註解提及「Matches the proximity / spruce-did pin」協調 coroutine 版本,**非** SpruceID SDK 依賴 | 不用動,純粹是版本協調註解,砍 spruce-did 的 SDK 依賴不影響這行的 kotlinx-coroutines pin |

## 6. 觀察到的版本漂移(A10 順便處理)

三處各存一份 SpruceID 版本號,彼此不一致,也早已跟 checked-in pin 脫鉤:

- `nitro-modules/spruce-did/BUILD.md:43,49` —— 文件寫 `0.14.10`(iOS 手動整合步驟 + Android Maven 版本)
- `apps/expo/plugins/withSpruceIdSpmPackage.js:50` —— `SPM_VERSION = '0.14.10'`(`upToNextMajorVersion`,所以實際被 `0.17.3` 滿足,不會炸,但常數本身是誤導性文件)
- `apps/expo/scripts/ios-spm.Package.resolved:10` —— 實際 pin 是 `0.17.3`(commit `b6d09ef`,2026-06-27)
- `nitro-modules/spruce-did/android/build.gradle:164` —— Android 端仍精確 pin `0.14.10`,和 iOS 端已經有 major 內的 minor 差距

若 A10 選擇整包刪除 SpruceID SDK(§1 結論),這些漂移全部隨依賴一起消失,不需要單獨修正;若基於任何理由決定保留 SDK,則需要先解決這個漂移再談瘦身。

## 7. `spruce-did` nitro module 改名建議(非 A0.3 範圍,留給 A10 決策)

刪完 5 個方法 + SpruceID SDK 依賴後,`nitro-modules/spruce-did` 這個目錄/pod/
package 名稱(`SolidaritySpruceDid`、`@solidarity/nitro-spruce-did`、
Kotlin package `com.margelo.nitro.gg.solidarity.sprucedid`)會變成純粹的硬體
金鑰簽署模組,不再 wrap 任何 Spruce 程式碼——只是保留 `did:key` 這個身分模型
（純 TS 產生,見 §3）。是否改名(例如 `nitro-signing-key`)、要不要保留
`SpruceDid` 這個型別名稱以降低 diff 面積,留給 A10 執行者依實際 diff 成本
決定;本文件只確認「改不改名都不影響功能正確性」。

## 8. 總結表(HybridObject 方法今日 vs A10 後)

| 方法 | 今日存在 | A10 後存活 |
|---|---|---|
| `generateKey` | ✅ | ✅ |
| `hasKey` | ✅ | ✅ |
| `keyAuthMode` | ✅ | ✅ |
| `deleteKey` | ✅ | ✅ |
| `getPublicKeyJwk` | ✅ | ✅ |
| `signJws` | ✅ | ✅ |
| `signRawP256` | ✅ | ✅ |
| `addEventListener` | ✅ | ✅ |
| `didKeyFromAlias` | ✅ | ❌ 刪(用 `packages/shared` 的 `didKeyFromJwk`) |
| `didDocumentJson` | ✅ | ❌ 刪(無呼叫方,iOS 早已不可用) |
| `verifyJws` | ✅ | ❌ 刪(用 `resolveDidKey`+`verifyJwtEs256`) |
| `signCredentialJwt` | ✅ | ❌ 刪(VC/SD-JWT 簽發改 A10.1 `packages/verify-core/src/sdjwt.ts`) |
| `verifyCredentialJwt` | ✅ | ❌ 刪(依賴 `verifyJws`,同上一併刪) |

**13 個方法 → 8 留 / 5 刪。SpruceID SDK(iOS SPM `sprucekit-mobile` +
Android Maven `com.spruceid.mobile.sdk`)在生產路徑上 0 依賴,可隨 5 個死
方法整包移除。**
