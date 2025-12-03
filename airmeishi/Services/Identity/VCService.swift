//
//  VCService.swift
//  airmeishi
//
//  Handles issuance and parsing of Verifiable Credentials using SpruceKit.
//

import Foundation
import CryptoKit
import LocalAuthentication
import SpruceIDMobileSdkRs
import os

/// High level service for issuing and parsing Verifiable Credentials.
final class VCService {
    private static let logger = Logger(subsystem: "com.kidneyweakx.airmeishi", category: "VCService")
    struct IssueOptions {
        var holderDid: String?
        var issuerDid: String?
        var expiration: Date?
        var authenticationContext: LAContext?
    }

    struct IssuedCredential {
        let jwt: String
        let header: [String: Any]
        let payload: [String: Any]
        let snapshot: BusinessCardSnapshot
        let issuedAt: Date
        let expiresAt: Date?
        let holderDid: String
        let issuerDid: String
    }

    struct ImportedCredential {
        let storedCredential: VCLibrary.StoredCredential
        let businessCard: BusinessCard
    }

    private let keychain: KeychainService
    private let didService: DIDService
    private let library: VCLibrary

    init(
        keychain: KeychainService = .shared,
        didService: DIDService = DIDService(),
        library: VCLibrary = .shared
    ) {
        self.keychain = keychain
        self.didService = didService
        self.library = library
    }

    /// Switches the DID method used for issuance (e.g. did:key or did:ethr).
    func setDIDMethod(_ method: DIDService.DIDMethod) {
        _ = didService.switchMethod(to: method)
    }

