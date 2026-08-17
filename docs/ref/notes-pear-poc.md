# Pear 跨裝置 PoC 操作手冊(Task A3.3)

對應 `docs/ref/04-plan-app.md` Task A3.3:「兩台實機不同網路互連 …
LTE↔WiFi、對稱 NAT 場景記錄結果到 `docs/ref/notes-pear-poc.md`(穿不過的組合
誠實記下,01 §8 v1 不做清單據此校準)」。

這份文件是給**人類**照著跑的操作手冊 —— 真實跨網路(尤其對稱 NAT)的行為
沒辦法在 CI/模擬器裡驗證,必須兩台實機、不同網路親自連一次。A3.3 的程式碼
部分(`src/pear/handshake.ts` 互驗 state machine、`src/pear/laneManager.ts`
生命週期、`/dev/pear-lane` 的 Cross-device 模式)已經就緒且有單元測試 —— 這
份手冊要做的只是「把已經寫好的東西跑一次,誠實記錄結果」,不是重新設計協定。

## 0. 前置需求

- 兩台實機,建議一台 iOS、一台 Android(若手邊只有同平台兩台也可以,先求
  「不同網路」這個變數,平台差異之後再補)。
- 兩台裝置都已完成 onboarding、有一把正式 root 身分(`getRootDid()` 能回
  `ok`)—— Cross-device 模式**不**走 A1.4 的測試 mnemonic,是真的正式金鑰,
  簽署時會跳 Face ID / 生物辨識。
- 兩台裝置能各自連上「不同」網路(見第 3 節的組合表),且都開了行動網路 /
  Wi-Fi 的資料連線。

## 1. 建置 dev client(兩台裝置都要)

`react-native-bare-kit` 是原生 TurboModule,**Expo Go 打不開這支 App** ——
一定要建 dev client(見 `apps/expo/CLAUDE.md` 的 Quick start,這裡重複一次
以求手冊自足):

```bash
cd apps/expo
bun install
bunx expo prebuild --clean --no-install        # 兩平台都跑,或用 --platform ios / --platform android 分開跑
bun run ios       # expo run:ios     — 建置 + 安裝到接上的 iOS 裝置/模擬器
bun run android   # expo run:android — 建置 + 安裝到接上的 Android 裝置
```

- iOS 實機需要在 Xcode 選對 Team + 實機 signing(`scripts/setup-ios-signing.sh`
  若尚未跑過,先跑一次)。
- Android 實機需要開啟開發者選項 + USB 偵錯,或改用 `bun run build:android:local`
  產生 APK 直接裝。
- 建置一次之後,之後 JS 端疊代可以只跑 `bun run start` + 裝置上下拉重新整理
  ,不需要每次都重建 —— 除非改到原生依賴(bare-kit 本身、Nitro modules)。

## 2. 開啟 Developer Mode + 找到 Pear Lane Lab

兩台裝置都要做:

1. 開 App → **Settings ▸ Developer**,打開最上面的 **Developer Mode** 開關
   (`developer.mode.toggle`)。
2. 往下捲到 **Pear (Bare Kit)** 區塊,點 **Pear Lane Lab**
   (`developer.pear.laneLabTitle`,`/dev/pear-lane`)。
3. 畫面頂端有個「Loopback / Cross-device」切換 —— 選 **Cross-device**
   (`developer.pearLane.modeCrossDevice`)。

Loopback 分頁是同一支 App 裡兩個 in-process worklet 互測(A3.2/A3.3 已經有
單元測試 + 這個分頁本身的手動驗收涵蓋),不是這份手冊的重點,略過。

## 3. 已知限制 —— 兩邊都要先手動交換 DID

**這是目前 Cross-device 分頁的真實限制,不是之後才會修的 bug,先讀完再開始
測,免得卡在「B 怎麼知道要連誰」。**

`src/pear/handshake.ts` 的互驗 state machine(A3.3 section 1)設計成兩邊都
**事先**知道對方的 DID(`authenticateChannel({myDid, peerDid, signer})`)—— 這
是刻意的範圍收斂,配上 TDD 測過的已知雙方身分握手,不是「任一方都能連」的
匿名 responder 模式(那個需要從第一個收到的 challenge 的 `requester`
欄位動態學習對方身分,是後續工作,現在没做)。

所以操作順序是:

1. 兩台裝置都打開 Cross-device 分頁,畫面上方 **MY DID** 欄位(唯讀、可
   選取複製)會顯示自己的正式 `did:key:…`(不需要簽署,不會跳 Face ID)。
