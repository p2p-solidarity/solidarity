import Foundation

enum ShareScopeResolver {
  static func normalizedFields(_ fields: [BusinessCardField]) -> [BusinessCardField] {
    let normalized = Set(fields).union([.name])
    return normalized.sorted { $0.rawValue < $1.rawValue }
  }

  static func scope(selectedFields: [BusinessCardField]) -> String {
    let joined = normalizedFields(selectedFields).map(\.rawValue).joined(separator: ",")
    return "fields:\(joined)"
  }

  static func scope(
    selectedFields: [BusinessCardField]?,
    legacyLevel: SharingLevel?
  ) -> String {
    if let selectedFields, !selectedFields.isEmpty {
      return scope(selectedFields: selectedFields)
    }
    // Legacy fallback: keep semantic scope stable by pinning to minimum field set.
    _ = legacyLevel
    return scope(selectedFields: [.name])
  }
}
