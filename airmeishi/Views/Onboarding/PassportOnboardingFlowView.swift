import SwiftUI

struct PassportOnboardingFlowView: View {
  let onCompleted: (PassportProofResult) -> Void

  @Environment(\.dismiss) private var dismiss
  @StateObject private var pipeline = PassportPipelineViewModel()
  @State private var showingMRZCamera = false
  @State private var showManualInput = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 14) {
          SolidarityPlaceholderCard(
            screenID: pipeline.currentScreenID,
            title: pipeline.currentTitle,
            subtitle: pipeline.currentSubtitle
          )

          switch pipeline.step {
          case .mrz:
            mrzForm
          case .nfc:
            nfcStep
          case .proof:
            proofStep
          case .persist:
            persistStep
          }
        }
        .padding(16)
      }
      .navigationTitle("Passport Setup")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button("Close") { dismiss() }
        }
      }
      .alert("Passport Pipeline", isPresented: $pipeline.showingAlert) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(pipeline.alertMessage)
      }
      .fullScreenCover(isPresented: $showingMRZCamera) {
        MRZCameraView { draft in
          pipeline.applyScannedDraft(draft)
          showManualInput = true
        }
      }
    }
  }

  private var mrzForm: some View {
    VStack(spacing: 10) {
      // Dual entry: Scan or Manual
      if !showManualInput {
        VStack(spacing: 12) {
          Button {
            showingMRZCamera = true
          } label: {
            Label("Scan Passport", systemImage: "camera.viewfinder")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(ThemedPrimaryButtonStyle())

          Button {
            showManualInput = true
          } label: {
            Text("Manual Input")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered)
        }
        .padding(14)
        .background(Color.Theme.cardBg)
        .cornerRadius(10)
      } else {
        // Manual form (also shown after scan to let user verify/edit)
        VStack(spacing: 10) {
          TextField("Passport Number", text: $pipeline.passportNumber)
            .textInputAutocapitalization(.characters)
            .textFieldStyle(.roundedBorder)
          TextField("Nationality (3 letters)", text: $pipeline.nationality)
            .textInputAutocapitalization(.characters)
            .textFieldStyle(.roundedBorder)

          DatePicker("Date of Birth", selection: $pipeline.birthDate, displayedComponents: .date)
          DatePicker("Expiry Date", selection: $pipeline.expiryDate, displayedComponents: .date)

          Button {
            pipeline.validateMRZ()
          } label: {
            Text("Continue to NFC")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(ThemedPrimaryButtonStyle())
          .padding(.top, 8)

          Button {
            showManualInput = false
          } label: {
            Text("Back to Scan")
              .font(.caption)
          }
        }
        .padding(14)
        .background(Color.Theme.cardBg)
        .cornerRadius(10)
      }
    }
  }

  private var nfcStep: some View {
    VStack(spacing: 12) {
      // NFC illustration
      ZStack {
        Image(systemName: "iphone")
          .font(.system(size: 48))
          .foregroundColor(Color.Theme.textTertiary)
        Image(systemName: "wave.3.forward")
          .font(.system(size: 24))
          .foregroundColor(Color.Theme.darkUI)
          .offset(x: -40, y: -10)
      }
      .frame(height: 80)
      .frame(maxWidth: .infinity)

      Text("Bring your passport close to the device to read NFC chip data.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)
        .multilineTextAlignment(.center)

      if pipeline.isLoading {
        VStack(spacing: 8) {
          ProgressView()
          Text(pipeline.nfcProgressMessage)
            .font(.caption)
            .foregroundColor(Color.Theme.textTertiary)
        }
      }

      if let chip = pipeline.chipSnapshot {
        VStack(alignment: .leading, spacing: 6) {
          if chip.isSimulated {
            HStack {
              Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
              Text("Simulated")
                .font(.caption.weight(.semibold))
                .foregroundColor(.orange)
            }
          }

          HStack {
            Text("Chip UID:")
              .font(.caption.weight(.semibold))
            Text(chip.chipUID)
              .font(.caption.monospaced())
          }

          HStack(spacing: 12) {
            authBadge("BAC", passed: chip.bacVerified)
            authBadge("PACE", passed: chip.paceVerified)
            authBadge("PA", passed: chip.passiveAuthPassed)
          }

          Text("Document hash: \(chip.documentHash)")
            .font(.caption.monospaced())
          Text("MRZ digest: \(chip.mrzDigest)")
            .font(.caption.monospaced())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.Theme.searchBg)
        .cornerRadius(8)
      }

      Button {
        pipeline.readNFC()
      } label: {
        Text("Read NFC Chip")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(pipeline.isLoading)
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private func authBadge(_ label: String, passed: Bool) -> some View {
    HStack(spacing: 4) {
      Image(systemName: passed ? "checkmark.circle.fill" : "xmark.circle")
        .font(.caption2)
        .foregroundColor(passed ? .green : Color.Theme.textTertiary)
      Text(label)
        .font(.caption2.weight(.semibold))
        .foregroundColor(passed ? .green : Color.Theme.textTertiary)
    }
  }

  private var proofStep: some View {
    VStack(spacing: 12) {
      Text("Generate a passport proof to unlock high-trust claims.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      if pipeline.isLoading {
        ProgressView()
      }

      if let proof = pipeline.proofResult {
        HStack {
          Text(proof.generationFailed ? "Fallback active" : "ZK proof ready")
            .font(.caption.weight(.semibold))
            .foregroundColor(proof.generationFailed ? .orange : .green)
          Spacer()
          Text("Trust: \(proof.trustLevel.uppercased())")
            .font(.caption.monospaced())
            .foregroundColor(Color.Theme.textSecondary)
        }
      }

      Button {
        pipeline.generateProof()
      } label: {
        Text("Generate Proof")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(pipeline.isLoading || pipeline.chipSnapshot == nil)
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }

  private var persistStep: some View {
    VStack(spacing: 12) {
      Text("Credential is ready. Save it to your identity wallet.")
        .font(.subheadline)
        .foregroundColor(Color.Theme.textSecondary)

      Button {
        pipeline.persist()
        if let proof = pipeline.proofResult {
          onCompleted(proof)
          dismiss()
        }
      } label: {
        Text("Save Passport Credential")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(ThemedPrimaryButtonStyle())
      .disabled(pipeline.proofResult == nil || pipeline.isLoading)
    }
    .padding(14)
    .background(Color.Theme.cardBg)
    .cornerRadius(10)
  }
}

@MainActor
private final class PassportPipelineViewModel: ObservableObject {
  enum Step {
    case mrz
    case nfc
    case proof
    case persist
  }

  @Published var step: Step = .mrz
  @Published var passportNumber = ""
  @Published var nationality = "TWN"
  @Published var birthDate = Calendar.current.date(byAdding: .year, value: -24, to: Date()) ?? Date()
  @Published var expiryDate = Calendar.current.date(byAdding: .year, value: 8, to: Date()) ?? Date()
  @Published var chipSnapshot: PassportChipSnapshot?
  @Published var proofResult: PassportProofResult?
  @Published var isLoading = false
  @Published var nfcProgressMessage = "Connecting to chip..."
  @Published var showingAlert = false
  @Published var alertMessage = ""

  private let pipeline = PassportPipelineService.shared

  var currentScreenID: SolidarityScreenID {
    switch step {
    case .mrz: return .passportCapture
    case .nfc: return .passportNFC
    case .proof: return .passportProof
    case .persist: return .passportPersist
    }
  }

  var currentTitle: String {
    switch step {
    case .mrz: return "Capture MRZ"
    case .nfc: return "Read NFC Chip"
    case .proof: return "Generate ZK Proof"
    case .persist: return "Persist Credential"
    }
  }

  var currentSubtitle: String {
    switch step {
    case .mrz: return "Input passport fields before secure chip read."
    case .nfc: return "Read signed passport data from NFC chip."
    case .proof: return "Attempt ZK generation with fallback to SD-JWT."
    case .persist: return "Save identity card and provable claims."
    }
  }

  private var draft: PassportMRZDraft {
    PassportMRZDraft(
      passportNumber: passportNumber,
      nationalityCode: nationality,
      dateOfBirth: birthDate,
      expiryDate: expiryDate
    )
  }

  func applyScannedDraft(_ scanned: PassportMRZDraft) {
    passportNumber = scanned.passportNumber
    nationality = scanned.nationalityCode
    birthDate = scanned.dateOfBirth
    expiryDate = scanned.expiryDate
  }

  func validateMRZ() {
    switch pipeline.validateMRZ(draft) {
    case .success:
      step = .nfc
    case .failure(let error):
      show(error.localizedDescription)
    }
  }

  func readNFC() {
    isLoading = true
    nfcProgressMessage = "Hold passport near device..."
    Task {
      let result = await pipeline.readNFCChip(from: draft)
      isLoading = false
      switch result {
      case .success(let snapshot):
        nfcProgressMessage = "Read complete."
        chipSnapshot = snapshot
        step = .proof
      case .failure(let error):
        nfcProgressMessage = ""
        show(error.localizedDescription)
      }
    }
  }

  func generateProof() {
    guard let chipSnapshot else { return }
    isLoading = true
    Task {
      let result = await pipeline.generateProof(chip: chipSnapshot, draft: draft)
      isLoading = false
      switch result {
      case .success(let proof):
        proofResult = proof
        step = .persist
      case .failure(let error):
        show(error.localizedDescription)
      }
    }
  }

  func persist() {
    guard let proofResult else { return }
    switch pipeline.persistPassportCredential(draft: draft, proof: proofResult) {
    case .success:
      break
    case .failure(let error):
      show(error.localizedDescription)
    }
  }

  private func show(_ message: String) {
    alertMessage = message
    showingAlert = true
  }
}
