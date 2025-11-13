//
//  IDView.swift
//  airmeishi
//
//  Identity management hub with swipable tabs for identity, groups, and ZK settings.
//

import SwiftUI

struct IDView: View {
    private enum ManagementTab: String, CaseIterable, Identifiable {
        case overview
        case group
        case selective

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Identity"
            case .group: return "Groups"
            case .selective: return "ZK"
            }
        }

        var systemImage: String {
            switch self {
            case .overview: return "person.crop.circle.badge.checkmark"
            case .group: return "person.3"
            case .selective: return "lock.shield"
            }
        }
    }

    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @State private var selection: ManagementTab = .overview

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                summaryCard
                tabSelector
                TabView(selection: $selection) {
                    IdentityQuickActionsTab()
                        .tag(ManagementTab.overview)

                    GroupIdentityView()
                        .tag(ManagementTab.group)

                    IdentitySelectiveSettingsTab()
                        .tag(ManagementTab.selective)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut(duration: 0.2), value: selection)
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 12)
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Identity Center")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        coordinator.refreshIdentity()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(summaryTitle)
                .font(.headline)

            // Show DID if available
            if let did = coordinator.state.activeDid?.did {
                VStack(alignment: .leading, spacing: 4) {
                    Text("DID")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                    Text(did)
                        .font(.footnote.monospaced())
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            
            // Show ZK commitment if available
            if let zkIdentity = coordinator.state.zkIdentity {
                VStack(alignment: .leading, spacing: 4) {
                    Text("ZK Commitment")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.secondary)
                    Text(shortCommitment(zkIdentity.commitment))
                        .font(.footnote.monospaced())
                        .foregroundColor(.primary)
                }
            }

            if let event = coordinator.state.lastImportEvent {
                HStack(spacing: 8) {
                    Image(systemName: "clock")
                        .foregroundColor(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.summary)
                            .font(.caption.weight(.semibold))
                        Text(event.timestamp.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            if let error = coordinator.state.lastError {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                    Text(error.localizedDescription)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
    }
    
    private func shortCommitment(_ value: String) -> String {
        guard value.count > 12 else { return value }
        let start = value.prefix(6)
        let end = value.suffix(6)
        return String(start) + "…" + String(end)
    }

    private var tabSelector: some View {
        HStack(spacing: 10) {
            ForEach(ManagementTab.allCases) { tab in
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        selection = tab
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.systemImage)
                        Text(tab.title)
                            .font(.callout.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .foregroundStyle(selection == tab ? Color.white : Color.primary)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(selection == tab ? Color.accentColor : Color(.secondarySystemBackground))
                    )
                }
                .buttonStyle(.plain)
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private var summaryTitle: String {
        if coordinator.state.isLoading {
            return "Loading identity…"
        }
        if coordinator.state.activeDid != nil {
            return "Active DID"
        }
        return "No Active Identity"
    }
}

private struct IdentityQuickActionsTab: View {
    private func shortCommitment(_ value: String) -> String {
        guard value.count > 12 else { return value }
        let start = value.prefix(6)
        let end = value.suffix(6)
        return String(start) + "…" + String(end)
    }
    
    @StateObject private var idm = SemaphoreIdentityManager.shared
    @StateObject private var group = SemaphoreGroupManager.shared
    @State private var showingCreateGroup = false
    @State private var identityCommitment: String = ""
    @State private var ringActiveCount = 0
    @State private var isPressing = false
    @State private var ringTimer: Timer?
    @State private var isWorking = false
    @State private var showErrorAlert = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ringStack
                    .frame(height: 320)

                identityPanel

                quickActions
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 24)
        }
        .sheet(isPresented: $showingCreateGroup) {
            NavigationStack { CreateGroupSheet() }
        }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Unknown error")
        }
        .onAppear {
            if let id = idm.getIdentity() { identityCommitment = id.commitment }
        }
    }

    private var ringStack: some View {
        GeometryReader { geo in
            let base = min(geo.size.width, geo.size.height)
            ZStack {
                ringView(size: base * 0.80, index: 3)
                ringView(size: base * 0.62, index: 2)
                ringView(size: base * 0.46, index: 1)
                centerButton(size: base * 0.36)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var identityPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Your ID")
                    .font(.headline)
                Spacer()
                if !identityCommitment.isEmpty {
                    Button {
                        #if canImport(UIKit)
                        UIPasteboard.general.string = identityCommitment
                        #endif
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    .buttonStyle(.bordered)
                }
            }

            if identityCommitment.isEmpty {
                Text("No ID yet. Tap the orb to create your identity.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shortCommitment(identityCommitment))
                        .font(.callout.monospaced())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color(uiColor: .secondarySystemBackground))
                        )

                    DisclosureGroup("Show full commitment") {
                        ScrollView(.horizontal, showsIndicators: true) {
                            Text(identityCommitment)
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                                .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
    }

    private var quickActions: some View {
        VStack(spacing: 12) {
            NavigationLink {
                PersonalIdentityView()
            } label: {
                Label("View identity details", systemImage: "person.text.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            NavigationLink {
                GroupManagementView()
            } label: {
                Label("Open group manager", systemImage: "person.3")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button {
                if !isWorking { showingCreateGroup = true }
            } label: {
                Label("Create new group", systemImage: "sparkles")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private func ringView(size: CGFloat, index: Int) -> some View {
        Circle()
            .stroke(lineWidth: 8)
            .foregroundColor(
                index == 1
                ? Color.gray.opacity(0.2)
                : (index <= ringActiveCount ? Color.accentColor : Color.gray.opacity(0.2))
            )
            .frame(width: size, height: size)
            .animation(.easeInOut(duration: 0.3), value: ringActiveCount)
    }

    private func centerButton(size: CGFloat) -> some View {
        let longPressDuration: Double = 1.5
        return ZStack {
            Circle()
                .fill(
                    identityCommitment.isEmpty
                    ? LinearGradient(colors: [.accentColor.opacity(0.9), .accentColor.opacity(0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    : LinearGradient(colors: [.green.opacity(0.95), .blue.opacity(0.75)], startPoint: .topLeading, endPoint: .bottomTrailing)
                )
                .frame(width: size, height: size)
                .shadow(color: .accentColor.opacity(isPressing ? 0.6 : 0.25), radius: isPressing ? 20 : 10)
                .overlay(
                    VStack(spacing: 6) {
                        Text("ID")
                            .font(.title2.weight(.bold))
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.35), radius: 3, x: 0, y: 1)

                        if !identityCommitment.isEmpty {
                            VStack(spacing: 4) {
                                Text("Commitment")
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.9))
                                Text(shortCommitment(identityCommitment))
                                    .font(.caption.monospaced())
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.black.opacity(0.20))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                        } else {
                            Text("Tap to create ID\nHold to create group")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .foregroundColor(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.black.opacity(0.20))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                )
                .onTapGesture { tapAction() }
                .onLongPressGesture(minimumDuration: longPressDuration, maximumDistance: 50, pressing: { pressing in
                    isPressing = pressing
                    if pressing {
                        startRingAnimation()
                        #if canImport(UIKit)
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        #endif
                    } else {
                        stopRingAnimation(reset: false)
                    }
                }, perform: {
                    #if canImport(UIKit)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    #endif
                    stopRingAnimation(reset: false)
                    longPressAction()
                })
        }
    }

    private func startRingAnimation() {
        ringActiveCount = 1
        ringTimer?.invalidate()
        ringTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { timer in
            ringActiveCount = min(3, ringActiveCount + 1)
            if ringActiveCount >= 3 { timer.invalidate() }
        }
    }

    private func stopRingAnimation(reset: Bool) {
        ringTimer?.invalidate()
        ringTimer = nil
        if reset { ringActiveCount = 0 }
    }

    private func tapAction() {
        if isWorking { return }
        isWorking = true
        
        Task {
            do {
                // Create or load ZK identity
                let bundle = try await Task.detached(priority: .userInitiated) {
                    try idm.loadOrCreateIdentity()
                }.value
                
                await MainActor.run {
                    identityCommitment = bundle.commitment
                    
                    // Add to default group if not already a member
                    if !group.members.contains(bundle.commitment) {
                        group.addMember(bundle.commitment)
                    }
                    
                    // Also ensure DID is created
                    IdentityCoordinator.shared.refreshIdentity()
                    isWorking = false
                }
                
                #if canImport(UIKit)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                #endif
            } catch {
                ZKLog.error("Error creating identity: \(error.localizedDescription)")
                await MainActor.run {
                    errorMessage = "Failed to create identity: \(error.localizedDescription)"
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }

    private func longPressAction() {
        if isWorking { return }
        isWorking = true
        
        Task {
            do {
                // Ensure identity exists before creating group
                let bundle = try await Task.detached(priority: .userInitiated) {
                    try idm.loadOrCreateIdentity()
                }.value
                
                await MainActor.run {
                    identityCommitment = bundle.commitment
                    isWorking = false
                    showingCreateGroup = true
                }
            } catch {
                ZKLog.error("Error creating identity for group: \(error.localizedDescription)")
                await MainActor.run {
                    errorMessage = "Failed to prepare for group creation: \(error.localizedDescription)"
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }

}

private struct IdentitySelectiveSettingsTab: View {
    @State private var preferences = SharingPreferences()

    var body: some View {
        SelectiveDisclosureSettingsView(sharingPreferences: $preferences)
            .scrollContentBackground(.hidden)
    }
}

#Preview {
    IDView()
}

// MARK: - Create Group Sheet
// Note: Local-only group creation (API removed)
private struct CreateGroupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var groupName: String = ""
    @State private var includeSelf = true
    @ObservedObject private var idm = SemaphoreIdentityManager.shared
    @ObservedObject private var manager = SemaphoreGroupManager.shared
    @State private var isCreating = false
    @FocusState private var nameFieldFocused: Bool
    private var trimmedName: String { groupName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isNameValid: Bool { trimmedName.count >= 3 }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.05, blue: 0.08),
                    Color(red: 0.08, green: 0.08, blue: 0.12)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                VStack(spacing: 16) {
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.white)
                        .padding(24)
                        .background(
                            Circle()
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.accentColor.opacity(0.3),
                                            Color.accentColor.opacity(0.1)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        )

                    VStack(spacing: 8) {
                        Text("Create New Group")
                            .font(.title)
                            .fontWeight(.bold)
                            .foregroundColor(.white)

                        Text("Build a community with ZK privacy")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
                .padding(.top, 40)

                VStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Group Name")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.white.opacity(0.8))

                        TextField("Enter group name", text: $groupName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .focused($nameFieldFocused)
                            .onSubmit { if isNameValid { localCreate() } }
                            .foregroundColor(.white)
                            .tint(.accentColor)
                            .padding(16)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.white.opacity(0.1))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(
                                                isNameValid || groupName.isEmpty
                                                    ? Color.white.opacity(0.2)
                                                    : Color.red.opacity(0.5),
                                                lineWidth: 1
                                            )
                                    )
                            )

                        if !isNameValid && !groupName.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.circle.fill")
                                    .font(.caption2)
                                Text("Name must be at least 3 characters")
                                    .font(.caption)
                            }
                            .foregroundColor(.red)
                        }
                    }

                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Include my identity")
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundColor(.white)

                            Text("Add yourself as the first member")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.5))
                        }

                        Spacer()

                        Toggle("", isOn: $includeSelf)
                            .tint(.accentColor)
                    }
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.white.opacity(0.1))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.white.opacity(0.2), lineWidth: 1)
                            )
                    )
                }
                .padding(.horizontal, 24)

                Spacer()

                VStack(spacing: 16) {
                    Button {
                        guard !isCreating && isNameValid else { return }
                        localCreate()
                    } label: {
                        HStack(spacing: 8) {
                            if isCreating {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(.white)
                            } else {
                                Image(systemName: "plus.circle.fill")
                            }
                            Text(isCreating ? "Creating..." : "Create Group")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(
                                    isNameValid && !isCreating
                                        ? Color.accentColor
                                        : Color(red: 0.2, green: 0.2, blue: 0.25)
                                )
                        )
                        .foregroundColor(.white)
                    }
                    .disabled(!isNameValid || isCreating)

                    Text("Groups use Semaphore ZK proofs for privacy")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.4))
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .navigationTitle("New Group")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }
        }
        .toolbarBackground(Color.clear, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .onAppear { nameFieldFocused = true }
    }

    private func localCreate() {
        if isCreating { return }
        guard isNameValid else { return }
        let name = trimmedName
        var members: [String] = []
        if includeSelf, let bundle = idm.getIdentity() ?? (try? idm.loadOrCreateIdentity()) {
            members.append(bundle.commitment)
        }
        let owner = randomEthAddress()
        _ = manager.createGroup(name: name, initialMembers: members, ownerAddress: owner)
        groupName = ""
        dismiss()
    }

    private func randomEthAddress() -> String {
        var bytes = [UInt8](repeating: 0, count: 20)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        return "0x" + hex
    }
}

 
