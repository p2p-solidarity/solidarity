# Passport Proof Performance — Phase 3 (Warm Prover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-call cold-start cost of on-device Noir proving by caching the parsed circuit + verifying key (and, if measured to matter, the barretenberg SRS setup) in the Rust `mopro-binding` layer, exposing an explicit `warmup_circuit`, and wiring warmup calls so the prover is hot before the user taps present — hitting the spec's ≤ 2 s warm-show target.

**Architecture:** Phase 3 spans **two repos** and must land in order:
- **Part A — `~/Workspace/Work/solidarity/passport-noir`** (sibling Rust repo). Add a process-static circuit cache to `mopro-binding/src/noir.rs` so `generate_noir_proof` / `get_noir_verification_key` stop re-reading the circuit JSON and re-deriving the UltraHonk verifying key on every call. Add a `#[uniffi::export] warmup_circuit(...)` that primes that cache and returns its timing. Cut a release → GitHub Actions builds the `MoproBindings.xcframework` + prints the new SPM checksum.
- **Part B — `airmeishi`** (this repo). Bump the passport-noir pin to consume the new binding, add `warmupCircuit` to the `PassportZk` nitro spec, regenerate + implement the Swift/Kotlin Hybrid methods (same alias resolution as `generateNoirProof`), then wire warmup calls: show prefetch warms `openac_show`; the prepare proof run warms `dsc_chain` + `passport_adapter` before proving.

Part B **cannot be built or tested until Part A's release is pinned** (the `warmupCircuit` symbol does not exist in the binding until then). Do Part A end-to-end first.

**Tech Stack:** Rust (`mopro-ffi` 0.3.5 / `noir_rs` v1.0.0-beta.19 / uniffi), Swift + Kotlin (Nitro Modules, nitrogen codegen — generated code committed), Expo RN + TypeScript, bun:test, `cargo test`.

**Conventions that bind every task:**
- passport-noir CLAUDE.md: fail-closed, return `Result`/`MoproError` (never `panic!`/`unwrap` on the FFI path), no PII in logs.
- `apps/expo` CLAUDE.md: Sec paths return `Result`-like / no force-unwrap; no fake data; an `ArrayBuffer` param read inside `Promise.async` is the non-owning-buffer crash (irrelevant here — `warmupCircuit` takes only strings, returns a number).
- Decimal-string witness maps unchanged; circuits/SRS assets unchanged (so the SHA-pinned `passport.srs.bin` asset does **not** change this phase — only the `MoproBindings.xcframework` checksum does).

**Verification baseline:** the repo's bun-test/lint output is historically noisy (≈40 fail / 2 error baseline, per the phase-4 plan). "Tests pass" below means *no NEW failures vs that baseline*; targeted test files must pass outright. The device acceptance numbers (warm show ≤ 2 s) are the real gate and require the user's test device.

---

## Review revisions (2026-06-16, multi-agent audit)

A ground-truth audit against the actual `noir.rs` / nitro / JS code applied these corrections — read them before executing:

- **[BLOCKER, A1 Step 7]** The original in-Rust CRS guard called `load_circuit_json("passport_adapter")` with a **bare alias**; Rust has no alias resolution, so it was a guaranteed silent no-op that *disabled* the only under-sizing protection. Rewritten to **caller-ordered, largest-first warmup** (the shim resolves aliases), gated on a real A0 measurement.
- **[BLOCKER, new Task A3b]** Part A built the **iOS xcframework only**; `warmupCircuit` never entered the Android cdylib/`mopro.kt`, so **B4 won't compile** and B5/B6 would silently revert Android to the cold prover. Added a dedicated Android rebuild + pin + compile-verify task.
- **[A0]** Extended the bench to **measure cross-circuit CRS monotonicity** (the assumption A1 rests on was asserted, never measured); reconciled it with Step 6 so deleting `load_circuit_bytecode` doesn't break `cargo test`; guarded the missing-fixture panic.
- **[A1]** Made the cache lock **poison-resistant** (`into_inner()`) so a C++ FFI panic can't brick every future prove; scoped the poison test's claim.
- **[B6]** Corrected the insertion anchor — `~line 733` lands in **JSX**; the runner is `index.tsx:777–841`, insert before `bindPassportOpenAcV3DeviceSignature` at `:796`.
- **[B4/B5/B6]** Aliased Kotlin import; **warmup telemetry** (`[zk:timing] warmup …` + failure warn) so a silently-cold prover is diagnosable; `extractAsset` concurrency guard note.
- **[B7]** Added the **Android link check** and the spec-mandated **RSS measurement**; flagged that warm-vs-cold correctness has no host CI gate.

**spruce-did sign-gate fix (separate, working-tree):** audited SAFE for ZK — `publicKeyJwk` and `signRawP256` route the same deterministic `copyECPrivateKey([true,false])` resolver, and any divergence fail-*closes* to `device-public-key-mismatch` (never an invalid proof). Tracked separately: it is uncommitted and the JS parity test is tautological — a real key-resolution test is being added.

---

## Why this is the critical lever (grounding)

`mopro-binding/src/noir.rs::generate_noir_proof` (lines 133–158) does, **on every single call**:

1. `load_circuit_bytecode(&circuit_path)` (lines 40–47 → 15–20): `std::fs::read_to_string` + `serde_json::from_str` of the whole circuit JSON.
2. `setup_srs_from_bytecode(&bytecode, srs_path, false)` (line 142): sizes + loads the barretenberg CRS from the 128 MB merged `passport.srs.bin`.
3. `build_witness_map(&circuit_path, inputs)` (lines 53–100): **reads + parses the circuit JSON a second time** for the ABI.
4. `get_ultra_honk_verification_key(&bytecode, false)` (line 149): rebuilds the UltraHonk verifying key from the bytecode — expensive, and **thrown away** after the call.
5. `prove_ultra_honk(...)` (line 154): the only step that genuinely depends on the witness.

The 2026-06-13 device baseline (spec note, lines 168–176) shows prepare ≈ 15 s and show > 10 s, with show running the *smallest* circuit (`openac_show`, < 150 KB ACIR) — so the per-call fixed cost (steps 1–4), not the proof itself, dominates. Phase 3 caches steps 1, 3, 4 unconditionally (safe, witness-independent, zero correctness risk) and conditionally memoizes step 2 (gated on measurement — see Task A0), leaving only step 5 per-call.

---

# Part A — passport-noir (Rust binding cache + `warmup_circuit` + release)

> Working dir for Part A: `~/Workspace/Work/solidarity/passport-noir/mopro-binding`. Commits land in the **passport-noir** repo, not airmeishi.

### Task A0: Measure the second-call delta (decides SRS memoization)

**Files:** Test only — `mopro-binding/src/noir.rs` (add one `#[ignore]` bench test in the existing `tests` module).

The spec assumes the pinned crate does **not** cache internally and that SRS setup is a large repeat cost; this task replaces the assumption with a number that decides whether Task A1 must memoize `setup_srs_from_bytecode` (step 2) on top of the always-safe bytecode/VK cache.

