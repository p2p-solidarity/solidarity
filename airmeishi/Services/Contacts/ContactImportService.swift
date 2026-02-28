import Contacts
import Foundation

@MainActor
final class ContactImportService {
  static let shared = ContactImportService()

  private let store = CNContactStore()
  private init() {}

  func requestPermission() async -> CardResult<Bool> {
    do {
      let granted = try await store.requestAccess(for: .contacts)
      return .success(granted)
    } catch {
      return .failure(.configurationError("Contacts permission failed: \(error.localizedDescription)"))
    }
  }

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

    do {
      try store.enumerateContacts(with: request) { contact, stop in
        if imported >= limit {
          stop.pointee = true
          return
        }

        let fullName = "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !fullName.isEmpty else { return }

        let entity = ContactEntity(
          cardId: UUID().uuidString,
          name: fullName,
          title: contact.jobTitle.nilIfBlank(),
          company: contact.organizationName.nilIfBlank(),
          email: contact.emailAddresses.first?.value as String?,
          phone: contact.phoneNumbers.first?.value.stringValue,
          source: ContactSource.manual.rawValue,
          verificationStatus: VerificationStatus.unverified.rawValue
        )

        IdentityDataStore.shared.upsertContact(entity)
        imported += 1
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
