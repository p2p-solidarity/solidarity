//
//  HybridPassportZk.swift
//  @solidarity/nitro-passport-zk (iOS)
//
//  Wraps passport-noir/mopro-binding's MoproBindings.xcframework for
//  on-device ICAO passport ZK proofs. Implements the Nitrogen-generated
//  HybridPassportZkSpec protocol.
//
//  The mopro FFI surface (from MoproiOSBindings/mopro.swift):
//    public func generateNoirProof(
//      circuitPath: String, srsPath: String?, inputs: [String: [String]]
//    ) throws -> NoirProofResult
//    public func getNoirVerificationKey(circuitPath: String, srsPath: String?) throws -> Data
//    public func verifyNoirProof(proof: Data, vk: Data) throws -> Bool
//
//  where mopro's NoirProofResult is `{ proof: Data; publicInputs: [String] }`.
//
//  Bridge translation:
//    inputs:        JSON-stringified  →  decode to [String: [String]]
//    proof:         Data              →  ArrayBuffer (zero-copy via NitroModules)
//    publicInputs:  [String]          →  JSON-stringified for the cross-platform
//                                       wire (avoids Nitrogen generic-array surprises)
//
import Foundation
import MoproiOSBindings
import NitroModules

final class HybridPassportZk: HybridPassportZkSpec {

  func generateNoirProof(
    circuitPath: String,
    srsPath: String?,
    inputsJson: String
  ) throws -> Promise<NoirProofResult> {
    return Promise.async {
      let inputs = try Self.parseInputs(inputsJson)
      let mopro = try MoproiOSBindings.generateNoirProof(
        circuitPath: circuitPath,
        srsPath: srsPath,
        inputs: inputs
      )
      let inputsOut = try JSONSerialization.data(withJSONObject: mopro.publicInputs, options: [])
      let inputsString = String(data: inputsOut, encoding: .utf8) ?? "[]"
      return NoirProofResult(
        proof: ArrayBuffer.copy(data: mopro.proof),
        publicInputsJson: inputsString
      )
    }
  }

  func getNoirVerificationKey(
    circuitPath: String,
    srsPath: String?
  ) throws -> Promise<ArrayBuffer> {
    return Promise.async {
      let vk = try MoproiOSBindings.getNoirVerificationKey(
        circuitPath: circuitPath,
        srsPath: srsPath
      )
      return ArrayBuffer.copy(data: vk)
    }
  }

  func verifyNoirProof(
    proof: ArrayBuffer,
    vk: ArrayBuffer
  ) throws -> Promise<Bool> {
    return Promise.async {
      let proofData = Data(bytes: proof.data, count: proof.size)
      let vkData = Data(bytes: vk.data, count: vk.size)
      return try MoproiOSBindings.verifyNoirProof(proof: proofData, vk: vkData)
    }
  }

  // MARK: - Helpers

  private static func parseInputs(_ json: String) throws -> [String: [String]] {
    guard let data = json.data(using: .utf8) else {
      throw NSError(domain: "PassportZk", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "inputsJson is not valid UTF-8"
      ])
    }
    let raw = try JSONSerialization.jsonObject(with: data, options: [])
    guard let map = raw as? [String: [String]] else {
      throw NSError(domain: "PassportZk", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "inputsJson must decode to { [string]: string[] }"
      ])
    }
    return map
  }
}