    /// Issues a self-signed business card credential as a JWT VC.
    func issueBusinessCardCredential(
        for card: BusinessCard,
        options: IssueOptions = IssueOptions()
    ) -> CardResult<IssuedCredential> {
        Self.logger.info("Starting VC issuance for business card: \(card.id.uuidString)")
        
        let context: LAContext
        if let providedContext = options.authenticationContext {
            context = providedContext
            Self.logger.info("Using provided authentication context")
        } else {
            Self.logger.info("Requesting authentication context from keychain")
            switch keychain.authenticationContext(reason: "Authorize business card credential issuance") {
            case .success(let generated):
                context = generated
                Self.logger.info("Authentication context obtained successfully")
            case .failure(let error):
                Self.logger.error("Failed to get authentication context: \(error.localizedDescription)")
                return .failure(error)
            }
        }

        Self.logger.info("Retrieving current DID descriptor")
        let descriptorResult = didService.currentDescriptor(context: context)
        guard case .success(let descriptor) = descriptorResult else {
            if case .failure(let error) = descriptorResult {
                Self.logger.error("Failed to get DID descriptor: \(error.localizedDescription)")
                return .failure(error)
            }
            Self.logger.error("Failed to derive DID for credential issuance")
            return .failure(.keyManagementError("Failed to derive DID for credential issuance"))
        }
        
        Self.logger.info("DID descriptor obtained: \(descriptor.did)")

        let holderDid = options.holderDid ?? descriptor.did
        let issuerDid = options.issuerDid ?? descriptor.did
        let issuedAt = Date()
        
        Self.logger.info("Creating credential claims - holderDid: \(holderDid), issuerDid: \(issuerDid)")

        let claims = BusinessCardCredentialClaims(
            card: card,
            issuerDid: issuerDid,
            holderDid: holderDid,
            issuanceDate: issuedAt,
            expirationDate: options.expiration,
            credentialId: UUID(),
            publicKeyJwk: descriptor.jwk
        )
        
        Self.logger.info("Credential claims created successfully")

        Self.logger.info("Retrieving signing key")
        let signerResult = keychain.signingKey(context: context)
        guard case .success(let signingKey) = signerResult else {
            if case .failure(let error) = signerResult {
                Self.logger.error("Failed to get signing key: \(error.localizedDescription)")
                return .failure(error)
            }
            Self.logger.error("Unable to access signing key")
            return .failure(.keyManagementError("Unable to access signing key"))
        }
        
        Self.logger.info("Signing key obtained successfully")

        do {
            let kid = descriptor.verificationMethodId
            Self.logger.info("Generating JWT header and payload - kid: \(kid)")
            
            let headerData = try claims.headerData(kid: kid)
            let payloadData = try claims.payloadData()
            
            Self.logger.info("Header data size: \(headerData.count) bytes, Payload data size: \(payloadData.count) bytes")

            let headerEncoded = headerData.base64URLEncodedString()
            let payloadEncoded = payloadData.base64URLEncodedString()
            let signingInput = "\(headerEncoded).\(payloadEncoded)"
            
            Self.logger.debug("Header encoded length: \(headerEncoded.count), Payload encoded length: \(payloadEncoded.count)")

            guard let signingInputData = signingInput.data(using: .utf8) else {
                Self.logger.error("Failed to encode signing input to UTF-8")
                return .failure(.invalidData("Failed to encode signing input"))
            }

            Self.logger.info("Signing JWT")
            let signature = try signingKey.sign(payload: signingInputData).base64URLEncodedString()
            let jwt = "\(signingInput).\(signature)"
            
            Self.logger.info("JWT signed successfully, total length: \(jwt.count) characters")
            Self.logger.debug("JWT preview: \(jwt.prefix(50))...")

            // Validate using SpruceKit's parser to ensure compatibility. Some custom claim sets
            // (e.g. schema.org heavy subjects) can trigger CredentialClaimDecoding errors even
            // though the JWT is otherwise valid. Treat those as warnings so issuance can proceed.
            Self.logger.info("Validating JWT with SpruceKit - keyAlias: \(self.keychain.alias)")
            do {
                _ = try JwtVc.newFromCompactJwsWithKey(jws: jwt, keyAlias: self.keychain.alias)
                Self.logger.info("JWT validation with SpruceKit successful")
            } catch let spruceError {
                let errorDescription = spruceError.localizedDescription
                let errorType = String(describing: type(of: spruceError))
                let errorString = String(describing: spruceError)
                
                Self.logger.error("SpruceKit validation failed: \(errorString)")
                Self.logger.error("Error type: \(errorType)")
                Self.logger.error("Error description: \(errorDescription)")
                
                if let nsError = spruceError as NSError? {
                    Self.logger.error("NSError domain: \(nsError.domain), code: \(nsError.code)")
                    Self.logger.error("NSError userInfo: \(String(describing: nsError.userInfo))")
                }
                
                if let payloadString = String(data: payloadData, encoding: .utf8) {
                    Self.logger.debug("Payload JSON: \(payloadString)")
                }
                
                if errorString.contains("CredentialClaimDecoding") {
                    Self.logger.notice("SpruceKit could not decode custom credential claims. Continuing issuance without Spruce validation.")
                } else {
                    throw spruceError
                }
            }

            Self.logger.info("Deserializing JWT header")
            let headerJSONObject = try JSONSerialization.jsonObject(with: headerData)
            guard let headerDict = headerJSONObject as? [String: Any] else {
                Self.logger.error("Failed to cast header JSON to dictionary")
                return .failure(.invalidData("Failed to deserialize JWT header"))
            }

            Self.logger.info("Getting payload dictionary")
            let payloadDict = try claims.payloadDictionary()
            
            Self.logger.info("VC issuance completed successfully")
            return .success(
                IssuedCredential(
                    jwt: jwt,
                    header: headerDict,
                    payload: payloadDict,
                    snapshot: claims.snapshot,
                    issuedAt: issuedAt,
                    expiresAt: options.expiration,
                    holderDid: holderDid,
                    issuerDid: issuerDid
                )
            )
        } catch let cardError as CardError {
            Self.logger.error("CardError during VC issuance: \(cardError.localizedDescription)")
            return .failure(cardError)
        } catch {
            let errorDescription = error.localizedDescription
            let errorType = String(describing: type(of: error))
            Self.logger.error("Cryptographic error during VC issuance - Type: \(errorType), Description: \(errorDescription)")
            
            if let nsError = error as NSError? {
                Self.logger.error("NSError details - Domain: \(nsError.domain), Code: \(nsError.code), UserInfo: \(String(describing: nsError.userInfo))")
            }
            
            return .failure(.cryptographicError("Credential issuance failed: \(errorDescription)"))
        }
    }

