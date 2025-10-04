//
//  IDView.swift
//  airmeishi
//
//  Identity view with ring interaction for Semaphore identity/group and proof generation
//

import SwiftUI
import UniformTypeIdentifiers

enum EventLayoutMode: String, CaseIterable, Identifiable {
    case list
    case grid
    case timeline
    var id: String { rawValue }
    
    var title: String {
        switch self {
        case .list: return "List"
        case .grid: return "Grid"
        case .timeline: return "Timeline"
        }
    }
}

struct IDView: View {
    @StateObject private var idm = SemaphoreIdentityManager.shared
    @StateObject private var group = SemaphoreGroupManager.shared
    @State private var showingCreateGroup = false
    @State private var identityCommitment: String = ""
    @State private var ringActiveCount: Int = 0
    @State private var isPressing: Bool = false
    @State private var ringTimer: Timer?
    @State private var isWorking: Bool = false
    @State private var showErrorAlert: Bool = false
    @State private var errorMessage: String?
    
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                GeometryReader { geo in
                    ZStack {
                        let base = min(geo.size.width, geo.size.height)
                        // Indices chosen so that 1 = inner, 3 = outer to light from inner -> outer
                        ringView(size: base * 0.80, index: 3)
                        ringView(size: base * 0.62, index: 2)
                        ringView(size: base * 0.46, index: 1)
                        centerButton(size: base * 0.36)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(height: 360)

                identityPanel()
            }
            .navigationTitle("ID")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        GroupManagementView()
                    } label: {
                        Image(systemName: "person.3")
                    }
                }
            }
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
                            Text("Tap: Create ID\nHold: Create Group")
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
                        // Keep the rings lit at their last state until action perform finishes
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
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                // Ensure identity exists
                let bundle = try idm.loadOrCreateIdentity()
                if identityCommitment.isEmpty {
                    DispatchQueue.main.async { identityCommitment = bundle.commitment }
                }
                // Ensure membership includes self
                if !group.members.contains(bundle.commitment) { group.addMember(bundle.commitment) }
                DispatchQueue.main.async { isWorking = false }
            } catch {
                ZKLog.error("Error on tapAction: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    errorMessage = error.localizedDescription
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }

    private func longPressAction() {
        if isWorking { return }
        isWorking = true
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let bundle = try idm.loadOrCreateIdentity()
                DispatchQueue.main.async { identityCommitment = bundle.commitment }
                DispatchQueue.main.async {
                    isWorking = false
                    showingCreateGroup = true
                }
            } catch {
                ZKLog.error("Error on longPressAction: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    errorMessage = error.localizedDescription
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }

    private func shortCommitment(_ c: String) -> String {
        if c.count <= 12 { return c }
        let start = c.prefix(6)
        let end = c.suffix(6)
        return String(start) + "…" + String(end)
    }

    // MARK: - Identity panel

    @ViewBuilder
    private func identityPanel() -> some View {
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
                Text("No ID yet. Tap the center to create your identity.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shortCommitment(identityCommitment))
                        .font(.callout.monospaced())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(uiColor: .secondarySystemBackground)))
                    DisclosureGroup("Show full") {
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
        .padding(.horizontal)
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
            // Dark gradient background
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
                // Header
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

                // Form Content
                VStack(spacing: 20) {
                    // Name Input
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

                    // Include Self Toggle
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

                // Bottom Button
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
                Button {
                    dismiss()
                } label: {
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
        if includeSelf, let bundle = idm.getIdentity() ?? (try? idm.loadOrCreateIdentity()) { members.append(bundle.commitment) }
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

 
