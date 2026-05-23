/**
 * Nitro spec — passport-zk
 *
 * Wraps passport-noir/mopro-binding for on-device ZK passport proofs.
 * Mirrors the Swift FFI surface in
 *   passport-noir/mopro-binding/MoproiOSBindings/mopro.swift
 *
 * Surface to mirror:
 *   public func generateNoirProof(circuitPath, srsPath?, inputs) → NoirProofResult
 *   public func getNoirVerificationKey(circuitPath, srsPath?) → Data
 *   public func verifyNoirProof(proof, vk) → Bool
 *
 * iOS: HybridPassportZk.swift reuses MoproBindings.xcframework directly.
 * Android: HybridPassportZk.kt calls into a Rust cdylib via JNI.
 *
 * The `inputs` map (witness name → array of decimal-string field elements
 * in BN254) is passed as a JSON-stringified payload across the bridge —
 * Nitrogen doesn't support generic Record types, and the JSON form
 * matches the way the underlying mopro FFI already expects inputs.
 *
 * NOTE: this file is on the JS↔Native boundary, so `any` is allowed by
 * eslint config (see eslint.config.mjs override on
 * `nitro-modules / src / specs`).
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface NoirProofResult {
  /** Raw proof bytes (Barretenberg-encoded). */
  readonly proof: ArrayBuffer;
  /** Public inputs as a JSON-stringified array of decimal-string field elements. */
  readonly publicInputsJson: string;
}

export interface PassportZk
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Generate a Noir ZK proof.
   * @param circuitPath    Absolute path to the compiled circuit JSON.
   * @param srsPath        Optional path to a precomputed SRS bin.
   * @param inputsJson     JSON-stringified `{ [witness: string]: string[] }`
   *                       where values are decimal field elements (BN254).
   */
  generateNoirProof(
    circuitPath: string,
    srsPath: string | undefined,
    inputsJson: string
  ): Promise<NoirProofResult>;

  /** Extract verifying-key bytes for a circuit. */
  getNoirVerificationKey(
    circuitPath: string,
    srsPath: string | undefined
  ): Promise<ArrayBuffer>;

  /** Verify a proof against a verifying key. */
  verifyNoirProof(proof: ArrayBuffer, vk: ArrayBuffer): Promise<boolean>;
}
