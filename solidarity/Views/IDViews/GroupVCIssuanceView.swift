//
//  GroupVCIssuanceView.swift
//  solidarity
//
//  View for issuing Group VCs
//

import SwiftUI

struct GroupVCIssuanceView: View {
  let group: GroupModel
  @StateObject private var cardManager = CardManager.shared
  @StateObject private var groupService = GroupCredentialService.shared
  @StateObject private var deliveryService = GroupCredentialDeliveryService.shared
  @ObservedObject private var groupManager = CloudKitGroupSyncManager.shared

  @State private var selectedCard: BusinessCard?
  @State private var selectedMembers: Set<String> = []
  @State private var deliveryMethod: GroupCredentialDeliverySettings.DeliveryMethod = .sakura
  @State private var expirationDate: Date?
  @State private var isIssuing = false
  @State private var issuanceResults: [GroupCredentialResult] = []
  @State private var availableMembers: [GroupMemberModel] = []
  @State private var customName: String = ""
  @State private var rememberSelection: Bool = true
  @Environment(\.dismiss) private var dismiss

  private var storageKey: String {
    "group_issuance_binding_\(group.id)"
  }

  private struct GroupCardBindingSettings: Codable {
    let cardId: UUID
    let customName: String?
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          // Card Selection
          cardSelectionSection

          // Group Display
          groupDisplaySection

          // Member Selection
          recipientsSection

          // Delivery Method
          deliveryMethodSection

          // Expiration (Optional)
          expirationSection

          // Issue Button
          issueButtonSection

