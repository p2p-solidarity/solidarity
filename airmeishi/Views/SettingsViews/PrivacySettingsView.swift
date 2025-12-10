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
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

#Preview {
    PrivacySettingsView(sharingPreferences: .constant(SharingPreferences()))
}

