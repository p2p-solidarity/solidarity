import SwiftUI

// MARK: - Back Toolbar (chevron.left + title at navigationBarLeading)

struct SettingsBackToolbar: ToolbarContent {
  let title: String
  let action: () -> Void

  init(_ title: String = "Done", action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }

  var body: some ToolbarContent {
    ToolbarItem(placement: .navigationBarLeading) {
      Button(action: action) {
        HStack(spacing: 4) {
          Image(systemName: "chevron.left")
            .font(.system(size: 16, weight: .semibold))
          Text(title)
            .font(.system(size: 16))
        }
        .foregroundColor(Color.Theme.textPrimary)
      }
    }
  }
}

// MARK: - Section Header (Me-tab style: 14pt regular, no brackets)

struct SettingsBlockSectionHeader: View {
  let title: String

  var body: some View {
    Text(title)
      .font(.system(size: 14))
      .foregroundColor(Color.Theme.textPrimary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
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
    VStack(alignment: .leading, spacing: 8) {
      SettingsBlockSectionHeader(title: title)

      VStack(spacing: 8) {
        content
      }
      .padding(.horizontal, 16)

      if let footer {
        Text(footer)
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
          .padding(.horizontal, 16)
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
    iconColor: Color = Color.Theme.textPrimary,
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
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(iconColor)
        .frame(width: 20, height: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 15))
          .foregroundColor(titleColor)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()

      if let trailingText {
        Text(trailingText)
          .font(.system(size: 13))
          .foregroundColor(Color.Theme.textSecondary)
      }

      if showsChevron {
        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(Color.Theme.textTertiary)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
    .contentShape(RoundedRectangle(cornerRadius: 12))
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
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(Color.Theme.destructive)
        .frame(width: 20, height: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.destructive)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
    .contentShape(RoundedRectangle(cornerRadius: 12))
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
    iconColor: Color = Color.Theme.textPrimary,
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
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(iconColor)
        .frame(width: 20, height: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 15))
          .foregroundColor(Color.Theme.textPrimary)
        if let subtitle {
          Text(subtitle)
            .font(.system(size: 12))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      Spacer()

      Toggle("", isOn: $isOn)
        .labelsHidden()
        .tint(Color.Theme.primaryBlue)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
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
    iconColor: Color = Color.Theme.textPrimary
  ) {
    self.icon = icon
    self.title = title
    self.value = value
    self.iconColor = iconColor
  }

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon)
        .font(.system(size: 14, weight: .regular))
        .foregroundColor(iconColor)
        .frame(width: 20, height: 20)

      Text(title)
        .font(.system(size: 15))
        .foregroundColor(Color.Theme.textPrimary)

      Spacer()

      Text(value)
        .font(.system(size: 13))
        .foregroundColor(Color.Theme.textSecondary)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: 12)
        .fill(Color.Theme.mutedSurface)
    )
  }
}
