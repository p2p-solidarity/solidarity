//
//  GroupCredentialDeliverySettingsView.swift
//  airmeishi
//
//  View for configuring Group VC delivery settings
//

import SwiftUI

struct GroupCredentialDeliverySettingsView: View {
    let group: GroupModel
    @State private var settings = GroupCredentialDeliverySettings()
    
    var body: some View {
        Form {
            Section("Default Method") {
                Picker("Method", selection: $settings.defaultDeliveryMethod) {
                    ForEach(GroupCredentialDeliverySettings.DeliveryMethod.allCases, id: \.self) { method in
                        Text(method.displayName).tag(method)
                    }
                }
            }
            
            Section(header: Text("Proximity Settings")) {
                Toggle("Require PIN", isOn: $settings.requirePIN)
                if settings.requirePIN {
                    SecureField("PIN", text: Binding(
                        get: { settings.pin ?? "" },
                        set: { settings.pin = $0.isEmpty ? nil : $0 }
                    ))
                }
            }
            
            Section(header: Text("Sakura Settings")) {
                Toggle("Encrypt Messages", isOn: $settings.encryptMessages)
            }
        }
        .navigationTitle("Delivery Settings")
    }
}
