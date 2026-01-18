import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

struct PersonalIdentityView: View {
  @ObservedObject private var coordinator = IdentityCoordinator.shared
  @State private var didCopied = false
  @State private var jwkCopied = false
  #if canImport(UIKit)
    @State private var shareContent: String?
    @State private var showingShareSheet = false
  #endif

  var body: some View {
    List {
      commitmentSection
      keyMaterialSection
      cacheSection
      statusSection
      actionsSection
    }
    .listStyle(.insetGrouped)
    .animation(.default, value: coordinator.state)
    .onChange(of: didCopied) { _, value in
      if value { resetFlag(after: $didCopied) }
    }
    .onChange(of: jwkCopied) { _, value in
      if value { resetFlag(after: $jwkCopied) }
    }
    #if canImport(UIKit)
      .sheet(isPresented: $showingShareSheet, onDismiss: { shareContent = nil }) {
        if let shareContent {
          ActivityView(items: [shareContent])
        }
      }
    #endif
  }

  private var commitmentSection: some View {
    Section {
      if let commitment = coordinator.state.currentProfile.zkIdentity?.commitment {
        LabeledContent("Semaphore Commitment", value: commitment)
      } else {
        Text("No commitment available. Refresh to derive your identity.")
          .foregroundColor(.secondary)
      }
    }
  }

  private var keyMaterialSection: some View {
    Section("Public Key") {
      if let did = coordinator.state.currentProfile.activeDID?.did,
        let jwk = coordinator.state.cachedJwks[did],
        let json = try? jwk.jsonString(prettyPrinted: true)
      {
        ScrollView(.horizontal, showsIndicators: false) {
          Text(json)
            .font(.system(.caption, design: .monospaced))
            .foregroundColor(.secondary)
            .padding(.vertical, 4)
        }
        Button(action: copyJwk) {
          Label(jwkCopied ? "Copied" : "Copy JWK", systemImage: jwkCopied ? "checkmark.circle" : "doc.on.doc")
        }
        .disabled(jwkCopied)
      } else {
        Text("No cached JWK yet. Import or refresh your identity to populate the cache.")
          .foregroundColor(.secondary)
      }
    }
  }

  private var cacheSection: some View {
    Section("Cached Documents") {
      if let document = coordinator.state.didDocument,
        let json = encode(document)
      {
        Button(
          action: {
            #if canImport(UIKit)
              shareContent = json
              showingShareSheet = true
            #endif
          },
          label: {
            Label("Export DID Document", systemImage: "square.and.arrow.up")
          }
        )
        LabeledContent("Services", value: "\(document.service?.count ?? 0)")
      } else {
        Text("No DID document cached yet.")
          .foregroundColor(.secondary)
      }
    }
  }

  private var statusSection: some View {
    Section("Recent Activity") {
      if let importEvent = coordinator.state.lastImportEvent {
        VStack(alignment: .leading, spacing: 4) {
          Text(importEvent.summary)
            .font(.subheadline.weight(.semibold))
          Text(importEvent.kind.rawValue.capitalized)
            .font(.caption)
            .foregroundColor(.secondary)
          Text(importEvent.timestamp.formatted(date: .abbreviated, time: .shortened))
            .font(.caption2)
            .foregroundColor(.secondary)
        }
      } else {
        Text("No identity events yet.")
          .foregroundColor(.secondary)
      }

      if let error = coordinator.state.lastError {
        Text(error.localizedDescription)
          .font(.caption)
          .foregroundColor(.red)
      }
    }
  }

  private var actionsSection: some View {
    Section("Actions") {
      Button(
        action: {
          coordinator.refreshIdentity()
        },
        label: {
          Label("Refresh Identity", systemImage: "arrow.clockwise")
        }
      )

      Button(
        action: {
          coordinator.clearError()
        },
        label: {
          Label("Clear Error State", systemImage: "xmark.circle")
        }
      )
      .disabled(coordinator.state.lastError == nil)
    }
  }

  private func copyDid() {
    guard let did = coordinator.state.currentProfile.activeDID?.did else { return }
    copyToPasteboard(did)
    didCopied = true
  }

  private func copyJwk() {
    guard let did = coordinator.state.currentProfile.activeDID?.did,
      let jwk = coordinator.state.cachedJwks[did],
      let json = try? jwk.jsonString(prettyPrinted: true)
    else { return }
    copyToPasteboard(json)
    jwkCopied = true
  }

  private func encode(_ document: DIDDocument) -> String? {
    guard let data = try? IdentityCoordinatorEncoder.document(document) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func copyToPasteboard(_ value: String) {
    #if canImport(UIKit)
      UIPasteboard.general.string = value
    #endif
  }

  private func resetFlag(after flag: Binding<Bool>) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
      flag.wrappedValue = false
    }
  }
}

private enum IdentityCoordinatorEncoder {
  static func document(_ document: DIDDocument) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(document)
  }
}

#if canImport(UIKit)
  private struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
      UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
  }
#endif

#Preview {
  PersonalIdentityView()
}
