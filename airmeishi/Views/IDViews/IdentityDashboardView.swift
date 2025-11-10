import SwiftUI

struct IdentityDashboardView: View {
    enum Section: String, CaseIterable, Identifiable {
        case personal
        case group
        case selective

        var id: String { rawValue }

        var title: String {
            switch self {
            case .personal: return "Personal"
            case .group: return "Group"
            case .selective: return "Selective"
            }
        }

        var systemImage: String {
            switch self {
            case .personal: return "person.circle"
            case .group: return "person.3"
            case .selective: return "lock.circle"
            }
        }
    }

    @ObservedObject private var coordinator = IdentityCoordinator.shared
    @State private var selection: Section = .personal
    private let sharingPreferences: Binding<SharingPreferences>?

    init(sharingPreferences: Binding<SharingPreferences>? = nil) {
        self.sharingPreferences = sharingPreferences
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                identitySummary
                tabSwitcher
                TabView(selection: $selection) {
                    PersonalIdentityView()
                        .tag(Section.personal)

                    GroupIdentityView()
                        .tag(Section.group)

                    SelectiveDisclosureSettingsView(sharingPreferences: bindingForSelective())
                        .tag(Section.selective)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(.easeInOut(duration: 0.2), value: selection)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

    private var identitySummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(summaryTitle)
                .font(.headline)

            if let did = coordinator.state.activeDid?.did {
                Text(did)
                    .font(.footnote.monospaced())
                    .foregroundColor(.secondary)
            }

            if let event = coordinator.state.lastImportEvent {
                HStack(spacing: 8) {
                    Image(systemName: "clock")
                        .foregroundColor(.secondary)
                    Text(event.summary)
                        .font(.caption)
                        .foregroundColor(.secondary)
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

    private var summaryTitle: String {
        if coordinator.state.isLoading {
            return "Loading identity…"
        }
        if coordinator.state.activeDid != nil {
            return "Active DID"
        }
        return "No Active Identity"
    }

    private var tabSwitcher: some View {
        HStack(spacing: 10) {
            ForEach(Section.allCases) { section in
                Button {
                    selection = section
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: section.systemImage)
                        Text(section.title)
                            .font(.callout.weight(.semibold))
                    }
                    .foregroundStyle(selection == section ? Color.accentColor : Color.secondary)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(selection == section ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
                    )
                }
                .frame(maxWidth: .infinity)
                .buttonStyle(.plain)
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private func bindingForSelective() -> Binding<SharingPreferences> {
        if let binding = sharingPreferences {
            return binding
        }
        return .constant(SharingPreferences())
    }
}

#Preview {
    IdentityDashboardView(sharingPreferences: .constant(SharingPreferences()))
}
