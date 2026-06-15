# Passport Proof Performance — Phases 1+2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the passport proof pipeline with real stage timings, then remove the avoidable work from prepare/show (drop the enrollment `openac_show` prove+verify, dev-flag the show self-verify, prefetch on sheet open) and replace the fake progress overlay with real milestones — all per spec `docs/superpowers/specs/2026-06-13-passport-proof-performance-design.md` (phases 1–2; phases 3–6 get their own plans).

**Architecture:** All changes live in `apps/expo` (pure TS + one screen + one component). Timing is a tiny injectable-clock module that decorates the existing `PassportOpenAcV3Prover`/`PassportOpenAcV3DeviceSigner` interfaces, so the pure proof modules stay pure. The enrollment payload drops its `phases.show` slot; the vk self-pin moves to `getNoirVerificationKey` (fire-and-forget at persist). The overlay becomes a dumb event-driven component fed by a new explicit `proofOverlayStage` reducer field.

**Tech Stack:** Expo RN + TypeScript, bun:test, Nitro module `@solidarity/nitro-passport-zk` (JS surface only — no native changes in this plan).

**Conventions that bind every task (from `apps/expo/CLAUDE.md`):** no force-unwrap-style assumptions in sec paths, no fake data (rule 8), `ThemedText`/`Colors` only in UI, decimal-string witness maps, read-before-edit.

**Verification baseline:** the repo's bun-test/lint output is historically noisy. Task 0 records the baseline; every later "tests pass" step means *no NEW failures vs that baseline* (targeted test files must pass outright).

---

### Task 0: Record test/typecheck baseline

**Files:** none (read-only)

- [x] **Step 1: Record baseline**

```bash
cd apps/expo && bun run typecheck 2>&1 | tail -5; bun test 2>&1 | tail -10
```

Save the pass/fail counts. All later full-suite runs are compared against this.

---

### Task 1: Proof stage timing module

**Files:**
- Create: `apps/expo/src/passport/proofTiming.ts`
- Test: `apps/expo/__tests__/unit/proofTiming.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';

import {
  createProofStageTimer,
  withTimedProver,
  withTimedSigner,
} from '../../src/passport/proofTiming';
import type { PassportOpenAcV3Prover } from '../../src/passport/openacV3';

function fakeClock(ticks: readonly number[]): () => number {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)] ?? 0;
}

describe('createProofStageTimer', () => {
  it('logs delta since previous mark and reports total', () => {
    const lines: string[] = [];
    // now() call order: construct(0), mark(120), mark(150), totalMs(150)
    const timer = createProofStageTimer(
      'show',
      (l) => lines.push(l),
      fakeClock([0, 120, 150, 150])
    );
    expect(timer.mark('witness-load')).toBe(120);
    expect(timer.mark('sign')).toBe(30);
    expect(timer.totalMs()).toBe(150);
    expect(lines).toEqual([
      '[zk:timing] flow=show stage=witness-load ms=120',
      '[zk:timing] flow=show stage=sign ms=30',
    ]);
  });
});

describe('withTimedProver', () => {
  it('marks generate:<circuit> and verify:<circuit> and passes results through', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer(
      'prepare',
      (l) => lines.push(l),
      fakeClock([0, 10, 25])
    );
    const proof = new ArrayBuffer(2);
    const vk = new ArrayBuffer(3);
    const inner: PassportOpenAcV3Prover = {
      generateNoirProof: async () => ({ proof, vk }),
      verifyNoirProof: async () => true,
    };
    const timed = withTimedProver(inner, timer);
    const result = await timed.generateNoirProof('dsc_chain', 'passport', '{}');
    expect(result.proof).toBe(proof);
    expect(await timed.verifyNoirProof(proof, vk)).toBe(true);
    expect(lines).toEqual([
      '[zk:timing] flow=prepare stage=generate:dsc_chain ms=10',
      '[zk:timing] flow=prepare stage=verify:dsc_chain ms=15',
    ]);
  });

  it('still marks when the inner prover throws', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer('prepare', (l) => lines.push(l), fakeClock([0, 5]));
    const inner: PassportOpenAcV3Prover = {
      generateNoirProof: async () => {
        throw new Error('boom');
      },
      verifyNoirProof: async () => true,
    };
    const timed = withTimedProver(inner, timer);
    await expect(timed.generateNoirProof('openac_show', 'passport', '{}')).rejects.toThrow('boom');
    expect(lines).toEqual(['[zk:timing] flow=prepare stage=generate:openac_show ms=5']);
  });
});

describe('withTimedSigner', () => {
  it('marks sign (Face ID wait inclusive) and passes the result through', async () => {
    const lines: string[] = [];
    const timer = createProofStageTimer('show', (l) => lines.push(l), fakeClock([0, 900]));
    const signature = new Uint8Array(64);
    const publicKeyRaw = new Uint8Array(64);
    const timed = withTimedSigner(async () => ({ signature, publicKeyRaw }), timer);
    const out = await timed(new Uint8Array(32));
    expect(out.signature).toBe(signature);
    expect(lines).toEqual(['[zk:timing] flow=show stage=sign ms=900']);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/proofTiming.test.ts
```

Expected: FAIL — cannot resolve `../../src/passport/proofTiming`.

- [x] **Step 3: Write the implementation**