- [ ] **Step 1: Add a cold-vs-warm micro-benchmark**

In `mopro-binding/src/noir.rs`, inside `mod tests`, add (it reuses the existing `circuit_path` / `has_test_vectors` helpers):

```rust
    // PERF-CACHE: isolate the repeat fixed-cost of each pre-prove step so
    // Task A1 knows whether setup_srs must be memoized (vs only bytecode/VK),
    // AND whether barretenberg's global CRS is actually monotonic (the
    // assumption A1 Step 7 rests on). Reads bytecode via load_circuit_json so
    // this bench does NOT depend on the load_circuit_bytecode helper that
    // Step 6 deletes (D2 reconciliation — keeps `cargo test` green after A1).
    #[test]
    #[ignore] // Requires compiled circuits + merged SRS on disk.
    fn bench_repeat_fixed_cost() {
        // has_test_vectors() only checks disclosure.json; this bench loads
        // openac_show.json + passport_adapter.json, so guard those explicitly
        // (D3 — circuit_path() panics on a missing fixture, it never returns Err).
        let bc = |name: &str| -> Option<String> {
            let p = circuit_path(name);
            if !std::path::Path::new(&p).exists() {
                eprintln!("SKIP: {name}.json not found at {p}");
                return None;
            }
            let json = load_circuit_json(&p).expect("circuit json");
            Some(json["bytecode"].as_str().expect("bytecode field").to_string())
        };
        let (Some(small), Some(large)) = (bc("openac_show"), bc("passport_adapter")) else {
            return; // fixtures absent on this machine
        };

        // (1) Repeat fixed-cost: decides Task A1 Step 7 (memoize setup or not).
        let t = std::time::Instant::now();
        noir_rs::barretenberg::srs::setup_srs_from_bytecode(&small, None, false).unwrap();
        println!("PERF-CACHE setup_srs #1: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        noir_rs::barretenberg::srs::setup_srs_from_bytecode(&small, None, false).unwrap();
        println!("PERF-CACHE setup_srs #2: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let _ = noir_rs::barretenberg::verify::get_ultra_honk_verification_key(&small, false).unwrap();
        println!("PERF-CACHE get_vk #1: {:?}", t.elapsed());
        let t = std::time::Instant::now();
        let _ = noir_rs::barretenberg::verify::get_ultra_honk_verification_key(&small, false).unwrap();
        println!("PERF-CACHE get_vk #2: {:?}", t.elapsed());

        // (2) CROSS-CIRCUIT MONOTONICITY — the real gate for the "CRS never
        // shrinks" claim A1 relies on. Size the CRS for the LARGEST circuit,
        // then for the SMALLEST, then prove the LARGEST again: if a small-after-
        // large setup under-sized the global CRS, this prove fails or its proof
        // does not verify. This is the measurement that decides whether the
        // default A1 branch is safe WITHOUT the Step 7 ordering guard.
        noir_rs::barretenberg::srs::setup_srs_from_bytecode(&large, None, false).unwrap();
        noir_rs::barretenberg::srs::setup_srs_from_bytecode(&small, None, false).unwrap();
        if let Some(inputs) = passport_adapter_test_inputs() {
            let path = circuit_path("passport_adapter");
            let proof = generate_noir_proof(path, None, inputs)
                .expect("passport_adapter prove after small-circuit setup");
            let ok = verify_noir_proof(proof.proof, proof.vk).expect("verify");
            println!("PERF-CACHE cross-circuit large-after-small verifies: {ok}");
            assert!(ok, "CRS NOT monotonic: small setup under-sized a large prove");
        } else {
            eprintln!(
                "SKIP cross-circuit prove: no passport_adapter_test_inputs(); \
                 monotonicity UNVERIFIED — do NOT ship the default A1 branch \
                 relying on it until this asserts."
            );
        }
    }
```

> The cross-circuit block uses a `passport_adapter_test_inputs()` helper. If the repo has no such fixture helper, add a minimal one (mirroring `disclosure_test_inputs()`) **or** substitute any two on-device circuits of different ACIR size where the larger has provable inputs (`dsc_chain` is the next-largest). The point that decides A1 is the **assert**, not the exact circuit pair — if you cannot make a real large-after-small prove verify in this bench, the monotonicity claim stays unmeasured and the default A1 branch must not ship.

- [ ] **Step 2: Run it and record the numbers**

```bash
cd ~/Workspace/Work/solidarity/passport-noir/mopro-binding && cargo test bench_repeat_fixed_cost -- --ignored --nocapture
```

