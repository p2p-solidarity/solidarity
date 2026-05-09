//
//  NotificationSettingsView.swift
//  solidarity
//
//  Notification settings UI for managing Sakura message notifications
//

import SwiftUI

struct NotificationSettingsView: View {
  @StateObject private var settings = NotificationSettingsManager.shared

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
        inAppSection
        remoteSection
        syncSection
        resetSection
      }
      .padding(.vertical, 24)
    }
    .background(Color.Theme.pageBg.ignoresSafeArea())
    .navigationTitle("Notifications")
    .navigationBarTitleDisplayMode(.inline)
  }

  // MARK: - Sections

  private var inAppSection: some View {
    SettingsBlockSection(
      "In-App Notifications",
      footer: "Toast notifications appear at the top of the screen when the app is in foreground."
    ) {
      SettingsBlockToggleRow(
        icon: "bell.badge.fill",
        title: "In-App Toast",
        subtitle: "Show toast when Sakura message arrives",
        isOn: $settings.enableInAppToast
      )
    }
  }

  private var remoteSection: some View {
    SettingsBlockSection(
      "Remote Notifications",
      footer: "When disabled, you won't receive push notifications from other users sending Sakura messages."
    ) {
      SettingsBlockToggleRow(
        icon: "iphone.radiowaves.left.and.right",
        title: "Remote Notifications",
        subtitle: "Receive push notifications from others",
        isOn: $settings.enableRemoteNotification
      )

      Button { openSystemNotificationSettings() } label: {
        SettingsBlockRow(
          icon: "gearshape",
          title: "System Notification Settings",
          trailingText: "Open"
        )
      }
      .buttonStyle(.plain)
    }
  }

  private var syncSection: some View {
    SettingsBlockSection(
      "Sync Settings",
      footer: "Auto-sync periodically checks for new messages. Higher intervals reduce battery and network usage."
    ) {
      SettingsBlockToggleRow(
        icon: "arrow.triangle.2.circlepath",
        title: "Auto-Sync",
        subtitle: "Automatically check for new messages",
        isOn: $settings.enableAutoSync
      )

      if settings.enableAutoSync {
        syncIntervalRow
      }
    }
  }

  private var syncIntervalRow: some View {
    HStack(spacing: 12) {
      Image(systemName: "timer")
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.textPrimary)
        .frame(width: 20, height: 20)

      Text("Sync Interval")
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Menu {
        Picker("Sync Interval", selection: $settings.syncIntervalSeconds) {
          ForEach(NotificationSettingsManager.syncIntervalOptions, id: \.seconds) { option in
            Text(option.label).tag(option.seconds)
          }
        }
      } label: {
        HStack(spacing: 6) {
          Text(currentSyncIntervalLabel)
            .font(.system(size: 13))
            .foregroundColor(Color.Theme.textSecondary)
          Image(systemName: "chevron.up.chevron.down")
            .font(.system(size: 11))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
  }

  private var currentSyncIntervalLabel: String {
    NotificationSettingsManager.syncIntervalOptions
      .first(where: { $0.seconds == settings.syncIntervalSeconds })?
      .label
      ?? "—"
  }

  private var resetSection: some View {
    SettingsBlockSection("Reset") {
      Button { settings.resetToDefaults() } label: {
        SettingsBlockDangerRow(
          icon: "arrow.counterclockwise",
          title: "Reset to Defaults"
        )
      }
      .buttonStyle(.plain)
    }
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
