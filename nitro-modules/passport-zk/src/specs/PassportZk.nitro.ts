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
 * Android: HybridPassportZk.kt calls into a Rust cdylib
 *   (passport_zk_mopro for aarch64-linux-android + x86_64-linux-android)
 *   via JNI. The Rust source is in passport-noir/mopro-binding/src/.
 *
 * NOTE: this file is on the JS↔Native boundary, so `any` is allowed by
 * eslint config (see eslint.config.mjs override on nitro-modules/**/specs).
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface NoirProofResult {
  /** Raw proof bytes (Barretenberg-encoded). */
  readonly proof: ArrayBuffer;
  /** Public inputs as decimal-string field elements (BN254). */
  readonly publicInputs: readonly string[];
}

export interface PassportZk
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Generate a Noir ZK proof.
   * @param circuitPath  Absolute path to the compiled circuit JSON (Noir 1.0.0-beta.19).
   * @param srsPath      Optional path to a precomputed SRS bin; if omitted, derived from circuit.
   * @param inputs       Map of witness name → array of decimal-string field elements.
   */
  generateNoirProof(
    circuitPath: string,
    srsPath: string | undefined,
    inputs: Readonly<Record<string, readonly string[]>>
  ): Promise<NoirProofResult>;

  /** Extract verifying key bytes for a circuit. */
  getNoirVerificationKey(
    circuitPath: string,
    srsPath: string | undefined
  ): Promise<ArrayBuffer>;

  /** Verify a proof against a verifying key. */
  verifyNoirProof(proof: ArrayBuffer, vk: ArrayBuffer): Promise<boolean>;
}
