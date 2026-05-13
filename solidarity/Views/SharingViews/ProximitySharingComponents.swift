import SwiftUI

enum ExchangeStep {
  case discovery
  case scope
  case awaiting
  case incoming
  case saved
}

extension ProximitySharingView {

  func extractValue(from card: BusinessCard?, field: BusinessCardField) -> String {
    guard let card = card else { return String(localized: "UNKNOWN") }
    switch field {
    case .name: return card.name
    case .title: return card.title ?? String(localized: "N/A")
    case .company: return card.company ?? String(localized: "N/A")
    case .email: return card.email ?? String(localized: "N/A")
    case .phone: return card.phone ?? String(localized: "N/A")
    case .profileImage: return String(localized: "Binary Data")
    case .socialNetworks:
      let count = card.socialNetworks.count
      return String(localized: "\(count) Links")
    case .skills:
      let count = card.skills.count
      return String(localized: "\(count) Verified")
    }
  }

  func infoRow(label: LocalizedStringKey, value: String) -> some View {
    HStack(alignment: .top, spacing: 16) {
      Text(label)
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .frame(width: 60, alignment: .leading)
      Text(value)
        .font(.system(size: 12, weight: .regular, design: .monospaced))
        .foregroundColor(Color.Theme.textPrimary)
    }
  }

  func fieldPicker(selection: Binding<Set<BusinessCardField>>) -> some View {
    VStack(spacing: 1) {
      ForEach(BusinessCardField.allCases) { field in
        HStack {
          Text(LocalizedStringKey(field.displayName))
            .textCase(.uppercase)
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(selection.wrappedValue.contains(field) ? Color.Theme.terminalGreen : Color.Theme.textSecondary)
          Spacer()
          Image(systemName: selection.wrappedValue.contains(field) ? "checkmark.square.fill" : "square")
            .foregroundColor(selection.wrappedValue.contains(field) ? Color.Theme.terminalGreen : Color.Theme.textTertiary)
        }
        .padding(12)
        .background(Color.Theme.searchBg)
        .onTapGesture {
          HapticFeedbackManager.shared.rigidImpact()
          if selection.wrappedValue.contains(field) {
            selection.wrappedValue.remove(field)
          } else {
            selection.wrappedValue.insert(field)
          }
          selection.wrappedValue.insert(.name)
        }
      }
    }
    .clipShape(Rectangle())
    .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
  }

  var currentStepTitle: String {
    switch step {
    case .discovery: return String(localized: "Discovery")
    case .scope: return String(localized: "Sharing Scope")
    case .awaiting: return String(localized: "Awaiting Response")
    case .incoming: return String(localized: "Incoming Request")
    case .saved: return String(localized: "Exchange Complete")
    }
  }

  var currentSubtitle: String {
    switch step {
    case .discovery: return String(localized: "Keep this terminal open for physical pairing.")
    case .scope: return String(localized: "Select payload fields to cryptographically share.")
    case .awaiting: return String(localized: "Awaiting peer node to accept handshake.")
    case .incoming: return String(localized: "Review and accept inbound transmission.")
    case .saved: return String(localized: "Keys generated. Signatures exchanged.")
    }
  }

  var isMatchingActive: Bool {
    proximityManager.isAdvertising || proximityManager.isBrowsing
  }
}
