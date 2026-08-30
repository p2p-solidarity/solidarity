//
//  MoproShim.swift
//  @solidarity/nitro-passport-zk (iOS)
//
//  Bridges mopro.swift's top-level uniffi functions into the PassportZK
//  Swift module. `@_implementationOnly import MoproBindings` hides
//  mopro's internal types (RustBuffer, NoirProofResult, FfiConverter…)
//  from PassportZK's Swift→C++ interop header.
//
import Foundation
@_implementationOnly import MoproBindings

internal struct MoproProofResult {
  let proof: Data
  let vk: Data
}

internal enum MoproShim {
  static func generate(
    circuitPath: String,
    srsPath: String?,
    inputs: [String: [String]]
  ) throws -> MoproProofResult {
    let result = try MoproBindings.generateNoirProof(
      circuitPath: circuitPath,
      srsPath: srsPath,
      inputs: inputs
    )
    return MoproProofResult(proof: result.proof, vk: result.vk)
  }

  static func getVk(circuitPath: String, srsPath: String?) throws -> Data {
    return try MoproBindings.getNoirVerificationKey(
      circuitPath: circuitPath,
      srsPath: srsPath
    )
  }

  static func verify(proof: Data, vk: Data) throws -> Bool {
    return try MoproBindings.verifyNoirProof(proof: proof, vk: vk)
  }

  /// Shared Rust OpenAC v3 witness builder. Returns the result JSON
  /// (`gg.solidarity.passport.openac-v3.witness-build-result.v1`) verbatim;
  /// the caller decodes it into the Nitro `OpenAcV3WitnessBuildResult`.
  static func buildOpenAcV3WitnessBundle(requestJson: String) throws -> String {
    return try MoproBindings.buildOpenAcV3WitnessBundle(requestJson: requestJson)
  }
}