```ts
/**
 * Proof-pipeline stage timing (spec §0 “Instrumentation first”,
 * docs/superpowers/specs/2026-06-13-passport-proof-performance-design.md).
 *
 * Decorators around the existing prover/signer interfaces so the pure
 * proof modules stay pure. Log lines are operational only (flow, stage,
 * ms) — no witness/identifier content, safe for release builds.
 */
import type {
  PassportOpenAcV3DeviceSigner,
  PassportOpenAcV3Prover,
} from '@/passport/openacV3';

export type ProofTimingFlow = 'prepare' | 'show';

export interface ProofStageTimer {
  /** Log + return ms elapsed since the previous mark (or construction). */
  mark(stage: string): number;
  /** Ms since construction. */
  totalMs(): number;
}

export function createProofStageTimer(
  flow: ProofTimingFlow,
  log: (line: string) => void = console.log,
  now: () => number = Date.now
): ProofStageTimer {
  const startedAt = now();
  let last = startedAt;
  return {
    mark(stage) {
      const t = now();
      const ms = t - last;
      last = t;
      log(`[zk:timing] flow=${flow} stage=${stage} ms=${String(ms)}`);
      return ms;
    },
    totalMs() {
      return now() - startedAt;
    },
  };
}

/**
 * Times each generate/verify native call. `verifyNoirProof` has no circuit
 * parameter, so the wrapper remembers the last generated circuit — calls
 * are sequential on both pipelines, so the pairing is exact.
 */
export function withTimedProver(
  prover: PassportOpenAcV3Prover,
  timer: ProofStageTimer
): PassportOpenAcV3Prover {
  let lastCircuit = 'unknown';
  return {
    async generateNoirProof(circuitPath, srsPath, inputsJson) {
      lastCircuit = circuitPath;
      try {
        return await prover.generateNoirProof(circuitPath, srsPath, inputsJson);
      } finally {
        timer.mark(`generate:${circuitPath}`);
      }
    },
    async verifyNoirProof(proof, vk) {
      try {
        return await prover.verifyNoirProof(proof, vk);
      } finally {
        timer.mark(`verify:${lastCircuit}`);
      }
    },
  };
}

/** Times the device-binding signature, Face ID wait inclusive. */
export function withTimedSigner(
  sign: PassportOpenAcV3DeviceSigner,
  timer: ProofStageTimer
): PassportOpenAcV3DeviceSigner {
  return async (nonceHash) => {
    try {
      return await sign(nonceHash);
    } finally {
      timer.mark('sign');
    }
  };
}
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd apps/expo && bun test __tests__/unit/proofTiming.test.ts
```

Expected: PASS (4 tests).

- [x] **Step 5: Typecheck + commit**

```bash
cd apps/expo && bun run typecheck
git add apps/expo/src/passport/proofTiming.ts apps/expo/__tests__/unit/proofTiming.test.ts
git commit -m "feat(passport): add proof stage timing decorators"
```

---

### Task 2: Wire timing into the show path

**Files:**
- Modify: `apps/expo/src/passport/useShowPresentation.ts` (the `prove` callback, lines 94–145)

- [x] **Step 1: Add imports**

In `useShowPresentation.ts`, after the existing imports add:

```ts
import {
  createProofStageTimer,
  withTimedProver,
  withTimedSigner,
} from '@/passport/proofTiming';
```

- [x] **Step 2: Instrument the prove body**

Replace the `void (async () => { try { … } …})()` body of `prove` with (changed lines marked):

```ts
      void (async () => {
        const timer = createProofStageTimer('show');                       // NEW
        try {
          const witnessBundleJson = await loadPassportShowWitness(
            args.credentialId
          );
          timer.mark('witness-load');                                       // NEW
          if (witnessBundleJson === null) {
            throw new Error(
              'No show witness stored for this credential — re-scan the passport once to enable fresh presentations.'
            );
          }
          const zk = loadPassportNitroModules().zk;
          timer.mark('nitro-load');                                         // NEW
          if (zk === null) {
            throw new Error('ZK prover is not linked on this build.');
          }
          setState({
            phase: 'proving',
            message: 'Generating fresh presentation proof…',
          });
          const showClaims = filterPassportShowPresentationClaims(args.selectedClaims);
          const { envelopeJson } = await generatePassportShowPresentation({
            witnessBundleJson,
            nonceHash,
            today: utcToday(),
            disclosure: disclosureFromClaims(showClaims),
            freshness,
            holderDid: args.holderDid,
            selectedClaims: passportShowSelectedClaimTypes(showClaims),
            signDeviceDigest: withTimedSigner(signOpenAcDeviceBindingDigest, timer), // CHANGED
            prover: withTimedProver(zk, timer),                             // CHANGED
            encodeProofBytes: arrayBufferToBase64,
          });
          const payload = compressForQR(utf8ToBytes(envelopeJson)) ?? envelopeJson;
          const pages = buildPresentationQrPages(payload);                  // CHANGED (hoisted)
          timer.mark('compress+qr-pages');                                  // NEW
          console.log(
            `[zk:timing] flow=show stage=total ms=${String(timer.totalMs())}` // NEW
          );
          setState({
            phase: 'ready',
            pages,                                                          // CHANGED
            freshness,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ phase: 'error', message });
        } finally {
          proving.current = false;
        }
      })();
```

- [x] **Step 3: Typecheck + targeted tests**

