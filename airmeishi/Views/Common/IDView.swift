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

        var id: String { rawValue }

        var title: String {
            switch self {
            case .overview: return "Identity"
            case .group: return "Groups"
            }
        }

        var systemImage: String {
            switch self {
            case .overview: return "person.crop.circle.badge.checkmark"
            case .group: return "person.3"
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
    @State private var showingGroupManager = false
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

                identityActions
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 24)
        }
        .alert("Error", isPresented: $showErrorAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Unknown error")
        }
        .onAppear {
            if let id = idm.getIdentity() { identityCommitment = id.commitment }
        }
        .sheet(isPresented: $showingGroupManager) {
            NavigationStack { GroupManagementView() }
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

    private var identityActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Identity Actions")
                .font(.headline)

            NavigationLink {
                IdentityDashboardView()
            } label: {
                Label("Open Identity Center", systemImage: "person.text.rectangle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
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
                            Text("Tap to create ID\nHold to manage groups")
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
                // Ensure identity exists before managing groups
                let bundle = try await Task.detached(priority: .userInitiated) {
                    try idm.loadOrCreateIdentity()
                }.value
                
                await MainActor.run {
                    identityCommitment = bundle.commitment
                    isWorking = false
                    showingGroupManager = true
                }
            } catch {
                ZKLog.error("Error preparing identity for group management: \(error.localizedDescription)")
                await MainActor.run {
                    errorMessage = "Failed to prepare for group management: \(error.localizedDescription)"
                    showErrorAlert = true
                    isWorking = false
                }
            }
        }
    }

}

#Preview {
    IDView()
}