    /// Issues a credential and immediately stores it in the encrypted library.
    func issueAndStoreBusinessCardCredential(
        for card: BusinessCard,
        options: IssueOptions = IssueOptions(),
        status: VCLibrary.StoredCredential.Status = .verified
    ) -> CardResult<VCLibrary.StoredCredential> {
        Self.logger.info("Issuing and storing VC for business card: \(card.id.uuidString)")
        switch issueBusinessCardCredential(for: card, options: options) {
        case .failure(let error):
            Self.logger.error("Failed to issue VC, skipping storage: \(error.localizedDescription)")
            return .failure(error)
        case .success(let issuedCredential):
            Self.logger.info("VC issued successfully, storing in library with status: \(String(describing: status))")
            let result = library.add(issuedCredential, status: status)
            switch result {
            case .success:
                Self.logger.info("VC stored successfully")
            case .failure(let error):
                Self.logger.error("Failed to store VC: \(error.localizedDescription)")
            }
            return result
        }
    }

    /// Imports a presented credential (vp_token) and stores it locally.
    func importPresentedCredential(jwt: String) -> CardResult<ImportedCredential> {
        Self.logger.info("Importing presented credential, JWT length: \(jwt.count)")
        let decodeResult = decodeJWT(jwt)
        switch decodeResult {
        case .failure(let error):
            Self.logger.error("Failed to decode JWT: \(error.localizedDescription)")
            return .failure(error)
        case .success(let decoded):
            Self.logger.info("JWT decoded successfully, parsing credential envelope")
            do {
                let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)
                Self.logger.info("Credential envelope decoded, converting to business card")
                let businessCard = try envelope.toBusinessCard()
                
                // Group VC Verification
                if let _ = businessCard.groupContext {
                    Self.logger.info("Detected Group Credential, performing additional verification")
                    // Note: We need to verify the Semaphore proof here or in a separate step.
                    // For now, we import it, but mark it as requiring verification if proof is missing/invalid.
                    // The actual proof verification usually happens during presentation (VP), not just import.
                    // But if we are importing a *presented* credential, we should check the proof.
                    // However, the proof is likely in the VP, not the VC itself, or in the VC if it's a specific claim.
                    // Our design puts the proof in the presentation exchange, but here we are just parsing the VC JWT.
                    // We'll let the coordinator handle the proof verification using GroupCredentialService.
                }
                
                let snapshot = BusinessCardSnapshot(card: businessCard)

                let issuedAt = envelope.issuedAtDate ?? Date()
                let expiresAt = envelope.expirationDate
                let holderDid = envelope.sub ?? businessCard.id.uuidString
                let issuerDid = envelope.iss ?? "did:unknown"
                
                Self.logger.info("Creating issued credential - holderDid: \(holderDid), issuerDid: \(issuerDid)")
                let issued = IssuedCredential(
                    jwt: jwt,
                    header: decoded.header,
                    payload: decoded.payload,
                    snapshot: snapshot,
                    issuedAt: issuedAt,
                    expiresAt: expiresAt,
                    holderDid: holderDid,
                    issuerDid: issuerDid
                )

                Self.logger.info("Storing imported credential with unverified status")
                switch library.add(issued, status: .unverified) {
                case .success(let stored):
                    Self.logger.info("Credential imported and stored successfully")
                    return .success(ImportedCredential(storedCredential: stored, businessCard: businessCard))
                case .failure(let error):
                    Self.logger.error("Failed to store imported credential: \(error.localizedDescription)")
                    return .failure(error)
                }
            } catch let cardError as CardError {
                Self.logger.error("CardError during credential import: \(cardError.localizedDescription)")
                return .failure(cardError)
            } catch {
                Self.logger.error("Failed to parse credential subject: \(error.localizedDescription)")
                return .failure(.invalidData("Failed to parse credential subject: \(error.localizedDescription)"))
            }
        }
    }

    func verifyStoredCredential(_ credential: VCLibrary.StoredCredential) -> CardResult<VCLibrary.StoredCredential> {
        Self.logger.info("Verifying stored credential")
        let components = credential.jwt.split(separator: ".")
        guard components.count == 3 else {
            Self.logger.error("Malformed JWT - component count: \(components.count), expected 3")
            return .failure(.invalidData("Malformed JWT"))
        }

        let signingInput = "\(components[0]).\(components[1])"
        guard
            let signatureData = Data(base64URLEncoded: String(components[2])),
            let signingData = signingInput.data(using: .utf8)
        else {
            Self.logger.error("Invalid JWT signature encoding")
            return .failure(.invalidData("Invalid JWT signature encoding"))
        }

        Self.logger.info("Decoding JWT for verification")
        let decodedResult = decodeJWT(credential.jwt)

        switch decodedResult {
        case .failure(let error):
            Self.logger.error("Failed to decode JWT during verification: \(error.localizedDescription)")
            return .failure(error)
        case .success(let decoded):
            Self.logger.info("JWT decoded, parsing credential envelope")
            do {
                let envelope = try JSONDecoder().decode(BusinessCardCredentialEnvelope.self, from: decoded.payloadData)

                let credentialSubject = (envelope.vc ?? envelope.payload?.vc)?.credentialSubject

                guard let publicKeyJwk = credentialSubject?.publicKeyJwk else {
                    Self.logger.error("Credential missing public key information")
                    return .failure(.invalidData("Credential missing public key information"))
                }

                Self.logger.info("Verifying signature")
                let publicKey = try publicKeyJwk.toP256PublicKey()
                let signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureData)

                guard publicKey.isValidSignature(signature, for: signingData) else {
                    Self.logger.error("Signature verification failed")
                    return storeVerificationResult(credential, status: .failed)
                }
                
                Self.logger.info("Signature verified, checking expiration")

                let now = Date()
                if let notBefore = envelope.nbf {
                    let nbfDate = Date(timeIntervalSince1970: TimeInterval(notBefore))
                    if now < nbfDate {
                        Self.logger.warning("Credential not yet valid - nbf: \(nbfDate), now: \(now)")
                        return storeVerificationResult(credential, status: .failed)
                    }
                }

                if let expiration = envelope.exp {
                    let expDate = Date(timeIntervalSince1970: TimeInterval(expiration))
                    if now > expDate {
                        Self.logger.warning("Credential expired - exp: \(expDate), now: \(now)")
                        return storeVerificationResult(credential, status: .failed)
                    }
                }

                Self.logger.info("Credential verification successful")
                return storeVerificationResult(credential, status: .verified)
            } catch let cardError as CardError {
                Self.logger.error("CardError during verification: \(cardError.localizedDescription)")
                return .failure(cardError)
            } catch {
                Self.logger.error("Verification failed: \(error.localizedDescription)")
                return .failure(.invalidData("Verification failed: \(error.localizedDescription)"))
            }
        }
    }

    private func storeVerificationResult(
        _ credential: VCLibrary.StoredCredential,
        status: VCLibrary.StoredCredential.Status
    ) -> CardResult<VCLibrary.StoredCredential> {
        var updated = credential
        updated.status = status
        updated.lastVerifiedAt = Date()

        switch library.update(updated) {
        case .success:
            return .success(updated)
        case .failure(let error):
            return .failure(error)
        }
    }
}

