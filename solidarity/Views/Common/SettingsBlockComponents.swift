import SwiftUI

// MARK: - Section Header

struct SettingsBlockSectionHeader: View {
  let title: String

  var body: some View {
    Text("[ \(title) ]")
      .font(.system(size: 12, weight: .bold, design: .monospaced))
      .foregroundColor(Color.Theme.textSecondary)
      .padding(.horizontal, 24)
  }
}

// MARK: - Section Container

struct SettingsBlockSection<Content: View>: View {
  let title: String
  let footer: String?
  @ViewBuilder let content: Content

  init(_ title: String, footer: String? = nil, @ViewBuilder content: () -> Content) {
    self.title = title
    self.footer = footer
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SettingsBlockSectionHeader(title: title)

      VStack(spacing: 8) {
        content
      }
      .padding(.horizontal, 16)

      if let footer {
        Text(footer)
          .font(.system(size: 10, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 24)
      }
    }
  }
}

// MARK: - Standard Row (icon in front, optional trailing text + chevron)

struct SettingsBlockRow: View {
  let icon: String
  let title: String
  let subtitle: String?
  let trailingText: String?
  let showsChevron: Bool
  let iconColor: Color
  let titleColor: Color

  init(
    icon: String,
    title: String,
    subtitle: String? = nil,
    trailingText: String? = nil,
    showsChevron: Bool = true,
    iconColor: Color = Color.Theme.terminalGreen,
    titleColor: Color = Color.Theme.textPrimary
  ) {
    self.icon = icon
    self.title = title
    self.subtitle = subtitle
    self.trailingText = trailingText
    self.showsChevron = showsChevron
    self.iconColor = iconColor
    self.titleColor = titleColor
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(iconColor)
        .frame(width: 24)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(titleColor)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()

      if let trailingText {
        Text(trailingText)
          .font(.system(size: 12, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
      }

      if showsChevron {
        Image(systemName: "chevron.right")
          .font(.system(size: 10, weight: .bold))
          .foregroundColor(Color.Theme.textPlaceholder)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    .contentShape(Rectangle())
  }
}

// MARK: - Danger Row (destructive accent)

struct SettingsBlockDangerRow: View {
  let icon: String
  let title: String
  let subtitle: String?

  init(icon: String, title: String, subtitle: String? = nil) {
    self.icon = icon
    self.title = title
    self.subtitle = subtitle
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(Color.Theme.destructive)
        .frame(width: 24)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color.Theme.destructive)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.destructive.opacity(0.3), lineWidth: 1))
    .contentShape(Rectangle())
  }
}

// MARK: - Toggle Row (icon + label + Toggle)

struct SettingsBlockToggleRow: View {
  let icon: String
  let title: String
  let subtitle: String?
  let iconColor: Color
  @Binding var isOn: Bool

  init(
    icon: String,
    title: String,
    subtitle: String? = nil,
    iconColor: Color = Color.Theme.terminalGreen,
    isOn: Binding<Bool>
  ) {
    self.icon = icon
    self.title = title
    self.subtitle = subtitle
    self.iconColor = iconColor
    self._isOn = isOn
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(iconColor)
        .frame(width: 24)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(Color.Theme.textPrimary)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()

      Toggle("", isOn: $isOn)
        .labelsHidden()
        .tint(Color.Theme.terminalGreen)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }
}

// MARK: - Info Row (icon + label + read-only value)

struct SettingsBlockInfoRow: View {
  let icon: String
  let title: String
  let value: String
  let iconColor: Color

  init(
    icon: String,
    title: String,
    value: String,
    iconColor: Color = Color.Theme.terminalGreen
  ) {
    self.icon = icon
    self.title = title
    self.value = value
    self.iconColor = iconColor
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .bold))
        .foregroundColor(iconColor)
        .frame(width: 24)

      Text(title)
        .font(.system(size: 14, weight: .bold))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Text(value)
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.Theme.searchBg)
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }
}
