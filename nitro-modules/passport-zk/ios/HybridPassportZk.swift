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
    return Promise.async {
      let proofData = Data(bytes: proof.data, count: proof.size)
      let vkData = Data(bytes: vk.data, count: vk.size)
      return try MoproShim.verify(proof: proofData, vk: vkData)
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

  private static func resolveCircuitPath(_ supplied: String) throws -> String {
    if !supplied.isEmpty {
      return supplied
    }
    return try bundledResourcePath(
      resource: "disclosure",
      extension: "json",
      description: "default disclosure circuit"
    )
  }

  private static func resolveSrsPath(_ supplied: String?) throws -> String? {
    guard supplied?.isEmpty ?? true else {
      return supplied
    }
    return try bundledResourcePath(
      resource: "disclosure.srs",
      extension: "bin",
      description: "default disclosure SRS"
    )
  }

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
