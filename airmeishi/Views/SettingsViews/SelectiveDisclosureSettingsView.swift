import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct SelectiveDisclosureSettingsView: View {
    @Binding var sharingPreferences: SharingPreferences
    @State private var expirationDays: Int = 30

    var body: some View {
        Form {
            settingsSection
        }
        .onAppear {
            // Enable ZK by default
            sharingPreferences.useZK = true
            // Set expiration days based on current expiration date
            if let expirationDate = sharingPreferences.expirationDate {
                let days = Calendar.current.dateComponents([.day], from: Date(), to: expirationDate).day ?? 30
                expirationDays = max(1, min(365, days))
            }
        }
    }

    private var settingsSection: some View {
        Section {
            Toggle("Allow Forwarding", isOn: $sharingPreferences.allowForwarding)
            
            Picker("Expiration (Days)", selection: $expirationDays) {
                ForEach(Array(stride(from: 1, through: 365, by: 1)), id: \.self) { days in
                    Text("\(days) day\(days == 1 ? "" : "s")")
                        .tag(days)
                }
            }
            .onChange(of: expirationDays) { _, newValue in
                sharingPreferences.expirationDate = Calendar.current.date(byAdding: .day, value: newValue, to: Date())
            }
        }
    }
}

#Preview {
    NavigationView {
        SelectiveDisclosureSettingsView(sharingPreferences: .constant(SharingPreferences()))
    }
}