```bash
cd apps/expo && bun run typecheck && bun test __tests__/unit/passportShowPresentation.test.ts
```

Expected: typecheck 0 errors; existing show tests unchanged/PASS (the hook itself has no unit test — decorators are tested in Task 1).

- [x] **Step 4: Commit**

```bash
git add apps/expo/src/passport/useShowPresentation.ts
git commit -m "feat(passport): time show-path stages (witness, nitro, sign, prove, qr)"
```

---

### Task 3: Wire timing into the prepare path

**Files:**
- Modify: `apps/expo/app/passport/index.tsx` (`onGenerateProof` ~line 399, `tryGenerateOpenAcV3Proof` ~line 733)

- [x] **Step 1: Add imports**

In `app/passport/index.tsx` add to the existing `@/passport/…` import block:

```ts
import {
  createProofStageTimer,
  withTimedProver,
  withTimedSigner,
  type ProofStageTimer,
} from '@/passport/proofTiming';
```

- [x] **Step 2: Create the timer in `onGenerateProof` and mark witness resolution**

Right after `dispatch({ type: 'setProofProgress', message: 'Initializing prover...' });` (line ~413) add:

```ts
      const timer = createProofStageTimer('prepare');
```

After the `const witnessBundleJson = … : proofChip.openAcV3WitnessBundleJson;` statement (line ~430) add:

```ts
      timer.mark('witness-resolve');
```

Pass the timer to the generator: change the call

```ts
          ? await tryGenerateOpenAcV3Proof(
              nitro.zk,
              proofPlan,
              witnessBundleJson,
              timer,
              (m) => {
                dispatch({ type: 'setProofProgress', message: m });
              },
            )
```

- [x] **Step 3: Accept + use the timer in `tryGenerateOpenAcV3Proof`**

Change the signature:

```ts
async function tryGenerateOpenAcV3Proof(
  zk: NonNullable<ReturnType<typeof getPassportZk>>,
  plan: Extract<PassportOpenAcV3ProofPlan, { kind: 'openac-v3' }>,
  witnessBundleJson: string | undefined,
  timer: ProofStageTimer,
  setProgress: (message: string) => void,
): Promise<{ proofPayload: string } | null> {
```

Wrap the signer (line ~751):

```ts
  const deviceBound = await bindPassportOpenAcV3DeviceSignature(
    witnessBundle,
    withTimedSigner(signOpenAcDeviceBindingDigest, timer)
  );
```

Wrap the prover (line ~765–768):

```ts
    const generated = await generatePassportOpenAcV3ProofPayload({
      plan,
      witnesses: deviceBound.witnesses,
      prover: withTimedProver(zk, timer),
      encodeProofBytes: arrayBufferToBase64,
```

The existing `[zk] OpenAC v3 proof bundle ok in {ms}ms` log (line ~780) stays — it is the prepare `total`.

- [x] **Step 4: Typecheck + commit**

```bash
cd apps/expo && bun run typecheck
git add apps/expo/app/passport/index.tsx
git commit -m "feat(passport): time prepare-path stages (witness, sign, per-circuit prove/verify)"
```

- [ ] **Step 5: Manual baseline checkpoint (real device — needs the user)**

Run the app on the test device, complete one passport prepare and one show, and record every `[zk:timing]` line in the PR/notes. This is the spec's acceptance baseline; later tasks/phases compare against it. Do not block subsequent tasks on this — flag it to the user and continue.

---

### Task 4: Drop `openac_show` from the prepare proof run

**Files:**
- Modify: `apps/expo/src/passport/openacV3.ts` (`buildPassportOpenAcV3ProofCalls` line 428, `generatePassportOpenAcV3ProofPayload` line 648)
- Test: `apps/expo/__tests__/unit/passportOpenAcV3.test.ts`
- Check: `apps/expo/__tests__/parity/passportProof.parity.test.ts` (update counts if it asserts the payload shape)

- [x] **Step 1: Update the unit test to the new contract (failing first)**

In `passportOpenAcV3.test.ts`, find the test(s) covering `buildPassportOpenAcV3ProofCalls` and `generatePassportOpenAcV3ProofPayload`. Update expectations:

- `buildPassportOpenAcV3ProofCalls(plan, witnesses)` returns **2** calls — `dsc_chain`, `passport_adapter` — in that order; no `openac_show` call.
- `generatePassportOpenAcV3ProofPayload` resolves with `proofs.length === 2`, payload JSON `phases` equal to `{ prepare: { dscChain, passportAdapter } }` with **no `show` key** (`'show' in phases === false`), and `onProgress` fired for exactly 2 circuits × 2 phases.

Keep the witness-bundle fixtures (all three input JSONs) — the bundle shape is unchanged; only the proof run shrinks.

- [x] **Step 2: Run to verify the updated tests fail**

```bash
cd apps/expo && bun test __tests__/unit/passportOpenAcV3.test.ts
```

Expected: FAIL on the updated assertions (still 3 proofs / `phases.show` present).

- [x] **Step 3: Implement**

In `openacV3.ts`:

`buildPassportOpenAcV3ProofCalls` (line 428) — filter the show circuit out of the prepare run:

