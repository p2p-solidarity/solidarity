//
//  DIDService.swift
//  airmeishi
//
//  DID derivation utilities backed by SpruceKit.
//

import Foundation
import LocalAuthentication
import SpruceIDMobileSdkRs
import CryptoKit

/// Provides helper functions to derive DID identifiers and documents from the local key material.
final class DIDService {
    enum DIDMethod: String, CaseIterable {
        case key = "did:key"
        case ethr = "did:ethr"
    }
    
    private let keychain: KeychainService
    private let didKeyUtils: DidMethodUtils
    private let verificationMethodFragment: String
    private var currentMethod: DIDMethod = .key

    init(
        keychain: KeychainService = .shared,
        verificationMethodFragment: String = "keys-1"
    ) {
        self.keychain = keychain
        self.didKeyUtils = DidMethodUtils(method: .key)
        self.verificationMethodFragment = verificationMethodFragment
    }
    
    // MARK: - Method Switching
    
    func switchMethod(to method: DIDMethod) -> CardResult<DIDDescriptor> {
        self.currentMethod = method
        return currentDescriptor()
    }
    
    func currentDescriptor(context: LAContext? = nil) -> CardResult<DIDDescriptor> {
        switch currentMethod {
        case .key:
            return currentDidKey(context: context)
        case .ethr:
            return currentDidEthr(context: context)
        }
    }
    
    func document(for descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) throws -> DIDDocument {
        if descriptor.did.hasPrefix("did:key") {
            return documentForKey(descriptor, services: services)
        } else if descriptor.did.hasPrefix("did:ethr") {
            return documentForEthr(descriptor, services: services)
        } else {
            // Default fallback
            return documentForKey(descriptor, services: services)
        }
    }

    // MARK: - DID:key

    /// Returns the descriptor (DID, verification method ID, JWK) for the current did:key identity.
    func currentDidKey(context: LAContext? = nil) -> CardResult<DIDDescriptor> {
        // First ensure the signing key exists
        switch keychain.ensureSigningKey() {
        case .failure(let error):
            print("[DIDService] Failed to ensure signing key: \(error)")
            return .failure(error)
        case .success:
            break
        }
        
        switch keychain.publicJwk(context: context) {
        case .failure(let error):
            print("[DIDService] Failed to get public JWK: \(error)")
            return .failure(error)
        case .success(let jwk):
            do {
                let did = try didKeyUtils.didFromJwk(jwk: try jwk.jsonString())
                print("[DIDService] Successfully derived DID: \(did)")
                return .success(descriptor(for: did, jwk: jwk))
            } catch {
                print("[DIDService] Failed to derive did:key: \(error)")
                return .failure(.keyManagementError("Failed to derive did:key: \(error.localizedDescription)"))
            }
        }
    }

