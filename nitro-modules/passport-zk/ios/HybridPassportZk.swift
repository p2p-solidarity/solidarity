//
//  HybridPassportZk.swift
//  @solidarity/nitro-passport-zk (iOS)
//
//  Wraps passport-noir/mopro-binding for on-device ICAO passport ZK proofs.
//  Uses MoproShim (same Swift module) to call mopro.swift's top-level
//  functions without recursing into our own protocol method names.
//
import Foundation
import NitroModules

final class HybridPassportZk: HybridPassportZkSpec {

  func generateNoirProof(
    circuitPath: String,
    srsPath: String?,
    inputsJson: String
  ) throws -> Promise<NitroNoirProof> {
    return Promise.async {
      let inputs = try Self.parseInputs(inputsJson)
      let resolvedCircuitPath = try Self.resolveCircuitPath(circuitPath)
      let resolvedSrsPath = try Self.resolveSrsPath(srsPath)
      let mopro = try MoproShim.generate(
        circuitPath: resolvedCircuitPath,
        srsPath: resolvedSrsPath,
        inputs: inputs
      )
      return NitroNoirProof(
        proof: try ArrayBuffer.copy(data: mopro.proof),
        vk: try ArrayBuffer.copy(data: mopro.vk)
      )
    }
  }

  func getNoirVerificationKey(
    circuitPath: String,
    srsPath: String?
  ) throws -> Promise<ArrayBuffer> {
    return Promise.async {
      let vk = try MoproShim.getVk(
        circuitPath: try Self.resolveCircuitPath(circuitPath),
        srsPath: try Self.resolveSrsPath(srsPath)
      )
      return try ArrayBuffer.copy(data: vk)
    }
  }

  func verifyNoirProof(
    proof: ArrayBuffer,
    vk: ArrayBuffer
  ) throws -> Promise<Bool> {
    // Copy the NON-OWNING JS ArrayBuffers synchronously, before Promise.async —
    // touching proof/vk .data/.size on the async executor (another thread,
    // later) traps the process (SIGTRAP) and is uncatchable by JS try/catch.
    let proofData = Data(bytes: proof.data, count: proof.size)
    let vkData = Data(bytes: vk.data, count: vk.size)
    return Promise.async {
      return try MoproShim.verify(proof: proofData, vk: vkData)
    }
  }

  func buildOpenAcV3WitnessBundle(
    requestJson: String
  ) throws -> Promise<OpenAcV3WitnessBuildResult> {
    return Promise.async {
      let resultJson = try MoproShim.buildOpenAcV3WitnessBundle(requestJson: requestJson)
      return try Self.decodeWitnessResult(resultJson)
    }
  }

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

  /// Decode the Rust builder's result JSON
  /// (`gg.solidarity.passport.openac-v3.witness-build-result.v1`) into the
  /// Nitro struct the JS layer consumes.
  private static func decodeWitnessResult(
    _ resultJson: String
  ) throws -> OpenAcV3WitnessBuildResult {
    guard let data = resultJson.data(using: .utf8) else {
      throw NSError(domain: "PassportZk", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "OpenAC v3 witness result is not valid UTF-8"
      ])
    }
    let raw = try JSONSerialization.jsonObject(with: data, options: [])
    guard let result = raw as? [String: Any],
          let schema = result["schema"] as? String,
          let passportNoirVersion = result["passportNoirVersion"] as? String,
          let ready = result["ready"] as? Bool
    else {
      throw NSError(domain: "PassportZk", code: 5, userInfo: [
        NSLocalizedDescriptionKey: "OpenAC v3 witness result is malformed"
      ])
    }
    return OpenAcV3WitnessBuildResult(
      schema: schema,
      passportNoirVersion: passportNoirVersion,
      ready: ready,
      reason: result["reason"] as? String,
      bundleJson: result["bundleJson"] as? String
    )
  }

  private static func resolveCircuitPath(_ supplied: String) throws -> String {
    let key = supplied.isEmpty ? "passport_adapter" : supplied
    guard let resource = circuitResourceAliases[key] else {
      return supplied
    }
    return try bundledResourcePath(
      resource: resource,
      extension: "json",
      description: "passport-noir 0.3.0 \(resource) circuit"
    )
  }

  private static func resolveSrsPath(_ supplied: String?) throws -> String? {
    let key = (supplied?.isEmpty ?? true) ? "passport_adapter" : (supplied ?? "")
    guard let resource = srsResourceAliases[key] else {
      return supplied
    }
    return try bundledResourcePath(
      resource: resource,
      extension: "bin",
      description: "passport-noir 0.3.0 \(resource).bin SRS"
    )
  }

  private static let circuitResourceAliases: [String: String] = [
    "dsc_chain": "dsc_chain",
    "dsc_chain.json": "dsc_chain",
    "passport_adapter": "passport_adapter",
    "passport_adapter.json": "passport_adapter",
    "openac_show": "openac_show",
    "openac_show.json": "openac_show",
  ]

  private static let srsResourceAliases: [String: String] = [
    "dsc_chain": "dsc_chain.srs",
    "dsc_chain.srs.bin": "dsc_chain.srs",
    "passport_adapter": "passport_adapter.srs",
    "passport_adapter.srs.bin": "passport_adapter.srs",
    "openac_show": "openac_show.srs",
    "openac_show.srs.bin": "openac_show.srs",
  ]

  private static func bundledResourcePath(
    resource: String,
    extension ext: String,
    description: String
  ) throws -> String {
    let bundles = [Bundle.main] + Bundle.allFrameworks + Bundle.allBundles
    var seen = Set<String>()
    for bundle in bundles where seen.insert(bundle.bundlePath).inserted {
      if let url = bundle.url(forResource: resource, withExtension: ext) {
        return url.path
      }
    }

    throw NSError(domain: "PassportZk", code: 3, userInfo: [
      NSLocalizedDescriptionKey:
        "Missing bundled \(description) resource \(resource).\(ext). Run pod install after updating PassportZK.podspec resources."
    ])
  }
}