2. 用旁路管道(唸出來、AirDrop 一則 Notes、傳 iMessage/Line…)把兩邊的 DID
   互相交換一次。
3. 裝置 A:Role 選 **Wait for peer**(`developer.pearLane.crossDevice.roleWait`),
   PEER DID 欄位貼上裝置 B 的 DID,點 **Start**。畫面應該進入
   「discovering → handshaking」(等待對方撥入)。
4. 裝置 B:Role 選 **Dial a peer**(`developer.pearLane.crossDevice.roleDial`),
   PEER DID 欄位貼上裝置 A 的 DID,點 **Start**。
   - Topic 是從「等待方」的 DID 算出來的(`pearTopicFor(A_did)`,兩邊算出
     來的值必須相同才會在 DHT 上相遇)—— 裝置 A 的角色決定 topic,裝置 B
     只是照著算同一個 topic 去撥。
5. 兩邊都會經過 `discovering`(DHT join / Noise 連線)→ `handshaking`(雙向
   DID-challenge 互驗,**這一步會各自跳一次 Face ID**,因為要簽署 challenge
   回應)→ `authenticated`。
6. 驗證過後,裝置 B(dial 方)會送一個 `dev.ping`,裝置 A(wait 方)回
   `dev.pong` —— 裝置 B 畫面會顯示實測往返時間(`frame-received`),裝置 A
   顯示「已回應」(`echoed`,不會編造一個假的往返時間,誠實只說有回應)。

任何一步卡住超過逾時(discovering/handshaking 共用 60 秒,見
`CROSS_DEVICE_TIMEOUT_MS`)畫面會顯示 `error` 狀態 + 具體原因(逾時 / 通道
錯誤 / 握手失敗訊息),不會卡死轉圈也不會假裝成功。

## 4. 誠實原則 —— 穿不過的組合就照實寫,不要重試到成功為止

**每個網路組合最多正常嘗試 2〜3 次**(排除明顯操作失誤,例如兩邊沒同時準備
好、DID 貼錯)。如果換了組合、重開 App、重連網路後仍然連不上,**就把它記成
失敗**,寫下實際發生的錯誤訊息與嘗試次數 —— 不要無限重試到剛好連上一次就
標記「✅ 可以」。這份記錄的目的是校準 `01-spec-verified-page.md` §8 v1 的
「不做清單」(哪些網路拓樸 v1 就是連不上,得靠中繼或之後的方案),誤標成
功會讓那份清單失真。

失敗時順手記下(不需要深入除錯,除非明顯是操作失誤):

- 卡在哪個狀態(`discovering` / `handshaking` / 逾時 / `error` 訊息全文)。
- 有沒有連上但握手失敗(代表 DHT/Noise 沒問題,是身分驗證那層的問題 —— 這
  種要另外回報,可能是真的 bug,不是網路穿透問題)。
- 兩邊裝置的網路型態(見底下表格的欄位)。

## 5. 結果記錄表(照這個格式貼進本檔案下方,每次跑完一組就補一列)

| 組合 | 裝置 A 網路 | 裝置 B 網路 | Connected?(DHT+Noise open) | Handshake?(雙向驗證過) | 用到中繼?(relay/TURN-equivalent,或純 P2P 直連) | Time-to-connect | 備註 / 錯誤訊息 |
|---|---|---|---|---|---|---|---|
| WiFi↔WiFi(同 LAN) | | | | | | | |
| WiFi↔WiFi(不同網路,例如家用 vs 咖啡廳) | | | | | | | |
| LTE↔WiFi | | | | | | | |
| LTE↔LTE | | | | | | | |
| 對稱 NAT(至少一邊在已知對稱 NAT 環境,例如某些企業網路/校園網路) | | | | | | | |

「用到中繼?」欄位:目前的 lane 走 hyperswarm 預設的 DHT + Noise,沒有另外
接自架 relay/TURN——如果某個組合連得上,大概率是 UDP 打洞成功的直連;如果
連不上,先假設是「這個 NAT 組合需要中繼但我們現在沒有」,不用深入追查具體
是哪一種 NAT 失敗模式,寫「連不上」+ 錯誤訊息就夠,校準用清單靠的是「連得
上 vs 連不上」這個粗粒度結果。

## 6. 待補

實際測試結果尚未填入 —— 這份手冊是 A3.3 程式碼交付的一部分,真人執行、填表
是後續步驟(見本任務的 controller 交接)。跑完之後把上面第 5 節的表格填滿,
連同任何真的 bug(而非網路穿透限制)另外開 issue 追。