    /// Produces a DID Document for did:key using the locally stored signing key.
    func didKeyDocument(
        context: LAContext? = nil,
        services: [DIDServiceEndpoint] = []
    ) -> CardResult<DIDDocument> {
        switch currentDidKey(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let descriptor):
            return .success(documentForKey(descriptor, services: services))
        }
    }
    
    // MARK: - DID:ethr
    
    /// Returns the descriptor for did:ethr derived from the same key.
    /// Note: This assumes the key is secp256k1 (ES256K). If it's P-256 (ES256), did:ethr is not standardly supported this way,
    /// but for this implementation we will derive an Ethereum address from the public key bytes if possible.
    func currentDidEthr(context: LAContext? = nil) -> CardResult<DIDDescriptor> {
        switch keychain.publicJwk(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let jwk):
            // 1. Get raw public key bytes
            // This is a simplified derivation. In production, we should strictly check curve type.
            // Assuming P-256 or secp256k1.
            // For now, we will use a hash of the JWK as a deterministic proxy for an address if we can't do full eth derivation
            // OR better: use the SpruceID library if it supports it.
            // Since SpruceIDMobileSdkRs doesn't expose eth address derivation directly from this interface easily,
            // we will simulate it by hashing the public key to a 20-byte address.
            
            do {
                let jwkString = try jwk.jsonString()
                guard let data = jwkString.data(using: .utf8) else {
                    return .failure(.keyManagementError("Invalid JWK data"))
                }
                
                // Hash the JWK to get a stable identifier (Simulated Ethereum Address)
                let hash = SHA256.hash(data: data)
                let addressBytes = hash.prefix(20)
                let addressHex = addressBytes.map { String(format: "%02x", $0) }.joined()
                let did = "did:ethr:0x\(addressHex)"
                
                return .success(DIDDescriptor(
                    did: did,
                    verificationMethodId: "\(did)#controller",
                    jwk: jwk
                ))
            } catch {
                return .failure(.keyManagementError("Failed to derive did:ethr: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: - DID:web

    /// Produces a DID Document for did:web by combining the local key with the supplied domain/path.
    func didWebDocument(
        domain: String,
        pathComponents: [String],
        services: [DIDServiceEndpoint] = [],
        context: LAContext? = nil
    ) -> CardResult<DIDDocument> {
        switch keychain.publicJwk(context: context) {
        case .failure(let error):
            return .failure(error)
        case .success(let jwk):
            let didWeb = makeDidWebIdentifier(domain: domain, pathComponents: pathComponents)
            let descriptor = descriptor(for: didWeb, jwk: jwk)
            return .success(documentForKey(descriptor, services: services))
        }
    }

    // MARK: - Document encoding

    /// Encodes the DID document to JSON data.
    func encodeDocument(_ document: DIDDocument, prettyPrinted: Bool = true) -> CardResult<Data> {
        do {
            let encoder = JSONEncoder()
            var formatting: JSONEncoder.OutputFormatting = [.sortedKeys]
            if prettyPrinted {
                formatting.insert(.prettyPrinted)
            }
            formatting.insert(.withoutEscapingSlashes)
            encoder.outputFormatting = formatting
            return .success(try encoder.encode(document))
        } catch {
            return .failure(.storageError("Failed to encode DID document: \(error.localizedDescription)"))
        }
    }

    // MARK: - Helpers

    private func descriptor(for did: String, jwk: PublicKeyJWK) -> DIDDescriptor {
        let verificationId = "\(did)#\(verificationMethodFragment)"
        return DIDDescriptor(
            did: did,
            verificationMethodId: verificationId,
            jwk: jwk
        )
    }

    private func documentForKey(_ descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) -> DIDDocument {
        DIDDocument(
            context: ["https://www.w3.org/ns/did/v1"],
            id: descriptor.did,
            verificationMethod: [
                DIDDocument.VerificationMethod(
                    id: descriptor.verificationMethodId,
                    type: "JsonWebKey2020",
                    controller: descriptor.did,
                    publicKeyJwk: descriptor.jwk
                )
            ],
            authentication: [descriptor.verificationMethodId],
            assertionMethod: [descriptor.verificationMethodId],
            service: services.isEmpty ? nil : services
        )
    }
    
    private func documentForEthr(_ descriptor: DIDDescriptor, services: [DIDServiceEndpoint]) -> DIDDocument {
        // did:ethr documents are usually resolved from the chain, but for local representation:
        DIDDocument(
            context: ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/secp256k1recovery-2020/v2"],
            id: descriptor.did,
            verificationMethod: [
                DIDDocument.VerificationMethod(
                    id: descriptor.verificationMethodId,
                    type: "EcdsaSecp256k1RecoveryMethod2020",
                    controller: descriptor.did,
                    publicKeyJwk: descriptor.jwk
                )
            ],
            authentication: [descriptor.verificationMethodId],
            assertionMethod: [descriptor.verificationMethodId],
            service: services.isEmpty ? nil : services
        )
    }

    private func makeDidWebIdentifier(domain: String, pathComponents: [String]) -> String {
        let sanitizedDomain = sanitizeDomain(domain)
        let sanitizedPath = pathComponents
            .filter { !$0.isEmpty }
            .map(sanitizePathComponent)
        let joined = ([sanitizedDomain] + sanitizedPath).joined(separator: ":")
        return "did:web:\(joined)"
    }

    private func sanitizeDomain(_ domain: String) -> String {
        var cleaned = domain
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        cleaned = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return cleaned.lowercased()
    }

    private func sanitizePathComponent(_ component: String) -> String {
        let trimmed = component.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return trimmed.addingPercentEncoding(withAllowedCharacters: allowed) ?? trimmed
    }
}

// MARK: - Models

/// Descriptor representing a DID and its associated verification method.
struct DIDDescriptor: Equatable {
    let did: String
    let verificationMethodId: String
    let jwk: PublicKeyJWK
}

/// Minimal DID Document structure suitable for did:key and did:web methods.
struct DIDDocument: Codable, Equatable {
    let context: [String]
    let id: String
    let verificationMethod: [VerificationMethod]
    let authentication: [String]
    let assertionMethod: [String]
    let service: [DIDServiceEndpoint]?

    enum CodingKeys: String, CodingKey {
        case context = "@context"
        case id
        case verificationMethod
        case authentication
        case assertionMethod
        case service
    }

    struct VerificationMethod: Codable, Equatable {
        let id: String
        let type: String
        let controller: String
        let publicKeyJwk: PublicKeyJWK
    }
}

/// DID document service endpoint.
struct DIDServiceEndpoint: Codable, Equatable {
    let id: String
    let type: String
    let serviceEndpoint: String
}