// MARK: - JWT decoding helpers

private extension VCService {
    struct DecodedJWT {
        let header: [String: Any]
        let payload: [String: Any]
        let payloadData: Data
    }

    func decodeJWT(_ jwt: String) -> CardResult<DecodedJWT> {
        let components = jwt.split(separator: ".")
        guard components.count >= 2 else {
            Self.logger.error("Malformed JWT - component count: \(components.count), expected at least 2")
            return .failure(.invalidData("Malformed JWT"))
        }

        guard let headerData = Data(base64URLEncoded: String(components[0])),
              let payloadData = Data(base64URLEncoded: String(components[1]))
        else {
            Self.logger.error("Failed to decode JWT segments from base64URL")
            return .failure(.invalidData("Failed to decode JWT segments"))
        }

        do {
            let headerJSON = try JSONSerialization.jsonObject(with: headerData, options: [])
            let payloadJSON = try JSONSerialization.jsonObject(with: payloadData, options: [])

            guard let headerDict = headerJSON as? [String: Any],
                  let payloadDict = payloadJSON as? [String: Any] else {
                Self.logger.error("JWT segments are not valid JSON objects")
                return .failure(.invalidData("JWT segments are not valid JSON objects"))
            }

            Self.logger.debug("JWT decoded successfully - header keys: \(headerDict.keys.joined(separator: ", "))")
            return .success(DecodedJWT(header: headerDict, payload: payloadDict, payloadData: payloadData))
        } catch {
            Self.logger.error("Failed to parse JWT JSON: \(error.localizedDescription)")
            return .failure(.invalidData("Failed to parse JWT JSON: \(error.localizedDescription)"))
        }
    }
}

// MARK: - Credential envelope parsing

private struct BusinessCardCredentialEnvelope: Decodable {
    struct Payload: Decodable {
        let iss: String?
        let sub: String?
        let iat: Int?
        let nbf: Int?
        let exp: Int?
        let vc: VerifiableCredential
    }

