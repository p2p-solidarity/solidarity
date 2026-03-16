import CryptoKit
import Contacts
import Foundation

@MainActor
final class ContactImportService {
  static let shared = ContactImportService()

  private let store = CNContactStore()
  private let importedSource = "imported"
  private init() {}

  func requestPermission() async -> CardResult<Bool> {
    do {
      let granted = try await store.requestAccess(for: .contacts)
      return .success(granted)
    } catch {
      return .failure(.configurationError("Contacts permission failed: \(error.localizedDescription)"))
    }
  }

  // MARK: - VCF File Import

  func importFromVCF(url: URL) -> CardResult<Int> {
    let accessing = url.startAccessingSecurityScopedResource()
    defer { if accessing { url.stopAccessingSecurityScopedResource() } }

    do {
      let data = try Data(contentsOf: url)
      let cnContacts = try CNContactVCardSerialization.contacts(with: data)
      var imported = 0

      for contact in cnContacts {
        let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fullName.isEmpty else { continue }

        let email = (contact.emailAddresses.first?.value as String?)?.nilIfBlank()
        let phone = contact.phoneNumbers.first?.value.stringValue.nilIfBlank()
        let title = contact.jobTitle.nilIfBlank()
        let company = contact.organizationName.nilIfBlank()
        let existing = findExistingContact(
          name: fullName,
          title: title,
          company: company,
          email: email,
          phone: phone
        )
        if let existing, !isImportedLikeSource(existing.source) {
          // Existing contact came from a stronger source (QR/proximity/etc.),
          // so skip imported overwrite and avoid duplicate insertion.
          continue
        }
        let idSeed = importedIdentityKey(
          for: ImportedIdentityInput(
            name: fullName,
            title: title,
            company: company,
            email: email,
            phone: phone,
            externalIdentifier: nil
          )
        )
        let stableID = existing?.id ?? deterministicUUIDString(from: "imported|\(idSeed)")
        let cardID = existing?.cardId ?? deterministicUUIDString(from: "card|\(stableID)")

        let entity = ContactEntity(
          id: stableID,
          cardId: cardID,
          name: fullName,
          title: title ?? existing?.title,
          company: company ?? existing?.company,
          email: email ?? existing?.email,
          phone: phone ?? existing?.phone,
          source: existing?.source ?? importedSource,
          verificationStatus: existing?.verificationStatus ?? VerificationStatus.unverified.rawValue,
          receivedAt: existing?.receivedAt ?? Date(),
          lastInteraction: existing?.lastInteraction,
          tags: existing?.tags ?? [],
          notes: existing?.notes,
          sealedRoute: existing?.sealedRoute,
          pubKey: existing?.pubKey,
          signPubKey: existing?.signPubKey,
          didPublicKey: existing?.didPublicKey,
          exchangeSignature: existing?.exchangeSignature,
          myExchangeSignature: existing?.myExchangeSignature,
          exchangeTimestamp: existing?.exchangeTimestamp,
          myEphemeralMessage: existing?.myEphemeralMessage,
          theirEphemeralMessage: existing?.theirEphemeralMessage,
          graphExportEdgeId: existing?.graphExportEdgeId,
          graphCredentialRef: existing?.graphCredentialRef,
          commonFriendsHandshakeToken: existing?.commonFriendsHandshakeToken
        )

        IdentityDataStore.shared.upsertContact(entity)
        if existing == nil {
          imported += 1
        }
      }

      return .success(imported)
    } catch {
      return .failure(.storageError("Failed to parse VCF file: \(error.localizedDescription)"))
    }
  }

  // MARK: - Phone Contacts Import

