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
    guard let card = card else { return "UNKNOWN" }
    switch field {
    case .name: return card.name
    case .title: return card.title ?? "N/A"
    case .company: return card.company ?? "N/A"
    case .email: return card.email ?? "N/A"
    case .phone: return card.phone ?? "N/A"
    case .profileImage: return "Binary Data"
    case .socialNetworks: return "\(card.socialNetworks.count) Links"
    case .skills: return "\(card.skills.count) Verified"
    }
  }

  func infoRow(label: String, value: String) -> some View {
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
          Text(field.displayName.uppercased())
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
    case .discovery: return "Discovery"
    case .scope: return "Sharing Scope"
    case .awaiting: return "Awaiting Response"
    case .incoming: return "Incoming Request"
    case .saved: return "Exchange Complete"
    }
  }

  var currentSubtitle: String {
    switch step {
    case .discovery: return "Keep this terminal open for physical pairing."
    case .scope: return "Select payload fields to cryptographically share."
    case .awaiting: return "Awaiting peer node to accept handshake."
    case .incoming: return "Review and accept inbound transmission."
    case .saved: return "Keys generated. Signatures exchanged."
    }
  }

  var isMatchingActive: Bool {
    proximityManager.isAdvertising || proximityManager.isBrowsing
  }
}