```ts
export function buildPassportOpenAcV3ProofCalls(
  plan: Extract<PassportOpenAcV3ProofPlan, { kind: 'openac-v3' }>,
  witnesses: PassportOpenAcV3WitnessBundle
): readonly PassportOpenAcV3ProofCall[] {
  const witnessByCircuit = {
    dsc_chain: witnesses.dscChainInputsJson,
    passport_adapter: witnesses.passportAdapterInputsJson,
    openac_show: witnesses.openAcShowInputsJson,
  } satisfies Record<PassportOpenAcV3CircuitName, string>;

  // `openac_show` is proven FRESH per presentation (show-presentation spec);
  // proving it at enrollment was dead weight — the show flow never replays it.
  return plan.circuits
    .filter((circuit) => circuit.name !== 'openac_show')
    .map((circuit) => ({
      circuit,
      inputsJson: witnessByCircuit[circuit.name],
    }));
}
```

`generatePassportOpenAcV3ProofPayload` (line 648) — drop the show slot:

```ts
  const dscChain = findEncodedProof(proofs, 'dsc_chain');
  const passportAdapter = findEncodedProof(proofs, 'passport_adapter');

  return {
    proofPayload: JSON.stringify({
      proofType: PASSPORT_V3_PROOF_TYPE,
      passportNoirVersion: PASSPORT_NOIR_VERSION,
      proofs,
      phases: {
        prepare: {
          dscChain,
          passportAdapter,
        },
      },
    }),
    proofs,
  };
```

(`findEncodedProof(proofs, 'openac_show')` call is deleted; the helper itself stays for the two remaining uses.)

- [x] **Step 4: Run unit + parity tests**

```bash
cd apps/expo && bun test __tests__/unit/passportOpenAcV3.test.ts __tests__/parity/passportProof.parity.test.ts
```

Expected: unit PASS. If the parity test asserts 3 proofs / a `phases.show` slot, update its fixture/assertions the same way (2 proofs, prepare-only phases) and re-run to PASS.

- [x] **Step 5: Sweep for `phases.show` consumers**

```bash
grep -rn "phases\.show\|openAcShow" apps/expo/src apps/expo/app packages --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v InputsJson
```

Expected remaining hits: only `extractPassportShowVkSha256FromProofPayload` in `showPresentation.ts` (removed in Task 5) and witness-bundle `openAcShowInputsJson` plumbing (unchanged, still needed). Anything else: stop and re-assess before proceeding.

- [x] **Step 6: Typecheck + commit**

```bash
cd apps/expo && bun run typecheck
git add -A apps/expo
git commit -m "feat(passport): drop openac_show from enrollment proof run (show proves fresh)"
```

---

### Task 5: vk self-pin via `getNoirVerificationKey`

**Files:**
- Modify: `apps/expo/src/passport/showPresentation.ts` (replace `extractPassportShowVkSha256FromProofPayload`, line 246)
- Modify: `apps/expo/app/passport/index.tsx` (persist block, line ~585)
- Test: `apps/expo/__tests__/unit/passportShowPresentation.test.ts`

- [x] **Step 1: Write the failing test**

In `passportShowPresentation.test.ts` add (and DELETE any existing tests of `extractPassportShowVkSha256FromProofPayload` in the same file — the function is removed this task):

```ts
import { computePassportShowVkSha256 } from '../../src/passport/showPresentation';
import { bytesToHex, sha256Bytes } from '@solidarity/shared';

describe('computePassportShowVkSha256', () => {
  it('hashes the vk produced by getNoirVerificationKey for openac_show + merged SRS', async () => {
    const vkBytes = new Uint8Array([1, 2, 3, 4]);
    const calls: Array<readonly [string, string | undefined]> = [];
    const pin = await computePassportShowVkSha256({
      getNoirVerificationKey: async (circuitPath, srsPath) => {
        calls.push([circuitPath, srsPath]);
        return vkBytes.buffer.slice(0) as ArrayBuffer;
      },
    });
    expect(calls).toEqual([['openac_show', 'passport']]);
    expect(pin).toBe(bytesToHex(sha256Bytes(vkBytes)));
  });

  it('returns null when the native call fails (never throws on the persist path)', async () => {
    const pin = await computePassportShowVkSha256({
      getNoirVerificationKey: async () => {
        throw new Error('not linked');
      },
    });
    expect(pin).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPresentation.test.ts
```

Expected: FAIL — `computePassportShowVkSha256` is not exported.

- [x] **Step 3: Implement in `showPresentation.ts`**

Replace the whole `extractPassportShowVkSha256FromProofPayload` function (line 246–) with:

```ts
/**
 * Verifier self-pin source. Same circuit + SRS ⇒ same vk, so deriving the
 * vk locally pins the same value the old enrollment payload carried —
 * without paying a full openac_show prove+verify at enrollment.
 */
export interface PassportShowVkSource {
  getNoirVerificationKey(
    circuitPath: string,
    srsPath: string | undefined
  ): Promise<ArrayBuffer>;
}

export async function computePassportShowVkSha256(
  zk: PassportShowVkSource
): Promise<string | null> {
  try {
    const vk = await zk.getNoirVerificationKey(
      'openac_show',
      PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS
    );
    return bytesToHex(sha256Bytes(new Uint8Array(vk)));
  } catch {
    return null;
  }
}
```

(`bytesToHex`, `sha256Bytes`, `base64Decode` imports: drop `base64Decode` only if now unused — check other usages in the file first.)

