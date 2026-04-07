//
//  GroupCredentialDeliverySettingsView.swift
//  solidarity
//
//  View for configuring Group VC delivery settings
//

import SwiftUI

struct GroupCredentialDeliverySettingsView: View {
  let group: GroupModel
  @State private var settings = GroupCredentialDeliverySettings()

  private var storageKey: String { "group_delivery_settings_\(group.id)" }

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        // MARK: - Default Method
        VStack(alignment: .leading, spacing: 8) {
          Text("DEFAULT METHOD")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)

          VStack(alignment: .leading, spacing: 8) {
            Picker("Method", selection: $settings.defaultDeliveryMethod) {
              ForEach(GroupCredentialDeliverySettings.DeliveryMethod.allCases, id: \.self) { method in
                Text(method.displayName).tag(method)
              }
            }
            .tint(Color.Theme.primaryBlue)
          }
          .padding(16)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))

          Text("These settings only affect how you, as an issuer, deliver Group VCs.")
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }

        // MARK: - Proximity Settings
        VStack(alignment: .leading, spacing: 8) {
          Text("PROXIMITY SETTINGS")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)

          VStack(alignment: .leading, spacing: 12) {
            Toggle("Require PIN", isOn: $settings.requirePIN)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
              .tint(Color.Theme.primaryBlue)
            if settings.requirePIN {
              SecureField(
                "PIN",
                text: Binding(
                  get: { settings.pin ?? "" },
                  set: { settings.pin = $0.isEmpty ? nil : $0 }
                )
              )
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
            }
          }
          .padding(16)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }

        // MARK: - Sakura Settings
        VStack(alignment: .leading, spacing: 8) {
          Text("SAKURA SETTINGS")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)

          VStack(alignment: .leading, spacing: 8) {
            Toggle("Encrypt Messages", isOn: $settings.encryptMessages)
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.textPrimary)
              .tint(Color.Theme.primaryBlue)
          }
          .padding(16)
          .background(Color.Theme.searchBg)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
      }
      .padding(16)
    }
    .background(Color.Theme.pageBg)
    .navigationTitle("Delivery Settings")
    .onAppear {
      if let data = UserDefaults.standard.data(forKey: storageKey),
        let decoded = try? JSONDecoder().decode(GroupCredentialDeliverySettings.self, from: data)
      {
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
