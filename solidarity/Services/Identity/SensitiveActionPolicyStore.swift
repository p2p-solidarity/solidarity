import Foundation

final class SensitiveActionPolicyStore: ObservableObject {
  static let shared = SensitiveActionPolicyStore()

  @Published private(set) var requirements: [String: Bool] = [:]
  private let defaults = UserDefaults.standard

  private init() {
    SensitiveAction.allCases.forEach { action in
      let key = storageKey(for: action)
      if defaults.object(forKey: key) == nil {
        defaults.set(true, forKey: key)
      }
      requirements[action.rawValue] = defaults.bool(forKey: key)
    }
  }

  func requiresBiometric(_ action: SensitiveAction) -> Bool {
    requirements[action.rawValue] ?? true
  }

  func setRequirement(_ enabled: Bool, for action: SensitiveAction) {
    requirements[action.rawValue] = enabled
    defaults.set(enabled, forKey: storageKey(for: action))
  }

  private func storageKey(for action: SensitiveAction) -> String {
    "solidarity.security.faceid.\(action.rawValue)"
  }
}