- [x] **Step 4: Rewire persist in `app/passport/index.tsx`**

Update imports: remove `extractPassportShowVkSha256FromProofPayload`, add `computePassportShowVkSha256` (from `@/passport/showPresentation`) and `loadPassportShowVkSelfPin` (from `@/passport/showWitnessVault`).

Replace the persist block (line ~582–591) with:

```ts
      if (proof.proofType === PASSPORT_V3_PROOF_TYPE && chip.openAcV3WitnessBundleJson) {
        try {
          await savePassportShowWitness(cardId, chip.openAcV3WitnessBundleJson);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[zk] show-witness vault save failed — ${message}`);
        }
        // Self-pin derivation pays a cold circuit setup pre-warm-prover, so
        // it must NOT block the save UX. Fire-and-forget: the pin is only
        // needed before this device first VERIFIES someone else's show
        // presentation, and the verifier fails closed without it.
        if (nitro.zk && loadPassportShowVkSelfPin() === null) {
          const zkForPin = nitro.zk;
          void computePassportShowVkSha256(zkForPin).then((vkSelfPin) => {
            if (vkSelfPin) savePassportShowVkSelfPin(vkSelfPin);
            else console.warn('[zk] show vk self-pin derivation failed');
          });
        }
      }
```

- [x] **Step 5: Run tests + typecheck**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPresentation.test.ts && bun run typecheck
```

Expected: PASS, 0 type errors (typecheck also catches any other `extractPassportShowVkSha256FromProofPayload` import left behind — fix any it reports).

- [x] **Step 6: Commit**

```bash
git add -A apps/expo
git commit -m "feat(passport): derive show vk self-pin via getNoirVerificationKey"
```

---

### Task 6: `passportSave` Face ID gate at persist

**Files:**
- Modify: `apps/expo/app/passport/index.tsx` (`onPersist`, line ~494)

- [x] **Step 1: Wire the gate**

Add `requireBiometric` to the existing `@/keychain` import (it is re-exported there). At the top of `onPersist`, immediately after the completeness guard:

```ts
    if (!state.draft || !state.chip || !state.proof) {
      pushToast('Passport flow not complete', 'warning');
      return;
    }
    // CLAUDE.md Sec rule: Face ID is required for passport save. Prepare no
    // longer signs (openac_show left the enrollment run), so this is the
    // single enrollment prompt.
    const authorized = await requireBiometric('passportSave');
    if (!authorized) {
      pushToast('Face ID is required to save your passport credential.', 'warning');
      return;
    }
    dispatch({ type: 'setLoading', value: true });
```

- [x] **Step 2: Typecheck + commit**

```bash
cd apps/expo && bun run typecheck
git add apps/expo/app/passport/index.tsx
git commit -m "feat(passport): gate passport save behind Face ID (passportSave reason)"
```

- [ ] **Step 3: Manual check note**

Device verification (with Task 11): exactly ONE prompt during enrollment (at save), none during proof generation.

---

### Task 7: Show self-verify behind a dev flag

**Files:**
- Modify: `apps/expo/src/passport/showPresentation.ts` (`GeneratePassportShowPresentationArgs` + `generatePassportShowPresentation`)
- Modify: `apps/expo/src/passport/useShowPresentation.ts` (pass the flag)
- Test: `apps/expo/__tests__/unit/passportShowPresentation.test.ts`

- [x] **Step 1: Write the failing test**

In the existing `generatePassportShowPresentation` test block (it already has a stub prover fixture — reuse it), add:

```ts
  it('skips the on-device self-verify when selfVerify is false', async () => {
    let verifyCalls = 0;
    // Clone the existing happy-path args/fixtures used by the other
    // generatePassportShowPresentation tests; override the prover:
    const result = await generatePassportShowPresentation({
      ...happyPathArgs,
      selfVerify: false,
      prover: {
        generateNoirProof: happyPathArgs.prover.generateNoirProof,
        verifyNoirProof: async () => {
          verifyCalls += 1;
          return true;
        },
      },
    });
    expect(result.envelopeJson.length).toBeGreaterThan(0);
    expect(verifyCalls).toBe(0);
  });
```

(`happyPathArgs` = whatever fixture name the existing passing test uses; extract it to a shared const in the test file if it is currently inlined.)

- [x] **Step 2: Run to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPresentation.test.ts
```

Expected: FAIL — `selfVerify` is not a known property (TS) / verify still called.

- [x] **Step 3: Implement**

In `GeneratePassportShowPresentationArgs` add:

```ts
  /**
   * On-device sanity verify after proving. Defaults ON; the show hook passes
   * `__DEV__` so release builds skip it — the verifier device verifies for
   * real, and the self-check roughly doubled show's native cost (spec §3).
   */
  readonly selfVerify?: boolean;
```

In `generatePassportShowPresentation`, wrap the verify (current lines 316–319):

```ts
  if (args.selfVerify ?? true) {
    const verified = await args.prover.verifyNoirProof(proof.proof, proof.vk);
    if (!verified) {
      throw new Error('openac_show presentation proof did not verify');
    }
  }
```

In `useShowPresentation.ts`, add to the `generatePassportShowPresentation({ … })` args:

```ts
            selfVerify: typeof __DEV__ !== 'undefined' ? __DEV__ : true,
