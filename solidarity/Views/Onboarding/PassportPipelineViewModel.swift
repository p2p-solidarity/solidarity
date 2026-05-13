import Foundation

@MainActor
final class PassportPipelineViewModel: ObservableObject {
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
    @Published var proofProgressMessage = ""
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
        proofProgressMessage = "Initializing prover..."
        Task {
            let result = await pipeline.generateProof(
                chip: chipSnapshot,
                draft: draft,
                onProgress: { [weak self] message in
                    Task { @MainActor in
                        self?.proofProgressMessage = message
                    }
                }
            )
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
        switch pipeline.persistPassportCredential(
            draft: draft,
            proof: proofResult,
            chip: chipSnapshot
        ) {
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
