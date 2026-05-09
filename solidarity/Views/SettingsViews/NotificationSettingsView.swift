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
      "IN-APP NOTIFICATIONS",
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
      "REMOTE NOTIFICATIONS",
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
      "SYNC SETTINGS",
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
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(Color.Theme.terminalGreen)
        .frame(width: 24)

      Text("Sync Interval")
        .font(.system(size: 14, weight: .bold))
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
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)
          Image(systemName: "chevron.up.chevron.down")
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(Color.Theme.textPlaceholder)
        }
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  private var currentSyncIntervalLabel: String {
    NotificationSettingsManager.syncIntervalOptions
      .first(where: { $0.seconds == settings.syncIntervalSeconds })?
      .label
      ?? "—"
  }

  private var resetSection: some View {
    SettingsBlockSection("RESET") {
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