```

- [x] **Step 4: Run tests + typecheck, then commit**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPresentation.test.ts && bun run typecheck
git add -A apps/expo
git commit -m "feat(passport): dev-flag the show self-verify"
```

---

### Task 8: Prefetch witness + nitro on sheet open

**Files:**
- Create: `apps/expo/src/passport/showPrefetch.ts`
- Modify: `apps/expo/src/passport/useShowPresentation.ts` (consume prefetch)
- Modify: `apps/expo/src/components/credentials/PassportShowPresentation.tsx` (trigger/clear)
- Modify: `apps/expo/src/credentials/store.ts` (clear on credential delete, line ~192)
- Test: `apps/expo/__tests__/unit/passportShowPrefetch.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';

import {
  clearPassportShowPrefetch,
  consumePrefetchedPassportShowWitness,
  prefetchPassportShowPresentation,
} from '../../src/passport/showPrefetch';

describe('passport show prefetch', () => {
  it('starts one witness load per credential and exposes the promise', async () => {
    clearPassportShowPrefetch();
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return 'witness-json';
    };
    let modules = 0;
    prefetchPassportShowPresentation('cred-1', loader, () => {
      modules += 1;
    });
    prefetchPassportShowPresentation('cred-1', loader, () => {
      modules += 1;
    });
    expect(loads).toBe(1);
    expect(modules).toBe(2);
    await expect(consumePrefetchedPassportShowWitness('cred-1')).resolves.toBe('witness-json');
  });

  it('caches a failed load as null (prove path falls back to its own load)', async () => {
    clearPassportShowPrefetch();
    prefetchPassportShowPresentation(
      'cred-2',
      async () => {
        throw new Error('mmkv not ready');
      },
      () => {}
    );
    await expect(consumePrefetchedPassportShowWitness('cred-2')).resolves.toBeNull();
  });

  it('clear removes one credential or everything', async () => {
    clearPassportShowPrefetch();
    prefetchPassportShowPresentation('a', async () => 'wa', () => {});
    prefetchPassportShowPresentation('b', async () => 'wb', () => {});
    clearPassportShowPrefetch('a');
    expect(consumePrefetchedPassportShowWitness('a')).toBeNull();
    await expect(consumePrefetchedPassportShowWitness('b')).resolves.toBe('wb');
    clearPassportShowPrefetch();
    expect(consumePrefetchedPassportShowWitness('b')).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPrefetch.test.ts
```

Expected: FAIL — module does not exist.

- [x] **Step 3: Implement `showPrefetch.ts`**

```ts
/**
 * Presentation-sheet prefetch (spec §3 “Show fast path”, phase-2 slice:
 * witness decrypt + nitro lazy-load only; warmupCircuit lands in phase 3).
 *
 * The witness bundle is immutable per credential, so the sheet can start
 * the MMKV decrypt while the user is still picking claims. The cache holds
 * the in-flight promise — same secret-exposure window as the prove path
 * itself. Cleared when the sheet closes and when the credential is deleted.
 */
import { loadPassportNitroModules } from '@/passport/nitroModules';
import { loadPassportShowWitness } from '@/passport/showWitnessVault';

const witnessPrefetch = new Map<string, Promise<string | null>>();

export function prefetchPassportShowPresentation(
  credentialId: string,
  loadWitness: (id: string) => Promise<string | null> = loadPassportShowWitness,
  loadModules: () => unknown = loadPassportNitroModules
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
}

/** Promise from a prior prefetch, or null when none is cached. */
export function consumePrefetchedPassportShowWitness(
  credentialId: string
): Promise<string | null> | null {
  return witnessPrefetch.get(credentialId) ?? null;
}

export function clearPassportShowPrefetch(credentialId?: string): void {
  if (credentialId === undefined) witnessPrefetch.clear();
  else witnessPrefetch.delete(credentialId);
}
```

- [x] **Step 4: Run to verify it passes**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPrefetch.test.ts
```

Expected: PASS (3 tests).

- [x] **Step 5: Consume in `useShowPresentation.ts`**

Add import:

```ts
import { consumePrefetchedPassportShowWitness } from '@/passport/showPrefetch';
```

In the instrumented `prove` body (Task 2), change the witness load line to:

```ts
          const witnessBundleJson = await (
            consumePrefetchedPassportShowWitness(args.credentialId) ??
            loadPassportShowWitness(args.credentialId)
          );
```

(Prefetched `null` — vault miss or failed decrypt — falls through to the same explicit error below it; do NOT retry the load on prefetched null, a second read of the same immutable key would return the same result.)

- [x] **Step 6: Trigger/clear in `PassportShowPresentation.tsx`**

Add imports (`useEffect` from `react`, prefetch fns):

```ts
import { useEffect, type ReactNode } from 'react';
import {
  clearPassportShowPrefetch,
  prefetchPassportShowPresentation,
} from '@/passport/showPrefetch';
```

Inside the component, before the `usePassportShowPresentation` call:

```ts
  useEffect(() => {
    prefetchPassportShowPresentation(credentialId);
    return () => {
      clearPassportShowPrefetch(credentialId);
    };
  }, [credentialId]);
```

- [x] **Step 7: Clear on credential delete in `credentials/store.ts`**

Next to `deletePassportShowWitness(id);` (line ~192) add:

```ts
    clearPassportShowPrefetch(id);
