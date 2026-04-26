import SwiftUI

struct PassportOnboardingFlowView: View {
    let onCompleted: (PassportProofResult) -> Void
    let startInManualInput: Bool

    @Environment(\.dismiss) var dismiss
    @StateObject var pipeline = PassportPipelineViewModel()
    @State private var showingMRZCamera = false
    @State private var showManualInput: Bool

    init(startInManualInput: Bool = false, onCompleted: @escaping (PassportProofResult) -> Void) {
        self.onCompleted = onCompleted
        self.startInManualInput = startInManualInput
        self._showManualInput = State(initialValue: startInManualInput)
    }

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
                        proofStepSection
                    case .persist:
                        persistStepSection
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
                chipSnapshotCard(chip)
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
}