Record the four `setup_srs`/`get_vk` lines **and** the cross-circuit assert result. **Decision rule for Task A1:**
- If `setup_srs #2` ≪ `setup_srs #1` (barretenberg's CRS is global/monotonic, second call early-returns) **and** the cross-circuit block prints `verifies: true`: **do NOT memoize setup** — keep `setup_srs_from_bytecode` on the per-call path (zero monotonicity risk) and cache only bytecode + VK. This is the default A1, and Step 7 is unnecessary (delete it).
- If `setup_srs #2` is still large (≳ 1 s): **also memoize setup** — the A1 cold-path cache already does this per circuit. The remaining question is monotonicity (next bullet).
- **If the cross-circuit block does NOT print `verifies: true`** (it asserts, skips, or fails): barretenberg's CRS is **not** proven monotonic. You MUST enforce **largest-circuit-first warmup ordering** (Task A1 Step 7, rewritten — caller-ordered, not the dead in-Rust guard) before shipping. Treat an unmeasured monotonicity as "not monotonic" — do not ship the default branch on an assumption.

`get_vk #1` ≈ `get_vk #2` and both large is the expected, already-decided case: VK is always cached (A1 core).

- [ ] **Step 3: Commit the bench (no behavior change)**

```bash
git add mopro-binding/src/noir.rs
git commit -m "test(noir): micro-bench repeat setup_srs vs get_vk fixed cost"
```

---

### Task A1: Process-static circuit cache (bytecode + parsed JSON + VK)

**Files:** Modify `mopro-binding/src/noir.rs` (imports top of file; `build_witness_map` 53–100; `generate_noir_proof` 133–158; `get_noir_verification_key` 168–182). Test: same file's `tests` module.

- [ ] **Step 1: Write the failing test (cache is robust on the error path)**

This test needs no circuits/SRS — it asserts the new `cached_circuit` helper errors cleanly on a bad path and never poisons the cache. **Scope caveat:** this exercises only the *early file-read* error (before the lock is held across any FFI); it does **not** prove poison-safety of a panic inside `setup_srs`/`get_vk` while the lock is held. That harder case is handled two ways in Step 3 — the lock is taken with `into_inner()` recovery, and (if A0 shows setup is cheap) the FFI can be moved outside the lock. A device/CI follow-up should add a post-load build-failure case (e.g. a circuit JSON with a valid `bytecode` field that barretenberg rejects) and assert the *next* `cached_circuit` call still succeeds for a good circuit. Add to `mod tests`:

```rust
    // CACHE-1: a bad circuit path errors and leaves the cache usable
    // (no Mutex poison, no panic) — second call still errors the same way.
    #[test]
    fn test_cached_circuit_bad_path_does_not_poison() {
        let r1 = cached_circuit("/nonexistent/openac_show.json", None);
        assert!(matches!(r1, Err(MoproError::CircuitError(_))));
        let r2 = cached_circuit("/nonexistent/openac_show.json", None);
        assert!(matches!(r2, Err(MoproError::CircuitError(_))));
    }
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd ~/Workspace/Work/solidarity/passport-noir/mopro-binding && cargo test test_cached_circuit_bad_path_does_not_poison
```

Expected: FAIL to compile — `cached_circuit` is not defined.

- [ ] **Step 3: Add the cache types + helper**

At the top of `noir.rs`, extend the imports:

```rust
use crate::error::MoproError;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::sync::Arc;
```

Immediately after the `NoirProofResult` struct (line 13), add:

```rust
/// One cached circuit. `json` is shared (Arc) so `build_witness_map` reads the
/// ABI without re-parsing the file; `bytecode` and `vk` are cloned per warm
/// call (≤ ~1.4 MB + a few KB — negligible next to proving). Keyed by
/// `circuit_path`: in this binding each circuit maps to exactly one merged SRS,
/// so the key need not include `srs_path`.
#[derive(Clone)]
struct CachedCircuit {
    json: Arc<serde_json::Value>,
    bytecode: String,
    vk: Vec<u8>,
}

fn circuit_cache() -> &'static Mutex<HashMap<String, CachedCircuit>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedCircuit>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Build-or-fetch the cached circuit. The cold path (read+parse JSON once, size
/// + load the barretenberg CRS, derive the UltraHonk VK once) runs under the
/// cache mutex so concurrent first-touches cannot race barretenberg's global
/// CRS or duplicate the expensive setup. The warm path is a HashMap lookup plus
/// cheap clones. Returns `MoproError` (never panics) on any failure, leaving the
/// cache untouched.
fn cached_circuit(
    circuit_path: &str,
    srs_path: Option<&str>,
) -> Result<CachedCircuit, MoproError> {
    // Recover a poisoned lock rather than bricking every future prove of every
    // circuit. The cold build below runs barretenberg C++ FFI under this lock;
    // if it ever panics across the boundary, a `.map_err`-to-error lock would
    // make `cached_circuit` return CircuitError *forever*, process-wide — a
    // strictly worse failure mode than today's no-lock code. `into_inner()`
    // reclaims the guard; the cache map is plain data with no half-written
    // invariant, so reuse after a poison is safe.
    let mut guard = circuit_cache().lock().unwrap_or_else(|e| e.into_inner());

    if let Some(entry) = guard.get(circuit_path) {
        return Ok(entry.clone());
    }

    let json = load_circuit_json(circuit_path)?;
    assert_supported_noir_version(&json)?;
    let bytecode = json["bytecode"]
        .as_str()
        .ok_or_else(|| MoproError::CircuitError("Circuit JSON missing 'bytecode' field".into()))?
        .to_string();

    noir_rs::barretenberg::srs::setup_srs_from_bytecode(&bytecode, srs_path, false)
        .map_err(|e| MoproError::CircuitError(format!("SRS setup failed: {e}")))?;

    let vk = noir_rs::barretenberg::verify::get_ultra_honk_verification_key(&bytecode, false)
        .map_err(|e| MoproError::CircuitError(format!("Failed to get VK: {e}")))?;

    let entry = CachedCircuit {
        json: Arc::new(json),
        bytecode,
        vk,
    };
    guard.insert(circuit_path.to_string(), entry.clone());
    Ok(entry)
}
```

- [ ] **Step 4: Point `build_witness_map` at the parsed JSON (no second file read)**

Replace the signature + first body block of `build_witness_map` (lines 53–61) so it takes the already-parsed `&serde_json::Value` instead of re-reading the file:

```rust
fn build_witness_map(
    json: &serde_json::Value,
    inputs: HashMap<String, Vec<String>>,
) -> Result<WitnessMap<FieldElement>, MoproError> {
    // Extract ABI parameters to determine witness ordering
    let abi = json
        .get("abi")
        .ok_or_else(|| MoproError::InvalidInput("Circuit JSON missing 'abi' field".into()))?;
```

(Delete the old `let json_str = std::fs::read_to_string(circuit_path)…` + `serde_json::from_str` + `assert_supported_noir_version(&json)?` lines 57–61 — the version is already asserted in `cached_circuit`. The rest of the function from `let params = abi…` onward is unchanged.)

- [ ] **Step 5: Rewrite `generate_noir_proof` to use the cache**

Replace the body (lines 139–157) with:

```rust
    let cached = cached_circuit(&circuit_path, srs_path.as_deref())?;

    // Build witness map from named inputs (the only witness-dependent work).
    let witness_map = build_witness_map(&cached.json, inputs)?;

    // Generate proof against the cached bytecode + VK.
    let proof = noir_rs::barretenberg::prove::prove_ultra_honk(
        &cached.bytecode,
        witness_map,
        cached.vk.clone(),
        false,
    )
    .map_err(|e| MoproError::ProofGenerationError(format!("{e}")))?;

    Ok(NoirProofResult {
        proof,
        vk: cached.vk,
    })
```

- [ ] **Step 6: Rewrite `get_noir_verification_key` to use the cache**

Replace its body (lines 173–181) with:

```rust
    Ok(cached_circuit(&circuit_path, srs_path.as_deref())?.vk)
```

**Delete the now-unused `load_circuit_bytecode` helper (lines 40–47).** After A1, nothing calls it: `cached_circuit` inlines `load_circuit_json` + `assert_supported_noir_version` itself, and the Task A0 bench was rewritten to read bytecode via `load_circuit_json` (the D2 reconciliation) precisely so this deletion does not break `cargo test`. This is **not** conditional — `cargo build`/`clippy` *will* warn `dead_code` otherwise, and the only other reference (the A0 bench) no longer uses it. Keep `load_circuit_json` and `assert_supported_noir_version`.

- [ ] **Step 7 (CONDITIONAL — only if Task A0's cross-circuit block did NOT print `verifies: true`): enforce largest-circuit-first warmup ordering**

The A1 cache already memoizes setup per circuit (the cold-path `setup_srs_from_bytecode` only runs on the cold build, skipped on warm hits). The ONLY residual risk is barretenberg's global CRS being shrunk by a later *smaller* circuit's setup, under-sizing a warm prove of a larger circuit. **Task A0 measures exactly this**; act on its result:

- **A0 printed `verifies: true` → DELETE this step.** Monotonicity is proven; the cold-only setup in Step 3 is already correct and any guard is dead weight.

- **A0 did NOT print `verifies: true` (asserted / skipped / unmeasured) → size the largest circuit first, FROM THE CALLER.**

  > ⚠️ **Do NOT replicate the original draft's in-Rust guard** — it called `load_circuit_json("passport_adapter")` with a **bare alias**. The Rust layer has **no alias resolution** (`load_circuit_json` → `std::fs::read_to_string` on the literal string, `noir.rs:16`); the iOS/Android shims resolve `"passport_adapter"` to an absolute path *before* Rust ever sees it. So that read always returns `Err`, the protective `setup_srs` never runs, yet the `OnceLock` was set unconditionally — a **guaranteed no-op that silently disables the only protection** in the exact branch that needs it.

  The fix lives where aliases CAN be resolved — the warmup caller:

  1. **Native/JS warms `passport_adapter` (largest: ≈0.77 MB ACIR vs `dsc_chain` ≈0.66 MB, `openac_show` <0.15 MB) before any smaller circuit.** Add a one-time app-launch prime (e.g. in the show-prefetch bootstrap or a `useEffect` at passport screen mount) that `await`s `zk.warmupCircuit('passport_adapter', PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS)` **before** Task B5 ever warms `openac_show`. In Task B6, when on this branch, `await` the `passport_adapter` warmup *first*, then warm `dsc_chain` — do **not** `Promise.all` them (parallel does not guarantee order).

  2. **Optional Rust diagnostic (not a fix):** to make a future ordering regression *loud* instead of silent, record the byte-length of the first bytecode that sizes the CRS and `eprintln!` a warning (never error) if a later cold setup is for a *smaller* bytecode. This only logs; correctness still depends on the caller ordering in (1).

  ```rust
  // Diagnostic only — the real guarantee is caller-ordered warmup (largest
  // first). Warns if a smaller circuit sizes the CRS after a larger one,
  // which on a non-monotonic barretenberg could under-size a later prove.
  static FIRST_SIZED_LEN: OnceLock<usize> = OnceLock::new();
  // ...inside cached_circuit, right before the cold setup_srs call:
  let len = bytecode.len();
  match FIRST_SIZED_LEN.get() {
      None => { let _ = FIRST_SIZED_LEN.set(len); }
      Some(&first) if len > first => eprintln!(
          "PERF-CACHE WARN: circuit sized CRS ({len}B) larger than the first \
           ({first}B) — ensure largest-first warmup ordering (A1 Step 7)."),
      _ => {}
  }
  ```

> Record in the A1 commit which A0 branch was selected and whether Step 7 was deleted or applied as caller-ordering.

- [ ] **Step 8: Run the error-path test + build**

```bash
cd ~/Workspace/Work/solidarity/passport-noir/mopro-binding && cargo test test_cached_circuit_bad_path_does_not_poison && cargo build
```

Expected: test PASS; `cargo build` clean (fix any dead-code warning per Step 6).

- [ ] **Step 9: Real roundtrip + warm-vs-cold proof (device/CI with vectors)**

Add an `#[ignore]` test that proves the cache is correctness-neutral and warm:

```rust
    // CACHE-2: cold prove then warm prove for the same circuit — identical VK,
    // both verify, warm path is materially faster (no re-read / re-derive).
    #[test]
    #[ignore] // Requires compiled circuits + merged SRS.
    fn test_cache_warm_roundtrip() {
        if !has_test_vectors() {
            return;
        }
        let path = circuit_path("disclosure");
        let inputs = disclosure_test_inputs();

        let t = std::time::Instant::now();
        let cold = generate_noir_proof(path.clone(), None, inputs.clone()).expect("cold");
        let cold_ms = t.elapsed();

        let t = std::time::Instant::now();
        let warm = generate_noir_proof(path, None, inputs).expect("warm");
        let warm_ms = t.elapsed();

        assert_eq!(cold.vk, warm.vk, "cached VK must be byte-identical");
        assert!(verify_noir_proof(warm.proof, warm.vk).expect("verify"), "warm proof verifies");
        println!("CACHE-2 cold={cold_ms:?} warm={warm_ms:?}");
        assert!(warm_ms < cold_ms, "warm prove should beat cold prove");
    }
```

```bash
cargo test test_cache_warm_roundtrip -- --ignored --nocapture
```

Expected (on a machine with vectors): PASS, with `warm` < `cold`. Record the numbers.

- [ ] **Step 10: Commit**

```bash
git add mopro-binding/src/noir.rs
git commit -m "feat(noir): process-static circuit cache (bytecode + parsed JSON + VK)"
```

---

### Task A2: Export `warmup_circuit`

**Files:** Modify `mopro-binding/src/noir.rs` (new fn) and `mopro-binding/src/lib.rs` (line 6–7 re-export).

- [ ] **Step 1: Add the exported function**

In `noir.rs`, after `get_noir_verification_key`, add:

```rust
/// Prime the circuit cache (parse JSON, size the barretenberg CRS, derive the
/// UltraHonk VK) so the next `generate_noir_proof` for this circuit skips the
/// cold-start cost. Returns the warmup duration in milliseconds. Idempotent —
/// a second call for an already-cached circuit returns near-instantly.
#[uniffi::export]
pub fn warmup_circuit(
    circuit_path: String,
    srs_path: Option<String>,
) -> Result<u64, MoproError> {
    let start = std::time::Instant::now();
    cached_circuit(&circuit_path, srs_path.as_deref())?;
    Ok(start.elapsed().as_millis() as u64)
}
```

- [ ] **Step 2: Re-export from `lib.rs`**

Change line 7:

```rust
pub use noir::{generate_noir_proof, get_noir_verification_key, verify_noir_proof, warmup_circuit};
```

- [ ] **Step 3: Build (regenerates the uniffi scaffold symbol)**

```bash
cd ~/Workspace/Work/solidarity/passport-noir/mopro-binding && cargo build
```

Expected: clean. (`#[uniffi::export]` makes `warmupCircuit` appear in the generated Swift/Kotlin bindings during the xcframework/cdylib build.)

- [ ] **Step 4: Commit**

```bash
git add mopro-binding/src/noir.rs mopro-binding/src/lib.rs
git commit -m "feat(noir): export warmup_circuit (primes circuit cache, returns ms)"
```

---

### Task A3: Build the xcframework + cut the release

**Files:** none new — uses passport-noir's `Makefile` / `release.sh` / `.github/workflows/release.yml`.

- [ ] **Step 1: Local sanity build of the iOS bindings**

```bash
cd ~/Workspace/Work/solidarity/passport-noir && make build-ios
```

Expected: regenerates `Sources/MoproiOSBindings/mopro.swift` (now containing `warmupCircuit`) + the `MoproBindings.xcframework`. Confirm the symbol is present:

```bash
grep -n "func warmupCircuit" Sources/MoproiOSBindings/mopro.swift
```

Expected: one match with signature `warmupCircuit(circuitPath: String, srsPath: String?) throws -> UInt64`.

- [ ] **Step 2: Release (auto-version + tag → CI builds + publishes)**

This is a **patch** release (no circuit/SRS change, binding-only):

```bash
cd ~/Workspace/Work/solidarity/passport-noir && make release-patch
git push origin main --tags
```

The `release.yml` workflow compiles circuits → builds the xcframework on macOS → zips + uploads to the GitHub Release and **prints the new `Package.swift` checksum**. Record: the new tag (e.g. `v0.3.3`) and the printed xcframework checksum — Part B needs both.

- [ ] **Step 3: Confirm the release assets**

Verify the GitHub Release for the new tag has the `MoproBindings.xcframework.zip` (+ checksum). The `passport.srs.bin` asset is **unchanged** this release (circuits identical) — Part B's SRS pin does not move.

---

### Task A3b: Rebuild + pin the Android `mopro` cdylib (so `warmupCircuit` exists on Android)

**Files:** passport-noir Android build outputs (`mopro.kt` uniffi bindings + the per-ABI `libmopro_bindings.so`), and wherever airmeishi consumes them (`nitro-modules/passport-zk/android` jniLibs + the committed `uniffi/mopro/mopro.kt`).

> **Why this task exists (review finding — BLOCKER):** A2's `#[uniffi::export] warmup_circuit` only enters the **Android** binding when the Android cdylib + its uniffi `mopro.kt` are rebuilt. A3 (release.yml) builds the **iOS xcframework only**; the original plan hand-waved Android as "consumes the rebuilt cdylib via its own build." It does not — `uniffi.mopro.warmupCircuit` is **absent** from the committed `mopro.kt`/`.so`, so **Task B4 is a hard `unresolved reference` gradle failure**, and even if B4 were commented out, B5/B6 would optional-chain `warmupCircuit?.` to `undefined` on Android and **silently revert to the cold prover** — the exact regression this phase exists to remove, invisible because it never errors. Do this **before** B4.

- [ ] **Step 1: Rebuild the Android cdylib + uniffi bindings for all shipped ABIs**

In passport-noir, run the Android binding build (the `Makefile`/`mopro` target that cross-compiles `mopro-binding` for `arm64-v8a` + `x86_64` and regenerates the uniffi Kotlin):

```bash
cd ~/Workspace/Work/solidarity/passport-noir && make build-android   # or the project's mopro android task
grep -n "fun warmupCircuit" <generated>/uniffi/mopro/mopro.kt
```

Expected: one match, `fun warmupCircuit(circuitPath: String, srsPath: String?): ULong` (uniffi maps Rust `u64` → Kotlin `ULong`). Confirm the same release **commit/tag** as A3 so iOS and Android ship the identical `warmup_circuit`.

- [ ] **Step 2: Pin the rebuilt artifacts into airmeishi**

Copy/commit the regenerated `mopro.kt` and the per-ABI `libmopro_bindings.so` into the location `nitro-modules/passport-zk/android` consumes (mirror exactly how the current `.so`/`.kt` got there — read-before-edit; do **not** invent a new path). The Android binding is vendored, not fetched by SPM, so this is a real file commit, not a version bump.

- [ ] **Step 3: Compile-verify Android picks up the symbol**

```bash
cd ~/Workspace/Work/solidarity/airmeishi/apps/expo && bunx expo prebuild --clean --platform android --no-install && ./android/gradlew -p android :app:compileDebugKotlin
```

Expected: `HybridPassportZk.kt`'s `moproWarmupCircuit(...)` (Task B4) resolves and compiles. A `unresolved reference: warmupCircuit` here means Step 1/2 didn't land the new binding.

- [ ] **Step 4: Commit**

```bash
git add nitro-modules/passport-zk/android
git commit -m "chore(android): rebuild + pin mopro cdylib with warmupCircuit (matches <tag>)"
```

> If passport-noir has **no** Android binding build target today (iOS-only repo), that is itself the finding: either add an Android cross-compile to `release.yml` (NDK + `cargo-ndk`), or explicitly scope warmup to **iOS-only this phase** and make B4/B5/B6 degrade *loudly* on Android (a one-time `console.warn('[zk:timing] warmup unavailable on Android (no cdylib)')`) instead of silently cold. Decide and record which — do not leave Android silently cold.

---

# Part B — airmeishi (consume the release: pin bump + spec + Swift/Kotlin + JS wiring)

> Working dir for Part B: `~/Workspace/Work/solidarity/airmeishi`. Do NOT start Part B until Task A3 has published the new tag + checksum.

### Task B1: Bump the passport-noir pin

**Files:** Modify the SPM pin for `MoproBindings` (`apps/expo/ios/*/Package.resolved` after prebuild, and the source pin the iOS workspace prep reads — same place commit `a503701` / `4d7124a` touched). Android consumes the rebuilt cdylib via its own build.

- [ ] **Step 1: Locate the current pin + checksum**

```bash
cd ~/Workspace/Work/solidarity/airmeishi
grep -rn "MoproBindings\|passport-noir\|0.3.2\|MoproBinding" apps/expo/ios apps/expo/plugins ci-scripts 2>/dev/null | grep -iE 'checksum|url|version|tag|\.zip' | head
```

Identify the file holding the version/tag + `checksum:` for the `MoproBindings` binary target.

- [ ] **Step 2: Update tag + checksum to Task A3's release**

Replace the old tag (e.g. `v0.3.2`) and old `checksum:` with the new tag + checksum printed by `release.yml` in Task A3 Step 2. Follow the **seed-first `Package.resolved`** rule from the iOS-CI memory (`ios-ci-srs-and-spm.md`): update the resolved file so SPM does not error with "resolved file required", and ensure the SHA-pinned `passport.srs.bin` asset URL still matches the pin bump (it is unchanged this release, but the seeding step must still reconcile it).

- [ ] **Step 3: Prebuild + resolve to confirm the pin fetches**

```bash
cd apps/expo && bunx expo prebuild --clean --platform ios --no-install
```

Expected: SPM resolves the new `MoproBindings` checksum without a mismatch error. (If checksum mismatch: re-copy the exact string from the release output — a trailing newline/space is the usual culprit.)

- [ ] **Step 4: Commit**

```bash
git add -A apps/expo/ios ci-scripts 2>/dev/null
git commit -m "chore(ci): bump passport-noir MoproBindings pin to <new-tag> (adds warmupCircuit)"
```

---

### Task B2: Add `warmupCircuit` to the nitro spec + regenerate

**Files:** Modify `nitro-modules/passport-zk/src/specs/PassportZk.nitro.ts` (interface, lines 42–77). Run nitrogen in the module; commit generated Swift/Kotlin scaffolding.

- [ ] **Step 1: Extend the spec interface**

In `PassportZk.nitro.ts`, inside `interface PassportZk`, after `verifyNoirProof` (line 63), add:

```ts
  /**
   * Prime the native prover for a circuit: parse the circuit, size the
   * barretenberg CRS, and derive + cache the verifying key so the next
   * `generateNoirProof` for the same circuit skips the cold-start cost.
   * Returns warmup duration in ms. Idempotent (a warm circuit returns ~0).
   * Uses the same circuit/SRS alias resolution as `generateNoirProof`.
   */
  warmupCircuit(
    circuitPath: string,
    srsPath: string | undefined
  ): Promise<number>;
```

Also update the file's top-of-file "Surface to mirror" comment block (lines 8–12; it already omits the real last method `buildOpenAcV3WitnessBundle` at lines 74–76 — inserting the spec method after `verifyNoirProof` at line 63 is still correct) to add:

```
 *   public func warmupCircuit(circuitPath, srsPath?) → UInt64
```

- [ ] **Step 2: Run nitrogen**

```bash
cd ~/Workspace/Work/solidarity/airmeishi/nitro-modules/passport-zk && bun run nitrogen
```

Expected: regenerated `nitrogen/generated/**` adds `warmupCircuit` to the Swift `HybridPassportZkSpec` protocol and the Kotlin `HybridPassportZk` abstract class. The Swift/Kotlin `HybridPassportZk` impls will now fail to compile until Tasks B3/B4 implement the method — expected.

- [ ] **Step 3: Commit the spec + generated scaffolding**

```bash
git add nitro-modules/passport-zk/src/specs/PassportZk.nitro.ts nitro-modules/passport-zk/nitrogen
git commit -m "feat(passport-zk): add warmupCircuit to nitro spec (nitrogen regen)"
```

---

### Task B3: Implement `warmupCircuit` on iOS

**Files:** Modify `nitro-modules/passport-zk/ios/MoproShim.swift` (add a `warmup` pass-through) and `nitro-modules/passport-zk/ios/HybridPassportZk.swift` (add the protocol method, reusing `resolveCircuitPath` / `resolveSrsPath`).

- [ ] **Step 1: Add the MoproShim pass-through**

In `MoproShim.swift`, after `verify` (line 41), add:

```swift
  static func warmup(circuitPath: String, srsPath: String?) throws -> UInt64 {
    return try MoproBindings.warmupCircuit(
      circuitPath: circuitPath,
      srsPath: srsPath
    )
  }
```

- [ ] **Step 2: Add the Hybrid method**

In `HybridPassportZk.swift`, after `verifyNoirProof` (line 60), add — note it reuses the exact alias resolution `generateNoirProof` uses, so JS can pass `'openac_show'` / `'passport'` aliases:

```swift
  func warmupCircuit(
    circuitPath: String,
    srsPath: String?
  ) throws -> Promise<Double> {
    return Promise.async {
      let ms = try MoproShim.warmup(
        circuitPath: try Self.resolveCircuitPath(circuitPath),
        srsPath: try Self.resolveSrsPath(srsPath)
      )
      return Double(ms)
    }
  }
```

(Nitro maps TS `number` → Swift `Double`; the Rust `u64` ms is widened in the shim call.)

- [ ] **Step 3: Typecheck the module's TS surface**

```bash
cd ~/Workspace/Work/solidarity/airmeishi/nitro-modules/passport-zk && bun run typecheck 2>/dev/null || (cd ~/Workspace/Work/solidarity/airmeishi/apps/expo && bun run typecheck)
```

Expected: TS sees `warmupCircuit` on the generated `PassportZk` type (Swift compiles at app build time, not here).

- [ ] **Step 4: Commit**

```bash
cd ~/Workspace/Work/solidarity/airmeishi
git add nitro-modules/passport-zk/ios
git commit -m "feat(passport-zk): implement warmupCircuit on iOS (alias-resolved)"
```

---

### Task B4: Implement `warmupCircuit` on Android

**Files:** Modify `nitro-modules/passport-zk/android/src/main/java/com/margelo/nitro/gg/solidarity/passportzk/HybridPassportZk.kt` (mirror `generateNoirProof`'s alias resolution + `uniffi.mopro` call).

- [ ] **Step 1: Add the Kotlin method**

Open `HybridPassportZk.kt`. After `verifyNoirProof` (line ~126), add a `warmupCircuit` override that mirrors how `generateNoirProof` (line 54) resolves circuit/SRS aliases and calls into `uniffi.mopro`. Use the module's existing alias-resolution + asset-extraction helpers (the same ones `generateNoirProof` uses to turn `"openac_show"` / `"passport"` into on-disk paths) and call `uniffi.mopro.warmupCircuit(resolvedCircuitPath, resolvedSrsPath)`:

Add the aliased import at the top with the other uniffi imports (the file aliases every uniffi fn, e.g. `import uniffi.mopro.generateNoirProof as moproGenerateNoirProof`):

```kotlin
import uniffi.mopro.warmupCircuit as moproWarmupCircuit
```

```kotlin
  override fun warmupCircuit(
    circuitPath: String,
    srsPath: String?,
  ): Promise<Double> {
    return Promise.async {
      val resolvedCircuit = resolveCircuitPath(circuitPath)
      val resolvedSrs = resolveSrsPath(srsPath)
      val ms = moproWarmupCircuit(resolvedCircuit, resolvedSrs)
      ms.toDouble()
    }
  }
```

> Confirmed against the current file: `generateNoirProof` (lines 54–108) resolves aliases via `resolveCircuitPath` / `resolveSrsPath` **verbatim** — use those exact names (the earlier "if the names differ" hedge is resolved; they match). `resolveCircuitPath`/`resolveSrsPath` call `extractAsset` to materialize the on-disk path, so a warmed circuit is byte-identical to the proven one.
>
> ⚠️ **`moproWarmupCircuit` does not exist in the committed Android binding yet** — `uniffi.mopro.warmupCircuit` is produced by Part A's Rust `#[uniffi::export]`, but Part A's release (A3) builds only the **iOS xcframework**. This file will **not compile** (`unresolved reference: warmupCircuit`) until the Android cdylib + `mopro.kt` are rebuilt and committed — see the new **Task A3b** below, which is a hard prerequisite for B4.
>
> ⚠️ **`extractAsset` concurrency:** B5/B6 now warm circuits in parallel with (and ahead of) the prove path, so two coroutines on `Dispatchers.Default` can `extractAsset` the same 128 MB `passport.srs.bin` concurrently (an unsynchronized check-then-write, `HybridPassportZk.kt` ≈:217–240) → a torn file → hard prove failure on cold start. Before wiring parallel warmup, guard `extractAsset` with a per-destination lock (e.g. a `ConcurrentHashMap<String, Any>` monitor keyed by dest path, or write-to-temp-then-atomic-rename). This is a pre-existing latent race that warmup amplifies.

- [ ] **Step 2: Lint/compile-shape check**

```bash
cd ~/Workspace/Work/solidarity/airmeishi/nitro-modules/passport-zk && ls android/src/main/java/com/margelo/nitro/gg/solidarity/passportzk/HybridPassportZk.kt
```

(Full Kotlin compile happens at `./gradlew` app build; here just confirm the override matches the regenerated abstract method signature from Task B2.)

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/Work/solidarity/airmeishi
git add nitro-modules/passport-zk/android
git commit -m "feat(passport-zk): implement warmupCircuit on Android (alias-resolved)"
```

---

### Task B5: Wire warmup into the show prefetch path

**Files:** Modify `apps/expo/src/passport/showPrefetch.ts` (add an injectable warmup + call it). Test: `apps/expo/__tests__/unit/passportShowPrefetch.test.ts`.

- [ ] **Step 1: Write the failing test**

In `passportShowPrefetch.test.ts`, add a test that `prefetchPassportShowPresentation` triggers a warmup of `openac_show` exactly once per credential via an injected warmup fn:

```ts
  it('warms the openac_show circuit once per prefetch', () => {
    clearPassportShowPrefetch();
    const warmed: string[] = [];
    prefetchPassportShowPresentation(
      'cred-warm',
      async () => 'witness-json',
      () => {},
      (circuit) => {
        warmed.push(circuit);
      }
    );
    expect(warmed).toEqual(['openac_show']);
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPrefetch.test.ts
```

Expected: FAIL — `prefetchPassportShowPresentation` takes only 3 args / warmup never fires.

- [ ] **Step 3: Implement the warmup hook in `showPrefetch.ts`**

Update the module doc line 2–3 ("warmupCircuit lands in phase 3") to past tense, and add the default warmup loader + the new optional param. After `defaultLoadModules` (line 26) add:

```ts
function defaultWarmup(circuit: string): void {
  const mod =
    require('@/passport/nitroModules') as typeof import('@/passport/nitroModules');
  const zk = mod.loadPassportNitroModules().zk;
  // Fire-and-forget: warmup is a pure latency optimization; a failure (prover
  // not linked, missing asset, Android cdylib without the symbol) just means
  // the prove path pays the cold cost. But it must be DIAGNOSABLE — a silently
  // cold prover is indistinguishable from the >10 s baseline this phase fixes —
  // so log the resolved ms on success and the reason on failure (never throw).
  void zk
    ?.warmupCircuit(circuit, 'passport')
    ?.then((ms) => console.log(`[zk:timing] warmup ${circuit} ${Math.round(ms)}ms`))
    ?.catch((e: unknown) =>
      console.warn(`[zk:timing] warmup ${circuit} failed:`, e)
    );
}
```

Change the `prefetchPassportShowPresentation` signature + body to take and call the warmup:

```ts
export function prefetchPassportShowPresentation(
  credentialId: string,
  loadWitness: (id: string) => Promise<string | null> = defaultLoadWitness,
  loadModules: () => unknown = defaultLoadModules,
  warmup: (circuit: string) => void = defaultWarmup
): void {
  if (!witnessPrefetch.has(credentialId)) {
    witnessPrefetch.set(
      credentialId,
      loadWitness(credentialId).catch(() => null)
    );
  }
  // Nitro lazy-load is internally idempotent; a failure here surfaces as
  // the real error on the prove path, never silently here.
  try {
    loadModules();
  } catch {
    // prove path reports 'ZK prover is not linked on this build.'
  }
  // Warm the show circuit so tapping present proves against a hot prover.
  try {
    warmup('openac_show');
  } catch {
    // prove path pays the cold cost; never throw from prefetch.
  }
}
```

> `'passport'` is the merged-SRS alias (`PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS`); the Swift/Kotlin `resolveSrsPath` maps it to `passport.srs.bin`. Pass the literal here to keep `showPrefetch.ts` free of the openacV3 import cycle.

- [ ] **Step 4: Run to verify it passes (+ the existing prefetch tests still pass)**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPrefetch.test.ts
```

Expected: PASS (the 3 existing tests + the new warmup test). The existing tests call `prefetchPassportShowPresentation` with ≤3 args, so `warmup` defaults to `defaultWarmup` — which `require()`s nitroModules; in bun that `require` resolves but `zk` is `null`, so `defaultWarmup` no-ops safely. If any existing test environment makes that `require` throw, the `try/catch` swallows it.

> **Two low-severity coverage gaps to close while here (review findings):**
> - **Default-warmup dispatch untested (gap #7):** the injected-fn test never exercises `defaultWarmup`, so a typo in the `'passport'` alias literal or the `require('@/passport/nitroModules')` path ships undetected. Add a `mock.module('@/passport/nitroModules', …)` test asserting `defaultWarmup('openac_show')` calls `zk.warmupCircuit('openac_show', 'passport')` exactly once.
> - **Warmup fires on every prefetch (gap #8):** the `warmup('openac_show')` call sits *outside* the `if (!witnessPrefetch.has(credentialId))` guard, so it re-fires on every prefetch of the same credential. Harmless (native warmup is idempotent ~0 ms) but it diverges from the once-per-credential witness semantics — either move it inside the guard or assert the repeat-call-is-cheap contract explicitly so a future non-idempotent warmup can't regress silently.

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/expo && bun run typecheck
git add apps/expo/src/passport/showPrefetch.ts apps/expo/__tests__/unit/passportShowPrefetch.test.ts
git commit -m "feat(passport): warm openac_show on show-sheet prefetch"
```

---

### Task B6: Warm prepare circuits before the proof run

**Files:** Modify `apps/expo/app/passport/index.tsx` (`tryGenerateOpenAcV3Proof`, ~line 733+, the prepare proof runner) to warm `dsc_chain` + `passport_adapter` before proving.

- [ ] **Step 1: Add a fire-and-forget warmup at the start of the prepare proof run**

⚠️ **Anchor correction (review finding):** the original `~line 733+` is **wrong** — line 733 is inside the screen's `<ProofStep>` **JSX**, not the runner. The function `tryGenerateOpenAcV3Proof` is at **`index.tsx:777–841`**, and the bind it must precede, `bindPassportOpenAcV3DeviceSignature`, is at **`index.tsx:796`**. Insert the warmup **inside that function, immediately before the call at `:796`** — follow this prose anchor, not the tilde-line, and confirm by grepping `bindPassportOpenAcV3DeviceSignature` first.

The proof run drops `openac_show` already (phase-2), so warm exactly the two it proves. Default (A0 proved monotonic) — warm both in parallel so they overlap the Face ID/witness wait:

```ts
      // Phase 3: warm the prepare circuits so the sequential proves below run
      // against a hot prover. Fire-and-forget — a warmup failure just means the
      // first prove pays the cold cost; never block or throw the prepare flow.
      // Logs ms/failure so a silently-cold prover is diagnosable (gap #3).
      void Promise.all([
        zk.warmupCircuit?.('dsc_chain', PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS),
        zk.warmupCircuit?.('passport_adapter', PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS),
      ])
        .then(() => console.log('[zk:timing] warmup prepare circuits done'))
        .catch((e: unknown) =>
          console.warn('[zk:timing] warmup prepare failed:', e)
        );
```

> **If A0 did NOT prove monotonic** (Task A1 Step 7 caller-ordering branch): do **not** `Promise.all` — `await zk.warmupCircuit?.('passport_adapter', …)` **first** (largest circuit sizes the CRS), *then* warm `dsc_chain`. Parallel does not guarantee order, and a small-circuit setup landing first could under-size the CRS on a non-monotonic barretenberg.

Add `PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS` to the existing `@/passport/openacV3` import in `index.tsx` if not already imported (it is the merged-SRS alias the native `resolveSrsPath` maps to `passport.srs.bin`).

> This stays foreground in phase 3 (background prepare is phase 5). Warming while the synchronous witness/sign setup runs means the CRS load + VK derivation overlaps the Face ID wait, so the first real `generateNoirProof('dsc_chain', …)` is warm or near-warm. **Note** the overlap is real only if warmup finishes before Face ID resolves; if it doesn't, the prove blocks briefly on A1's cache mutex (correct, just no speedup) — B7 device numbers are what confirm the actual overlap.

- [ ] **Step 2: Typecheck**

```bash
cd apps/expo && bun run typecheck
```

Expected: 0 errors. (`warmupCircuit?.` optional-chains so older binaries without the symbol — e.g. before the pin lands on a given platform — degrade gracefully.)

- [ ] **Step 3: Commit**

```bash
git add apps/expo/app/passport/index.tsx
git commit -m "feat(passport): warm dsc_chain + passport_adapter before prepare proof run"
```

---

### Task B7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite vs baseline**

```bash
cd apps/expo && bun run typecheck && bun test 2>&1 | tail -10 && bun run lint 2>&1 | tail -5
```

Expected: typecheck 0 errors; test/lint show **no new failures** vs the ≈40-fail/2-error baseline; `passportShowPrefetch.test.ts` passes outright.

- [ ] **Step 2: Build the app with the new binding (BOTH platforms)**

```bash
cd apps/expo && bunx expo prebuild --clean --platform ios --no-install && bun run ios
# Android — must also link the rebuilt cdylib from Task A3b:
cd apps/expo && bunx expo prebuild --clean --platform android --no-install && bun run android
```

Expected: both build + launch; iOS links the `MoproBindings` symbol `warmupCircuit` and Android resolves `uniffi.mopro.warmupCircuit` (no missing-symbol / `unresolved reference` error). If Android was explicitly scoped out in A3b, confirm instead that it logs the one-time `warmup unavailable on Android` warning and proves cold (not silently — gap #3).

- [ ] **Step 3: Device acceptance (user-assisted — the real gate)**

On the test device, record `[zk:timing]` lines (the phase-1 instrumentation is still wired) for:

1. **Warm show** — open the presentation sheet (fires `warmupCircuit('openac_show')`), pick claims, tap present. `stage=generate:openac_show` should be **≤ ~2 s** (spec target), materially lower than the > 10 s baseline.
2. **Prepare** — one enrollment; the first `generate:dsc_chain` should reflect warm/near-warm CRS+VK (overlaps the single Face ID wait), and overall prepare materially below the 15 s baseline.
3. **Warmup log** — confirm the `[zk:timing] warmup …` line resolves with a sane ms (large on first call per circuit, ~0 on a repeat within the session) and that **no `warmup … failed`** warning appears on either platform.
4. **RSS (spec-mandated, was missing)** — the 128 MB CRS is now pinned for the process lifetime with no eviction. Sample peak RSS (Instruments Allocations / `idevicesyslog` jetsam, or `adb shell dumpsys meminfo` on Android) across a warm-show + prepare cycle on the **A12 test device**. If it approaches jetsam pressure, the "defer eviction to the OS" decision (spec Risks) is **not** validated — escalate to the noir_rs mmap-SRS follow-up. Record the number; do not skip it (latency-only acceptance hides the RSS regression this caching can introduce).

> **CI-gate caveat (gap #4):** the warm-vs-cold *correctness* asserts (byte-identical VK, warm verifies, warm < cold) all live in `#[ignore]` device tests (A1 Step 9), and B7 Step 1 only checks "no new failures vs the ~40-fail baseline" — so a **broken warmup merges green**. Where feasible, bundle a tiny `openac_show` fixture so `test_cache_warm_roundtrip` runs **un-ignored** in `cargo test`, giving one host-runnable correctness signal independent of the device.

- [ ] **Step 4: Update plan checkboxes + paste device numbers into the PR**

The warm-show/prepare numbers are the phase-3 acceptance evidence; record them in the PR description and against the spec acceptance table.

---

## Self-review against the spec (§1 "Warm prover" + Phasing item 3)

- **"Cache keyed by (circuitPath, srsPath): parsed circuit + barretenberg setup + SRS handle in a static map"** → Task A1 (`CachedCircuit` static map keyed by circuit_path; parsed JSON + bytecode + VK cached; SRS setup memoized to the cold path, with the A0-gated monotonicity guard for the "barretenberg setup" part). The noir_rs API exposes no reusable "SRS handle" object — caching the *effect* of setup (the loaded global CRS, by skipping repeat setup) is the realizable form. Noted in A0/A1.
- **"SRS access via mmap rather than heap copy"** → this is a noir_rs/barretenberg-internal behavior not controllable from `mopro-binding` without forking noir_rs. Memoizing setup (call once) removes the *repeat* 128 MB cost regardless of mmap; mmap remains an RSS-pressure mitigation (spec Risks table: "measure RSS"). **Deliberately out of scope for phase-3 v1** — surfaced here, not silently dropped. If A3/B7 device RSS shows jetsam pressure, a follow-up noir_rs change is the lever.
- **"New exported fn `warmup_circuit(circuit_path, srs_path)` returning timing"** → Task A2.
- **Nitro `warmupCircuit(circuitPath, srsPath?): Promise<number>` on both platforms, same alias resolution as generateNoirProof** → Tasks B2 (spec), B3 (iOS), B4 (Android).
- **"Lands as a passport-noir release + xcframework/SRS pin bump through existing CI"** → Tasks A3 (release) + B1 (pin bump, seed-first Package.resolved per `ios-ci-srs-and-spm.md`; SRS asset unchanged this release).
- **Phasing item 3 "wire warmup calls"** → Task B5 (show prefetch warms `openac_show`) + Task B6 (prepare run warms `dsc_chain` + `passport_adapter`).
- **"release-on-memory-warning left to mmap/OS; no explicit eviction API in v1"** → no eviction API added; the static cache holds ≤3 small entries (bytecode+VK), the 128 MB is barretenberg's CRS (OS-managed). Consistent.

## Out of scope (later phases)

- Phase 5: background prepare lifecycle (the prepare warmup in B6 stays foreground here).
- Phase 6: time-bucket pre-prove + envelope v2 (the show warmup in B5 enables the pre-prove, but the bucket cache + envelope change are phase 6).
- noir_rs-level mmap SRS (risk mitigation; only if device RSS shows pressure).
- Android CryptoObject BiometricPrompt for existing auth-bound keys (pre-existing, tracked from phase 4).
</content>
</invoke>
