# @solidarity/parity-fixtures

Golden JSON fixtures exported by Swift `FixtureExporter` (added in
`solidarityTests/FixtureExporter.swift`). Consumed by `bun test` parity
suites in `apps/expo/__tests__/parity/` to verify TS↔Swift behavioural
equivalence.

## How it works

```
solidarity/                     ← Swift app
  solidarityTests/
    FixtureExporter.swift       ← XCTest target that captures inputs + outputs
                                  for each service and writes JSON files into:

packages/parity-fixtures/
  fixtures/
    encryption/
      aes_gcm_roundtrip.json    ← { input, key, ciphertext, nonce, tag }
      master_key_derive.json    ← { passphrase, salt, derivedKey }
    identity/
      did_key_derive.json
      jwt_sign_verify.json
      pairwise_descriptor.json
    qr/
      chunking_round_trip.json
      vc_envelope.json
    proximity/
      exchange_signature.json
    sakura/
      send_request_wire.json
      seal_response.json

apps/expo/__tests__/parity/
  encryption.parity.test.ts     ← imports fixture, asserts TS output matches
  identity.parity.test.ts
  ...
```

## Running parity tests

```bash
# Re-export fixtures from Swift (one-time per behavioural change):
xcodebuild test -project solidarity.xcodeproj \
  -scheme solidarity -only-testing solidarityTests/FixtureExporter \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -skipPackagePluginValidation

# Run TS parity assertions:
bun test --preload ./test-setup.ts __tests__/parity
```

CI fails if either side diverges, forcing both implementations to stay
in lockstep.

## What does NOT go here

- ZK proof bytes — proofs include randomness, so byte-exact parity isn't
  meaningful. We assert that the **public inputs** + **verifying key** +
  **verify-returns-true** all match.
- Random-seeded UUIDs — only assert structure, not values.
- Time-sensitive payloads (JWT `iat`/`exp`, signatures over timestamps) —
  use frozen test clock on both sides.
