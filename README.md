<div align="center">
<h1>Solid(ar)ity</h1>
<p>A privacy-preserving, proximity-based business card sharing app built with zero-knowledge proofs, CloudKit-backed group sync, and P2P networking.</p>

<img src="./solidarity/Assets.xcassets/AppIcon.appiconset/1024.png" width="50%" height="50%"></img>

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

- `solidarity/AppDelegate.swift`: bootstrap, CloudKit notification handling
- `solidarity/Models`: cards, groups, credentials, CloudKit models
- `solidarity/Services/CloudKit`: CloudKitGroupSyncManager + models
- `solidarity/Services/Sharing`: P2P managers, QR, ShareLink flows
- `solidarity/Services/Identity`: Semaphore group management and credential issuance
- `solidarity/Services/Cache`: SwiftData-backed local cache
- `solidarity/Views`: SwiftUI screens for cards, IDs, groups, settings
- `solidarity/Assets.xcassets`: app icon and UI assets

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
cd solidarity
open solidarity.xcodeproj
```

Dependencies auto-resolve via Swift Package Manager. Press Cmd+R to run.

### Testing

```bash
# Run all tests
xcodebuild test -project solidarity.xcodeproj -scheme solidarity \
  -destination 'platform=iOS Simulator,name=iPhone 17'

# Test proximity features (requires 2 simulators or devices)
```

### Mutation Testing (Muter)

```bash
# Install muter (one-time)
brew install muter-mutation-testing/formulae/muter

# Optional: if Homebrew build crashes, install latest from source
# git clone https://github.com/muter-mutation-testing/muter.git && cd muter && make install prefix=$(brew --prefix)

# Run mutation testing with project defaults
./scripts/run_muter.sh

# Run mutation testing only for one file (faster feedback)
./scripts/run_muter.sh --files-to-mutate solidarity/Services/Utils/KeyManager.swift
```

Muter config is versioned in `muter.conf.yml`.
By default it runs `solidarityTests` (unit tests only) to keep mutation runs deterministic.
If mutation testing stops at baseline, run `xcodebuild test -project solidarity.xcodeproj -scheme solidarity -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:solidarityTests` first and fix any failing tests.

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
