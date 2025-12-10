<div align="center">
<h1>Solid(ar)ity</h1>
<p>A privacy-preserving, proximity-based business card sharing app built with zero-knowledge proofs, CloudKit-backed group sync, and P2P networking.</p>

<img src="./airmeishi/Assets.xcassets/AppIcon.appiconset/1024.png" width="50%" height="50%"></img>

![License: Apache 2.0](https://img.shields.io/github/license/kidneyweakx/solidarity)
</div>

## What is Solid(ar)ity?

Solid(ar)ity is a local-first, privacy-first business card sharing app that works offline by default. P2P handles contact exchange; CloudKit is used only to synchronize group metadata and invitations when you opt in. No tracking. No centralized server.

Exchange business cards with nearby people while keeping full control of your data through zero-knowledge proofs and selective disclosure.

### Why it matters

Your data lives on your device. You decide what to share, when, and with whom.

### Key Features

- Offline-first P2P via MultipeerConnectivity with QR/ShareLink fallbacks
- Zero-knowledge identity using SemaphoreSwift + Mopro
- Selective disclosure: public / professional / personal levels per field
- Apple Wallet export with PassKit
- Group verification with cryptographic membership proofs
- CloudKit group sync: optional metadata + invite syncing; cards stay local

## Architecture at a Glance

- Storage: AES-GCM encrypted payloads with SwiftData caching for groups; no remote database for cards.
- Identity & proofs: SemaphoreSwift + Mopro; `SemaphoreGroupManager` maintains Merkle trees per group.
- Proximity sharing: `ProximityManager` and `GroupProximityManager` handle discovery, QR, AirDrop, and ShareLink handoff.
- CloudKit sync (opt-in):
  - `CloudKitGroupSyncManager` manages the `AirMeishiGroups` custom zone.
  - Public DB for invite tokens; private/shared DBs for owned and joined groups.
  - Subscribes to silent pushes, merges cloud data with unsynced local changes, and keeps local-only groups.
  - Only group metadata and membership tokens sync; card content never leaves the device.
- Caching & conflicts: `LocalCacheManager` keeps local source of truth; CloudKit merges respect unsynced work.
- Utilities: `DeepLinkManager` and `WebhookManager` support invite links and optional webhook callbacks.

## Data Flows

1. Create/edit card → stored locally (encrypted) → share via P2P or QR → optional Wallet export.
2. Join or issue group → generate Semaphore identity/proof → optionally sync membership via CloudKit for invite discovery.
3. CloudKit sync loop:
   - Start engine, verify account, create custom zone if missing.
   - Subscribe to public membership changes and private/shared DB changes (silent pushes).
   - Fetch records, merge with local cache (keep unsynced local edits), then refresh Semaphore trees.
4. Proximity session: MultipeerConnectivity advertises presence, exchanges payloads, and verifies received proofs before accepting.

## Project Structure

- `airmeishi/AppDelegate.swift`: bootstrap, CloudKit notification handling
- `airmeishi/Models`: cards, groups, credentials, CloudKit models
- `airmeishi/Services/CloudKit`: CloudKitGroupSyncManager + models
- `airmeishi/Services/Sharing`: P2P managers, QR, ShareLink flows
- `airmeishi/Services/Identity`: Semaphore group management and credential issuance
- `airmeishi/Services/Cache`: SwiftData-backed local cache
- `airmeishi/Views`: SwiftUI screens for cards, IDs, groups, settings
- `airmeishi/Assets.xcassets`: app icon and UI assets

## Built With

- SwiftUI - Native iOS interface
- MultipeerConnectivity - Apple's P2P networking
- Semaphore Protocol - Zero-knowledge proofs via [SemaphoreSwift](https://github.com/zkmopro/SemaphoreSwift)
- Mopro - Native proof generation
- PassKit - Apple Wallet integration
- Local Storage - AES-GCM encrypted file system, no remote DB for cards

## Development

### Quick Start

```bash
git clone https://github.com/kidneyweakx/solidarity.git
cd airmeishi
open airmeishi.xcodeproj
```

Dependencies auto-resolve via Swift Package Manager. Press Cmd+R to run.

### Testing

```bash
# Run all tests
xcodebuild test -project airmeishi.xcodeproj -scheme airmeishi \
  -destination 'platform=iOS Simulator,name=iPhone 16'

# Test proximity features (requires 2 simulators or devices)
```

### Dependencies

- [SemaphoreSwift](https://github.com/zkmopro/SemaphoreSwift) - ZK proofs
- [Mopro](https://zkmopro.org/) - Native proof generation
- PassKit, MultipeerConnectivity (Apple frameworks)

---

## License

Apache 2.0 - See [LICENSE](LICENSE)

## Credits

- [Semaphore Protocol](https://semaphore.appliedzkp.org/) - Zero-knowledge proof system
- [Mopro](https://zkmopro.org/) - Mobile ZK proof framework
- Apple MultipeerConnectivity - P2P networking

---

**Solid(ar)ity** - Privacy-first networking for the decentralized web.
