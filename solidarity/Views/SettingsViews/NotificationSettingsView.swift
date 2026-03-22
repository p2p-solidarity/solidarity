//
//  NotificationSettingsView.swift
//  airmeishi
//
//  Notification settings UI for managing Sakura message notifications
//

import SwiftUI

struct NotificationSettingsView: View {
  @StateObject private var settings = NotificationSettingsManager.shared
  @State private var showingSystemSettings = false

  var body: some View {
    Form {
      // MARK: - In-App Notifications

      Section {
        Toggle(isOn: $settings.enableInAppToast) {
          Label {
            VStack(alignment: .leading, spacing: 4) {
              Text("In-App Toast")
              Text("Show toast when Sakura message arrives")
                .font(.caption)
                .foregroundColor(.secondary)
            }
          } icon: {
            Image(systemName: "bell.badge.fill")
              .foregroundColor(.pink)
          }
        }
      } header: {
        Text("In-App Notifications")
      } footer: {
        Text("Toast notifications appear at the top of the screen when the app is in foreground.")
      }

      // MARK: - Remote Notifications

      Section {
        Toggle(isOn: $settings.enableRemoteNotification) {
          Label {
            VStack(alignment: .leading, spacing: 4) {
              Text("Remote Notifications")
              Text("Receive push notifications from others")
                .font(.caption)
                .foregroundColor(.secondary)
            }
          } icon: {
            Image(systemName: "iphone.radiowaves.left.and.right")
              .foregroundColor(.blue)
          }
        }

        Button {
          openSystemNotificationSettings()
        } label: {
          HStack {
            Label("System Notification Settings", systemImage: "gear")
            Spacer()
            Image(systemName: "arrow.up.forward.app")
              .font(.caption)
              .foregroundColor(.secondary)
          }
        }
      } header: {
        Text("Remote Notifications")
      } footer: {
        Text("When disabled, you won't receive push notifications from other users sending Sakura messages.")
      }

      // MARK: - Sync Settings

      Section {
        Toggle(isOn: $settings.enableAutoSync) {
          Label {
            VStack(alignment: .leading, spacing: 4) {
              Text("Auto-Sync")
              Text("Automatically check for new messages")
                .font(.caption)
                .foregroundColor(.secondary)
            }
          } icon: {
            Image(systemName: "arrow.triangle.2.circlepath")
              .foregroundColor(.green)
          }
        }

        if settings.enableAutoSync {
          Picker(selection: $settings.syncIntervalSeconds) {
            ForEach(NotificationSettingsManager.syncIntervalOptions, id: \.seconds) { option in
              Text(option.label).tag(option.seconds)
            }
          } label: {
            Label("Sync Interval", systemImage: "timer")
          }
        }
      } header: {
        Text("Sync Settings")
      } footer: {
        Text("Auto-sync periodically checks for new messages. Higher intervals reduce battery and network usage.")
      }

      // MARK: - Reset

      Section {
        Button(role: .destructive) {
          settings.resetToDefaults()
        } label: {
          Label("Reset to Defaults", systemImage: "arrow.counterclockwise")
        }
      }
    }
    .navigationTitle("Notifications")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func openSystemNotificationSettings() {
    if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
      UIApplication.shared.open(url)
    }
  }
}

#Preview {
  NavigationStack {
    NotificationSettingsView()
  }
}
