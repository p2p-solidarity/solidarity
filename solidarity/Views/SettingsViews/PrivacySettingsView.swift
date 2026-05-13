import SwiftUI

struct PrivacySettingsView: View {
  @Binding var sharingPreferences: SharingPreferences
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      SelectiveDisclosureSettingsView(sharingPreferences: $sharingPreferences)
        .navigationTitle("Privacy Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          SettingsBackToolbar { dismiss() }
        }
    }
  }
}

#Preview {
  PrivacySettingsView(sharingPreferences: .constant(SharingPreferences()))
}