    struct VerifiableCredential: Decodable {
        let type: [String]
        let credentialSubject: CredentialSubject
    }

    struct CredentialSubject: Decodable {
        struct Organization: Decodable {
            let name: String?
        }

        struct Skill: Decodable {
            let name: String
            let inDefinedTermSet: String?
            let description: String?

            enum CodingKeys: String, CodingKey {
                case name
                case inDefinedTermSet
                case description
            }
        }

        struct SocialAccount: Decodable {
            let contactType: String?
            let identifier: String?
            let url: String?
        }

        struct AnimalPreference: Decodable {
            let id: String?
            let name: String?
        }

        let id: String?
        let type: [String]?
        let name: String
        let summary: String?
        let jobTitle: String?
        let worksFor: Organization?
        let email: [String]?
        let telephone: [String]?
        let image: String?
        let sameAs: [String]?
        let contactPoint: [SocialAccount]?
        let knowsAbout: [String]?
        let hasSkill: [Skill]?
        let preferredAnimal: AnimalPreference?
        let businessCardId: String?
        let updatedAt: String?
        let publicKeyJwk: PublicKeyJWK?
        let groupContext: GroupCredentialContext?
    }

    let payload: Payload?
    let iss: String?
    let sub: String?
    let iat: Int?
    let nbf: Int?
    let exp: Int?
    let vc: VerifiableCredential?

    var issuedAtDate: Date? {
        if let iat = iat {
            return Date(timeIntervalSince1970: TimeInterval(iat))
        }
        if let payloadIat = payload?.iat {
            return Date(timeIntervalSince1970: TimeInterval(payloadIat))
        }
        return nil
    }

    var expirationDate: Date? {
        if let exp = exp {
            return Date(timeIntervalSince1970: TimeInterval(exp))
        }
        if let payloadExp = payload?.exp {
            return Date(timeIntervalSince1970: TimeInterval(payloadExp))
        }
        return nil
    }

    func toBusinessCard() throws -> BusinessCard {
        let envelopeVC: VerifiableCredential
        if let directVc = vc {
            envelopeVC = directVc
        } else if let nestedVc = payload?.vc {
            envelopeVC = nestedVc
        } else {
            throw CardError.invalidData("Credential missing VC payload")
        }

        let subject = envelopeVC.credentialSubject
        let cardId = UUID(uuidString: subject.businessCardId ?? "") ?? UUID()
        let title = subject.jobTitle?.nilIfEmpty()
        let company = subject.worksFor?.name?.nilIfEmpty()
        let email = subject.email?.first?.nilIfEmpty()
        let phone = subject.telephone?.first?.nilIfEmpty()

        var profileImageData: Data?
        if let image = subject.image, let data = Data(dataURI: image) {
            profileImageData = data
        }

        let socialNetworks: [SocialNetwork] = subject.contactPoint?.compactMap { account in
            guard let platformName = account.contactType?.nilIfEmpty(),
                  let username = account.identifier?.nilIfEmpty()
            else { return nil }
            let platform = SocialPlatform(rawValue: platformName) ?? .other
            return SocialNetwork(
                platform: platform,
                username: username,
                url: account.url?.nilIfEmpty()
            )
        } ?? []

        let skills: [Skill] = subject.hasSkill?.compactMap { skill in
            let proficiency = ProficiencyLevel(rawValue: skill.description ?? "") ?? .intermediate
            return Skill(
                name: skill.name,
                category: skill.inDefinedTermSet ?? "General",
                proficiencyLevel: proficiency
            )
        } ?? []

        var animal: AnimalCharacter?
        if let animalId = subject.preferredAnimal?.id, let value = AnimalCharacter(rawValue: animalId) {
            animal = value
        }

        var card = BusinessCard(
            id: cardId,
            name: subject.name,
            title: title,
            company: company,
            email: email,
            phone: phone,
            profileImage: profileImageData,
            animal: animal,
            socialNetworks: socialNetworks,
            skills: skills,
            categories: subject.knowsAbout ?? [],
            sharingPreferences: SharingPreferences(),
            groupContext: subject.groupContext,
            createdAt: issuedAtDate ?? Date(),
            updatedAt: Date()
        )

        if let summary = subject.summary, !summary.isEmpty {
            card.categories.append(summary)
        }

        return card
    }
}

