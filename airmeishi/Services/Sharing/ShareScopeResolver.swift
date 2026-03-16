import Foundation

enum ShareScopeResolver {
  static func normalizedFields(_ fields: [BusinessCardField]) -> [BusinessCardField] {
    let normalized = Set(fields).union([.name])
    return normalized.sorted { $0.rawValue < $1.rawValue }
  }

  static func scope(
    selectedFields: [BusinessCardField]?,
    legacyLevel: SharingLevel?
  ) -> String {
    if let selectedFields, !selectedFields.isEmpty {
      let joined = normalizedFields(selectedFields).map(\.rawValue).joined(separator: ",")
      return "fields:\(joined)"
    }
    if let legacyLevel {
      return "level:\(legacyLevel.rawValue)"
    }
    return "level:\(SharingLevel.public.rawValue)"
  }
}
