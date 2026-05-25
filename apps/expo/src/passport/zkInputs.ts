/**
 * passport-zk witness builder.
 *
 * The bundled circuit (`nitro-modules/passport-zk/android/src/main/assets/passport_verifier.json`)
 * is the v1 DSC→SOD RSA-SHA256 verifier. Its `fn main(sod_hash, signature_limbs,
 * modulus_limbs, redc_limbs, exponent)` takes 5 named witness slots, encoded as
 * a `{ name: decimal-string[] }` map for the mopro `generateNoirProof` FFI.
 *
 * Real chip → witness mapping for the v3 `passport_adapter` circuit needs
 * 1500+ lines of CSCA Master List Merkle proofs, DSC SMT non-membership
 * proofs, DG hash-chain validation, and Path-A device binding — that is a
 * separate, multi-week piece of work. For now we expose:
 *
 *   1. `DEMO_PASSPORT_VERIFIER_WITNESS` — the known-passing test vector
 *      from passport-noir's `test_rsa_sha256_verification` (PV-1). These
 *      bytes are NOT from anyone's real passport; they're a synthetic
 *      RSA-2048 keypair the upstream repo uses to exercise the circuit.
 *      Per CLAUDE.md rule 8 the caller must label resulting proofs as
 *      *demo / synthetic* — never present them as if they were attestation
 *      against the user's actual passport.
 *
 *   2. `buildPassportVerifierWitness(chip)` — facade that returns the
 *      demo witness today, with a TODO for the real chip→witness mapping
 *      once SOD parsing + RSA limb encoding land.
 */
import type { PassportChipSnapshot } from '@/passport/pipeline';

/** RSA-2048 limb count (18 limbs × 115 bits ≈ 2070 bits, then masked). */
const RSA_LIMB_COUNT = 18;
/** SOD signed-attributes SHA-256 hash size in bytes. */
const SOD_HASH_BYTES = 32;

/**
 * Test-vector RSA-2048 signature (`signature_limbs`) from passport-noir's
 * `passport_verifier::test_rsa_sha256_verification`. Generated upstream
 * via `noir_rsa v0.10.0 signature_gen` on the message
 * "Hello World! This is Noir-RSA" — NOT a real passport DSC signature.
 */
const DEMO_SIGNATURE_LIMBS_HEX: readonly string[] = [
  '0xa56c33662e463fa8a879805279db7b',
  '0x275b4fd5fcd5b1e5a24134085280a8',
  '0x4e932b35cdf50f826889b035839ce7',
  '0x9121752d1d5f077cf4ef572a6cf184',
  '0x95efa0c95a11db7880a0cd2439055a',
  '0xb452f4cc1f9d1e592e7f8c6fcb06e0',
  '0x63716e99646d15db9fc9ba00390896',
  '0x7b52b8e2f99755eeef46361c239c37',
  '0xcc0b9328358cc472f1e947d0d19440',
  '0xae2d4ee973f9e13444924f8ada5397',
  '0x4045e3da340652d05ec73a4f07211f',
  '0xe43165ab42c48d2ee9a195bb8a9a69',
  '0x6423a144562d9a1527964e0a90081f',
  '0x1aef35b66d4aae989a6ee1d53ccb62',
  '0xb93652c7a17c0f0227852d0726c9d9',
  '0x8760ef7f6c6baabddac0c6d97073ee',
  '0xcca3d67ca6851866ce763d1d5d8107',
  '0x2d',
];

/** Test-vector RSA modulus limbs — public input. */
const DEMO_MODULUS_LIMBS_HEX: readonly string[] = [
  '0x1b6191d195895b5df38941a00eace5',
  '0xd18c88a04b0e5a204fb4323280be55',
  '0xc1d2f01fe8a294cabc5e60aeb98556',
  '0x813ea53b764fa89ddffd9bafa98e8',
  '0xfb782a5aa5060e19b182c61a5b0591',
  '0x3ed0a91d93634c002dff05de91fe0',
  '0x916c13e9253a809ba7d8f858f04c0e',
  '0x3dfc5b0b2e5c5a589dbd2a73b409c2',
  '0xc326214283ec0451c712892ef7d748',
  '0x70d990293997e77dc8444de23edf40',
  '0x565e7d47a8065923c4c651a47da025',
  '0x6bacd32300777b398c2dc99ab0f3f7',
  '0x27f20db536146ef7710ad6ecffd56c',
  '0x55040a0b37f674e89df61a76efe39',
  '0xb1f75729719550e7fe3df15d686a99',
  '0xcada91cde367961e4d82dcc08e2cf3',
  '0x6ee67af8eeeb91b4fcb5cede4b6287',
  '0xbf',
];