          // Results
          if !issuanceResults.isEmpty {
            resultsSection
          }
        }
        .padding(16)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle("Issue Group VC")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarTrailing) {
          Button("Done") { dismiss() }
            .foregroundColor(Color.Theme.textPrimary)
        }
      }
      .task {
        availableMembers = (try? await groupManager.getMembers(for: group)) ?? []
        loadSavedBindingIfAvailable()
      }
    }
  }

  // MARK: - Sections

  private var cardSelectionSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("SELECT BUSINESS CARD")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      Picker("Card", selection: $selectedCard) {
        Text("None").tag(nil as BusinessCard?)
        ForEach(availableCards, id: \.id) { card in
          Text(card.name).tag(card as BusinessCard?)
        }
      }
      .tint(Color.Theme.textPrimary)
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var groupDisplaySection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("GROUP DISPLAY")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        if let _ = selectedCard {
          TextField("Name shown in this group", text: $customName)
            .textInputAutocapitalization(.words)
            .disableAutocorrection(true)
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
            .padding(16)
            .background(Color.Theme.searchBg)

          Toggle("Remember this card for this group", isOn: $rememberSelection)
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
            .tint(Color.Theme.primaryBlue)
            .padding(16)
            .background(Color.Theme.searchBg)
        } else {
          Text("Select a card first")
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color.Theme.searchBg)
        }
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var recipientsSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("RECIPIENTS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        Toggle(
          "Send to All Active Members",
          isOn: .init(
            get: { selectedMembers.isEmpty },
            set: { if $0 { selectedMembers = [] } }
          )
        )
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textPrimary)
        .tint(Color.Theme.primaryBlue)
        .padding(16)
        .background(Color.Theme.searchBg)

        if !selectedMembers.isEmpty {
          ForEach(availableMembers, id: \.userRecordID) { member in
            Toggle(
              member.userRecordID,
              isOn: .init(
                get: { selectedMembers.contains(member.userRecordID) },
                set: {
                  if $0 {
                    selectedMembers.insert(member.userRecordID)
                  } else {
                    selectedMembers.remove(member.userRecordID)
                  }
                }
              )
            )
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
            .tint(Color.Theme.primaryBlue)
            .padding(16)
            .background(Color.Theme.searchBg)
          }
        }
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var deliveryMethodSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("DELIVERY METHOD")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      Picker("Method", selection: $deliveryMethod) {
        ForEach(GroupCredentialDeliverySettings.DeliveryMethod.allCases, id: \.self) { method in
          Text(method.displayName).tag(method)
        }
      }
      .tint(Color.Theme.textPrimary)
      .padding(16)
      .background(Color.Theme.searchBg)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var expirationSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("EXPIRATION (OPTIONAL)")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        Toggle(
          "Set Expiration",
          isOn: .init(
            get: { expirationDate != nil },
            set: { expirationDate = $0 ? Calendar.current.date(byAdding: .day, value: 30, to: Date()) : nil }
          )
        )
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textPrimary)
        .tint(Color.Theme.primaryBlue)
        .padding(16)
        .background(Color.Theme.searchBg)

        if let expirationDate = expirationDate {
          DatePicker("Expires", selection: .constant(expirationDate), displayedComponents: .date)
            .font(.system(size: 14))
            .foregroundColor(Color.Theme.textPrimary)
            .tint(Color.Theme.primaryBlue)
            .padding(16)
            .background(Color.Theme.searchBg)
        }
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var issueButtonSection: some View {
    Button(action: issueCredential) {
      HStack {
        if isIssuing {
          ProgressView()
            .padding(.trailing, 5)
        }
        Text("Issue Group Credential")
      }
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(ThemedPrimaryButtonStyle())
    .disabled(selectedCard == nil || isIssuing)
  }

  private var resultsSection: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("RESULTS")
        .font(.system(size: 12, weight: .bold, design: .monospaced))
        .foregroundColor(Color.Theme.textTertiary)
        .padding(.bottom, 8)

      VStack(spacing: 1) {
        ForEach(issuanceResults.indices, id: \.self) { index in
          let result = issuanceResults[index]
          switch result {
          case .success(let memberId, _):
            Label("Sent to \(memberId)", systemImage: "checkmark.circle.fill")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.terminalGreen)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
              .background(Color.Theme.searchBg)
          case .failure(let memberId, let error):
            Label("Failed: \(memberId) - \(error.localizedDescription)", systemImage: "xmark.circle.fill")
              .font(.system(size: 14))
              .foregroundColor(Color.Theme.destructive)
              .frame(maxWidth: .infinity, alignment: .leading)
              .padding(16)
              .background(Color.Theme.searchBg)
          }
        }
      }
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
    }
  }

  private var availableCards: [BusinessCard] {
    (try? cardManager.getAllCards().get()) ?? []
  }

  private func loadSavedBindingIfAvailable() {
    guard
      let data = UserDefaults.standard.data(forKey: storageKey),
      let saved = try? JSONDecoder().decode(GroupCardBindingSettings.self, from: data)
    else { return }

    if let card = availableCards.first(where: { $0.id == saved.cardId }) {
      selectedCard = card
      customName = saved.customName ?? card.name
    }
  }

  private func issueCredential() {
    guard let card = selectedCard else { return }
    isIssuing = true

    Task {
      do {
        let targetMembers =
          selectedMembers.isEmpty ? nil : availableMembers.filter { selectedMembers.contains($0.userRecordID) }

        let effectiveNameOverride: String?
        if customName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          effectiveNameOverride = nil
        } else {
          effectiveNameOverride = customName
        }

        let results = try await groupService.issueGroupCredential(
          for: card,
          group: group,
          targetMembers: targetMembers,
          expiration: expirationDate,
          nameOverride: effectiveNameOverride
        )

        // Send via selected delivery method
        for result in results {
          if case .success(let memberId, let credentialCard) = result {
            try? await deliveryService.sendCredential(
              credentialCard,
              to: memberId,
              via: deliveryMethod,
              group: group
            )
          }
        }

        await MainActor.run {
          if rememberSelection {
            let settings = GroupCardBindingSettings(
              cardId: card.id,
              customName: effectiveNameOverride
            )
            if let data = try? JSONEncoder().encode(settings) {
              UserDefaults.standard.set(data, forKey: storageKey)
            }
          }

          issuanceResults = results
          isIssuing = false

          // Notify listeners
          let successCount = results.filter { if case .success = $0 { return true } else { return false } }.count
          let summaryFormat = String(localized: "Last issuance: %lld successful, %lld failed at %@")
          let summary = String(
            format: summaryFormat,
            locale: Locale.current,
            successCount,
            results.count - successCount,
            Date().formatted(date: .abbreviated, time: .shortened)
          )
          NotificationCenter.default.post(
            name: .groupVCIssuanceDidComplete,
            object: nil,
            userInfo: ["summary": summary]
          )
        }
      } catch {
        await MainActor.run {
          isIssuing = false
          // Show error (could add an error state var)
          print("Error issuing credential: \(error)")
        }
      }
    }
  }
}

extension Notification.Name {
  static let groupVCIssuanceDidComplete = Notification.Name("groupVCIssuanceDidComplete")
}