```

with the import added to the existing `@/passport/…` imports in that file:

```ts
import { clearPassportShowPrefetch } from '@/passport/showPrefetch';
```

- [x] **Step 8: Full targeted tests + typecheck + commit**

```bash
cd apps/expo && bun test __tests__/unit/passportShowPrefetch.test.ts __tests__/unit/passportShowPresentation.test.ts && bun run typecheck
git add -A apps/expo
git commit -m "feat(passport): prefetch show witness + nitro modules on sheet open"
```

---

### Task 9: `proofOverlayStage` reducer field

**Files:**
- Modify: `apps/expo/src/passport/pipeline.ts` (state line ~153, actions line ~175, reducer line ~192)
- Test: `apps/expo/__tests__/unit/passportPipeline.test.ts`

- [x] **Step 1: Write the failing test**

In `passportPipeline.test.ts` add:

```ts
import {
  initialPassportPipelineState,
  passportPipelineReducer,
} from '../../src/passport/pipeline';

describe('proofOverlayStage', () => {
  it('starts null and follows explicit stage transitions', () => {
    expect(initialPassportPipelineState.proofOverlayStage).toBeNull();
    const init = passportPipelineReducer(initialPassportPipelineState, {
      type: 'setProofOverlayStage',
      stage: 'init',
    });
    expect(init.proofOverlayStage).toBe('init');
    const proving = passportPipelineReducer(init, {
      type: 'setProofOverlayStage',
      stage: 'proving',
    });
    expect(proving.proofOverlayStage).toBe('proving');
    const done = passportPipelineReducer(proving, {
      type: 'setProofOverlayStage',
      stage: 'done',
    });
    expect(done.proofOverlayStage).toBe('done');
    const cleared = passportPipelineReducer(done, {
      type: 'setProofOverlayStage',
      stage: null,
    });
    expect(cleared.proofOverlayStage).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify it fails**

```bash
cd apps/expo && bun test __tests__/unit/passportPipeline.test.ts
```

Expected: FAIL — unknown action / missing field.

- [x] **Step 3: Implement in `pipeline.ts`**

State (after `proofProgressMessage`, line ~153):

```ts
  /**
   * Explicit overlay stage for proof generation — real milestones only
   * (CLAUDE.md rule 8): 'init' when the prover is starting, 'proving' on
   * the first real generate event, 'done' on actual completion, null when
   * no overlay should show.
   */
  readonly proofOverlayStage: 'init' | 'proving' | 'done' | null;
```

Initial state (line ~171):

```ts
  proofOverlayStage: null,
```

Action union (line ~187):

```ts
  | {
      readonly type: 'setProofOverlayStage';
      readonly stage: PassportPipelineState['proofOverlayStage'];
    }
```

Reducer case (after `setProofProgress`):

```ts
    case 'setProofOverlayStage':
      return { ...state, proofOverlayStage: action.stage };
```

- [x] **Step 4: Run tests + typecheck + commit**

```bash
cd apps/expo && bun test __tests__/unit/passportPipeline.test.ts && bun run typecheck
git add apps/expo/src/passport/pipeline.ts apps/expo/__tests__/unit/passportPipeline.test.ts
git commit -m "feat(passport): add explicit proofOverlayStage to pipeline state"
```

---

### Task 10: Event-driven `CryptoCompilingOverlay`

**Files:**
- Modify: `apps/expo/src/components/common/CryptoCompilingOverlay.tsx` (full rewrite of timing logic; visuals kept)
- Modify: `apps/expo/app/passport/index.tsx` (overlay mount line ~658, stage dispatches in `onGenerateProof`)

- [x] **Step 1: Rewrite the overlay component**

Props change from `{ visible, onCompletion }` to real-milestone-driven. Replace the component's interface, phase state, and the timer `useEffect` (lines 30–106) — the render JSX below the hooks keeps its current structure with `phase` mapped as shown:

```ts
type Stage = 'init' | 'proving' | 'done';

interface CryptoCompilingOverlayProps {
  readonly visible: boolean;
  /** Real pipeline stage — drives phases 1:1; no internal timeline. */
  readonly stage: Stage;
  /** Real progress text from the proof runner (e.g. "Generating dsc_chain proof…"). */
  readonly statusText: string;
  /** Fired ~1.2 s after `stage` becomes 'done' (celebration delay AFTER real completion). */
  readonly onDone?: () => void;
}

const STATUS_COLOR: Readonly<Record<Stage, string>> = {
  init: Colors.text1,
  proving: Colors.primaryBlue,
  done: Colors.terminalGreen,
};

export function CryptoCompilingOverlay({
  visible,
  stage,
  statusText,
  onDone,
}: CryptoCompilingOverlayProps) {
  const [hashes, setHashes] = useState<readonly string[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);
  const cursorOpacity = useSharedValue(0);
  const verifiedScale = useSharedValue(0.5);
  const verifiedOpacity = useSharedValue(0);

  // Mount haptic + cursor blink while work is actually running.
  useEffect(() => {
    if (!visible) return;
    haptic('tap');
    cursorOpacity.value = withRepeat(
      withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [visible, cursorOpacity]);

  // 'done' = REAL completion: spring the badge, success haptic, then hand
  // control back to the parent. This is the only timer left and it runs
  // strictly AFTER the work finished.
  useEffect(() => {
    if (!visible || stage !== 'done') return;
    cursorOpacity.value = 0;
    verifiedScale.value = withSpring(1, { damping: 6, stiffness: 120 });
    verifiedOpacity.value = withTiming(1, { duration: 200 });
    haptic('success');
    const doneT = setTimeout(() => {
      onDone?.();
    }, 1200);
    return () => clearTimeout(doneT);
  }, [visible, stage, cursorOpacity, verifiedOpacity, verifiedScale, onDone]);

  // Decorative hash scroll ONLY while a circuit is actually proving.
  useEffect(() => {
    if (!visible || stage !== 'proving') return;
    const id = setInterval(() => {
      setHashes((prev) => {
        const next = [...prev, randomHash()];
        if (next.length > 40) next.shift();
        return next;
      });
      if (Math.random() < 0.25) haptic('tap');
    }, 50);
    return () => clearInterval(id);
  }, [visible, stage]);

  useEffect(() => {
    if (stage === 'proving') {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [hashes, stage]);
  // …animated styles unchanged…
```

Render mapping (same JSX skeleton, renamed conditions):

- Status `<Text>` shows `stage === 'done' ? 'Proof Accepted.' : statusText` with `STATUS_COLOR[stage]`; cursor block renders when `stage !== 'done'`.
- Hash terminal `<View>` renders when `stage === 'proving'`.
- `[ VERIFIED ]` renders when `stage === 'done'`.
- Delete the old `Phase` type, `STATUS_TEXT` map, and every `setTimeout` for 800/3500/5000 ms.

- [x] **Step 2: Wire the screen — stage dispatches in `onGenerateProof`**

In `app/passport/index.tsx` `onGenerateProof`:

After `dispatch({ type: 'setProofProgress', message: 'Initializing prover...' });` add:

```ts
      dispatch({ type: 'setProofOverlayStage', stage: 'init' });
```

In the `tryGenerateOpenAcV3Proof` progress callback, mark real proving (idempotent dispatch):

```ts
              (m) => {
                dispatch({ type: 'setProofProgress', message: m });
                dispatch({ type: 'setProofOverlayStage', stage: 'proving' });
              },
```

After `dispatch({ type: 'setProof', proof });` (line ~479) add:

```ts
      dispatch({ type: 'setProofOverlayStage', stage: 'done' });
```

In the `catch` block of `onGenerateProof` (before `reportPassportError`) and in the SD-JWT fallback branch (right before `proof = { proofType: 'sd-jwt-fallback', … }` is dispatched via `setProof`) the overlay must not claim success for fallbacks: in the fallback branch add

```ts
        dispatch({ type: 'setProofOverlayStage', stage: null });
```

and in `catch` add the same `null` dispatch as its first statement.

- [x] **Step 3: Wire the mount (line ~658)**

```tsx
      <CryptoCompilingOverlay
        visible={state.proofOverlayStage !== null}
        stage={state.proofOverlayStage ?? 'init'}
        statusText={state.proofProgressMessage}
        onDone={() => {
          dispatch({ type: 'setProofOverlayStage', stage: null });
        }}
      />
```

(The old `visible={state.isLoading && state.step === 'proof'}` condition is deleted — visibility is now owned by the explicit stage, so the overlay survives exactly as long as the real work + 1.2 s celebration.)

- [x] **Step 4: Typecheck + grep for stale props**

```bash
cd apps/expo && bun run typecheck
grep -rn "CryptoCompilingOverlay" apps/expo/src apps/expo/app --include="*.tsx" | grep -v "common/CryptoCompilingOverlay"
```

Expected: 0 type errors; the only mount is `app/passport/index.tsx` with the new props. If another mount exists, update it the same way.

- [x] **Step 5: Commit**

```bash
git add -A apps/expo
git commit -m "feat(passport): drive proof overlay from real milestones, kill fake 5s timeline"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [x] **Step 1: Full suite vs baseline**

```bash
cd apps/expo && bun run typecheck && bun test 2>&1 | tail -10 && bun run lint 2>&1 | tail -5
```

Expected: typecheck 0 errors; test/lint results show **no new failures** vs the Task 0 baseline.

- [ ] **Step 2: Manual device verification (user-assisted)**

On the test device, one full enrollment + one show; confirm and record:

1. `[zk:timing]` lines for both flows (the spec baseline numbers).
2. Exactly ONE Face ID prompt at enrollment (at save) — none during proving.
3. Overlay shows real circuit names, `[ VERIFIED ]` only after the real bundle completes, auto-dismisses ~1.2 s later.
4. Show flow works end-to-end (scan on second device verifies — self-verify now dev-only).
5. A fresh credential's verifier self-pin appears (re-open app, verify a show QR from another device or assert `loadPassportShowVkSelfPin() !== null` via dev tooling).

- [ ] **Step 3: Update plan checkboxes + report timings back into the spec discussion**

The recorded prepare/show stage timings decide phase-3 (Rust cache) sizing — paste them into the PR description and the next plan.

---

## Out of scope (later plans)

- Phase 3: passport-noir prover cache + `warmupCircuit` (sibling repo `~/Workspace/Work/solidarity/passport-noir` + pin bump).
- Phase 4: single Face ID (`keyAuthMode` + native LAContext in `nitro-modules/spruce-did`).
- Phase 5: background prepare lifecycle (pending trust state + resume).
- Phase 6: time-bucket pre-prove + envelope v2 (vk removal).
