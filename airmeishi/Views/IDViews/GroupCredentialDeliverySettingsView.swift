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
    
    private var storageKey: String { "group_delivery_settings_\(group.id)" }
    
    var body: some View {
        Form {
            Section(header: Text("Default Method"), footer: Text("These settings only affect how you, as an issuer, deliver Group VCs.")) {
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
        .onAppear {
            if let data = UserDefaults.standard.data(forKey: storageKey),
               let decoded = try? JSONDecoder().decode(GroupCredentialDeliverySettings.self, from: data) {
                settings = decoded
            }
        }
        .onDisappear {
            if let encoded = try? JSONEncoder().encode(settings) {
                UserDefaults.standard.set(encoded, forKey: storageKey)
            }
        }
    }
}