/** Test-vector Barrett reduction parameter. */
const DEMO_REDC_LIMBS_HEX: readonly string[] = [
  '0xe6bdbea08b7ba701fdfbd15baa73e6',
  '0x5a38898fe8ccb04c2de86a0042f8e',
  '0x688830cdab9cc2344d0fcec773dfb8',
  '0x1442a296a6d89d7b533c3463b6f2b4',
  '0x8ff0bc7c8116c4dbb992f317024a15',
  '0x90de977522adb5532c0381206711c3',
  '0xa8daff3c0370775669b689d139c109',
  '0xd6fb4597d7cb0727aa9f234d81e328',
  '0xa365752d2787c1f280230f1bbb894',
  '0xda474ce35717e995d256d82843b70d',
  '0xf0f4824efeb77eb2f6e6b426673144',
  '0xae31d393ef0c42181faeed969e2e2',
  '0x30e2f8f53e7cf8eb0da59ffc784a3f',
  '0x32a643a3002225074fc3368dc450ce',
  '0x13d35a36748fa6c319609c9175d9c1',
  '0x49fb2cb9fa230acb1a1ac8db1b1ea9',
  '0x3555949efc369e3a1eeefda224544',
  '0x5596',
];

/** SHA-256 hash of the test message; matches the upstream test exactly. */
const DEMO_SOD_HASH_BYTES: readonly number[] = [
  91, 207, 46, 60, 22, 153, 217, 144, 2, 127, 224, 143, 181, 45, 32, 120,
  122, 131, 166, 79, 166, 183, 43, 158, 116, 105, 73, 207, 196, 77, 33, 5,
];

if (DEMO_SIGNATURE_LIMBS_HEX.length !== RSA_LIMB_COUNT) {
  throw new Error('DEMO_SIGNATURE_LIMBS_HEX must have RSA_LIMB_COUNT entries');
}
if (DEMO_MODULUS_LIMBS_HEX.length !== RSA_LIMB_COUNT) {
  throw new Error('DEMO_MODULUS_LIMBS_HEX must have RSA_LIMB_COUNT entries');
}
if (DEMO_REDC_LIMBS_HEX.length !== RSA_LIMB_COUNT) {
  throw new Error('DEMO_REDC_LIMBS_HEX must have RSA_LIMB_COUNT entries');
}
if (DEMO_SOD_HASH_BYTES.length !== SOD_HASH_BYTES) {
  throw new Error('DEMO_SOD_HASH_BYTES must have SOD_HASH_BYTES entries');
}

/** A name → decimal-string-array map matching mopro's `Map<String, List<String>>`. */
export type WitnessMap = Record<string, readonly string[]>;

/**
 * Build the (synthetic) witness for `passport_verifier`. This is NOT
 * derived from chip data — see the module header for the trade-offs.
 */
export function demoPassportVerifierWitness(): WitnessMap {
  return {
    sod_hash: DEMO_SOD_HASH_BYTES.map((b) => b.toString()),
    signature_limbs: DEMO_SIGNATURE_LIMBS_HEX.map(hexToDecimal),
    modulus_limbs: DEMO_MODULUS_LIMBS_HEX.map(hexToDecimal),
    redc_limbs: DEMO_REDC_LIMBS_HEX.map(hexToDecimal),
    exponent: ['65537'],
  };
}

/**
 * Build the witness for the bundled passport_verifier circuit.
 *
 * TODO(v3): when we add SOD parsing + DSC modulus extraction (a separate
 * piece of work — see CLAUDE notes), branch on `chip.isSimulated`: real
 * chip → real witness; simulated chip → demo constants below. Until then
 * EVERY call returns the demo vector, and the caller must label the
 * resulting proof as synthetic.
 */
export function buildPassportVerifierWitness(
  // Kept in the signature so the v3 wiring slots in without breaking
  // callers. `chip` is currently unused — see TODO above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  chip: PassportChipSnapshot,
): WitnessMap {
  return demoPassportVerifierWitness();
}

/** `0xaffe…` → decimal string compatible with mopro's field-element decoder. */
function hexToDecimal(hex: string): string {
  return BigInt(hex).toString(10);
}