  func importContacts(limit: Int = 50) -> CardResult<Int> {
    let keys: [CNKeyDescriptor] = [
      CNContactGivenNameKey as CNKeyDescriptor,
      CNContactFamilyNameKey as CNKeyDescriptor,
      CNContactOrganizationNameKey as CNKeyDescriptor,
      CNContactJobTitleKey as CNKeyDescriptor,
      CNContactEmailAddressesKey as CNKeyDescriptor,
      CNContactPhoneNumbersKey as CNKeyDescriptor,
    ]

    let request = CNContactFetchRequest(keysToFetch: keys)
    var imported = 0
    var scanned = 0

    do {
      try store.enumerateContacts(with: request) { contact, stop in
        if scanned >= limit {
          stop.pointee = true
          return
        }

        let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fullName.isEmpty else { return }
        scanned += 1

        let email = (contact.emailAddresses.first?.value as String?)?.nilIfBlank()
        let phone = contact.phoneNumbers.first?.value.stringValue.nilIfBlank()
        let title = contact.jobTitle.nilIfBlank()
        let company = contact.organizationName.nilIfBlank()
        let existing = findExistingContact(
          name: fullName,
          title: title,
          company: company,
          email: email,
          phone: phone
        )
        if let existing, !isImportedLikeSource(existing.source) {
          // Existing contact came from a stronger source (QR/proximity/etc.),
          // so skip imported overwrite and avoid duplicate insertion.
          return
        }
        let idSeed = importedIdentityKey(
          for: ImportedIdentityInput(
            name: fullName,
            title: title,
            company: company,
            email: email,
            phone: phone,
            externalIdentifier: contact.identifier.nilIfBlank()
          )
        )
        let stableID = existing?.id ?? deterministicUUIDString(from: "imported|\(idSeed)")
        let cardID = existing?.cardId ?? deterministicUUIDString(from: "card|\(stableID)")

        let entity = ContactEntity(
          id: stableID,
          cardId: cardID,
          name: fullName,
          title: title ?? existing?.title,
          company: company ?? existing?.company,
          email: email ?? existing?.email,
          phone: phone ?? existing?.phone,
          source: existing?.source ?? importedSource,
          verificationStatus: existing?.verificationStatus ?? VerificationStatus.unverified.rawValue,
          receivedAt: existing?.receivedAt ?? Date(),
          lastInteraction: existing?.lastInteraction,
          tags: existing?.tags ?? [],
          notes: existing?.notes,
          sealedRoute: existing?.sealedRoute,
          pubKey: existing?.pubKey,
          signPubKey: existing?.signPubKey,
          didPublicKey: existing?.didPublicKey,
          exchangeSignature: existing?.exchangeSignature,
          myExchangeSignature: existing?.myExchangeSignature,
          exchangeTimestamp: existing?.exchangeTimestamp,
          myEphemeralMessage: existing?.myEphemeralMessage,
          theirEphemeralMessage: existing?.theirEphemeralMessage,
          graphExportEdgeId: existing?.graphExportEdgeId,
          graphCredentialRef: existing?.graphCredentialRef,
          commonFriendsHandshakeToken: existing?.commonFriendsHandshakeToken
        )

        IdentityDataStore.shared.upsertContact(entity)
        if existing == nil {
          imported += 1
        }
      }

      return .success(imported)
    } catch {
      return .failure(.storageError("Failed to import contacts: \(error.localizedDescription)"))
    }
  }
}

private extension String {
  func nilIfBlank() -> String? {
    let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

private extension ContactImportService {
  struct ImportedIdentityInput {
    let name: String
    let title: String?
    let company: String?
    let email: String?
    let phone: String?
    let externalIdentifier: String?
  }

  func findExistingContact(
    name: String,
    title: String?,
    company: String?,
    email: String?,
    phone: String?
  ) -> ContactEntity? {
    let normalizedEmail = normalizeEmail(email)
    let normalizedPhone = normalizePhone(phone)
    let normalizedName = normalizeText(name)
    let normalizedCompany = normalizeText(company)
    let normalizedTitle = normalizeText(title)

    return IdentityDataStore.shared.contacts.first { contact in
      if let normalizedEmail,
        normalizeEmail(contact.email) == normalizedEmail
      {
        return true
      }

      if let normalizedPhone,
        normalizePhone(contact.phone) == normalizedPhone
      {
        return true
      }

      guard !normalizedName.isEmpty, normalizeText(contact.name) == normalizedName else {
        return false
      }

      let companyMatches =
        !normalizedCompany.isEmpty && normalizeText(contact.company) == normalizedCompany
      let titleMatches =
        !normalizedTitle.isEmpty && normalizeText(contact.title) == normalizedTitle
      return companyMatches || titleMatches
    }
  }

  func importedIdentityKey(for input: ImportedIdentityInput) -> String {
    if let normalizedEmail = normalizeEmail(input.email), !normalizedEmail.isEmpty {
      return "email:\(normalizedEmail)"
    }
    if let normalizedPhone = normalizePhone(input.phone), !normalizedPhone.isEmpty {
      return "phone:\(normalizedPhone)"
    }
    if let externalIdentifier = input.externalIdentifier, !externalIdentifier.isEmpty {
      return "cn:\(externalIdentifier)"
    }

    let normalizedName = normalizeText(input.name)
    let normalizedCompany = normalizeText(input.company)
    let normalizedTitle = normalizeText(input.title)
    return "name:\(normalizedName)|company:\(normalizedCompany)|title:\(normalizedTitle)"
  }

  func deterministicUUIDString(from seed: String) -> String {
    let digest = SHA256.hash(data: Data(seed.utf8))
    var bytes = Array(digest.prefix(16))

    // RFC 4122 version 4 + variant bits
    bytes[6] = (bytes[6] & 0x0F) | 0x40
    bytes[8] = (bytes[8] & 0x3F) | 0x80

    let hex = bytes.map { String(format: "%02x", $0) }.joined()
    return "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20))"
  }

  func normalizeEmail(_ email: String?) -> String? {
    guard let email else { return nil }
    let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized.isEmpty ? nil : normalized
  }

  func normalizePhone(_ phone: String?) -> String? {
    guard let phone else { return nil }
    let digits = phone.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }
    let normalized = String(String.UnicodeScalarView(digits))
    return normalized.isEmpty ? nil : normalized
  }

  func normalizeText(_ text: String?) -> String {
    guard let text else { return "" }
    return text
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
  }

  func isImportedLikeSource(_ source: String) -> Bool {
    let normalized = source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized == importedSource || normalized == ContactSource.manual.rawValue.lowercased()
  }
}
