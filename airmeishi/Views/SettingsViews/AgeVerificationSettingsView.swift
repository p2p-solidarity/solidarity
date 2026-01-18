//
//  AgeVerificationSettingsView.swift
//  airmeishi
//
//  UI for setting up ZK age verification
//

import SwiftUI

struct AgeVerificationSettingsView: View {
    @StateObject private var service = ZKAgeVerificationService.shared
    @State private var birthdate = Date()
    @State private var showingBirthdatePicker = false
    @State private var showingProofSheet = false
    @State private var proofResult: AgeProof?
    @State private var isGenerating = false

    var body: some View {
        Form {
            Section("My Age") {
                if let savedDate = service.birthdate {
                    HStack {
                        Label("Age", systemImage: "person.circle")
                        Spacer()
                        Text("\(calculateAge(from: savedDate)) years old")
                            .foregroundColor(.secondary)
                    }

                    Button("Reset Birthdate") {
                        service.clearBirthdate()
                    }
                    .foregroundColor(.red)
                } else {
                    Button {
                        showingBirthdatePicker = true
                    } label: {
                        Label("Set Birthdate", systemImage: "calendar.badge.plus")
                    }
                }
            }

            if service.birthdate != nil {
                Section("Proofs") {
                    Button {
                        generateProof(age: 18)
                    } label: {
                        Label("Prove I am 18+", systemImage: "checkmark.seal")
                    }

                    Button {
                        generateProof(age: 21)
                    } label: {
                        Label("Prove I am 21+", systemImage: "checkmark.seal.fill")
                    }
                }

                if !service.verificationHistory.isEmpty {
                    Section("Verification History") {
                        ForEach(service.verificationHistory) { record in
                            VerificationRow(record: record)
                        }
                    }
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Zero-Knowledge Privacy", systemImage: "lock.shield.fill")
                        .font(.headline)
                        .foregroundColor(.green)

                    // swiftlint:disable:next line_length
                    Text("Your birthdate is stored only on this device. When you prove your age, we generate a cryptographic proof that verifies you meet the age requirement without ever revealing your actual birthdate or age.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 8)
            }
        }
        .navigationTitle("Age Verification")
        .sheet(isPresented: $showingBirthdatePicker) {
            BirthdatePickerSheet(birthdate: $birthdate) { date in
                service.setBirthdate(date)
                showingBirthdatePicker = false
            }
        }
        .sheet(item: $proofResult) { proof in
            ProofResultSheet(proof: proof)
        }
        .overlay {
            if isGenerating {
                ProgressView("Generating ZK Proof...")
                    .padding()
                    .background(.regularMaterial)
                    .cornerRadius(8)
            }
        }
    }

    private func calculateAge(from date: Date) -> Int {
        Calendar.current.dateComponents([.year], from: date, to: Date()).year ?? 0
    }

    private func generateProof(age: Int) {
        isGenerating = true
        Task {
            do {
                let proof = try await service.generateAgeProof(
                    minimumAge: age,
                    requesterId: "self-test",
                    scope: "test-verification"
                )
                proofResult = proof
            } catch {
                print("Proof generation failed: \(error)")
            }
            isGenerating = false
        }
    }
}

// MARK: - Subviews

struct BirthdatePickerSheet: View {
    @Binding var birthdate: Date
    let onSave: (Date) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("Birthdate", selection: $birthdate, displayedComponents: .date)
                    .datePickerStyle(.graphical)
            }
            .navigationTitle("Select Birthdate")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Save") {
                        onSave(birthdate)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct ProofResultSheet: View {
    let proof: AgeProof
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: proof.meetsRequirement ? "checkmark.seal.fill" : "xmark.seal.fill")
                    .font(.system(size: 80))
                    .foregroundColor(proof.meetsRequirement ? .green : .red)

                Text(proof.meetsRequirement ? "Verified 18+" : "Verification Failed")
                    .font(.title)
                    .fontWeight(.bold)

                VStack(spacing: 8) {
                    Text("Proof ID")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(proof.id.uuidString.prefix(8))
                        .font(.system(.body, design: .monospaced))
                }

                List {
                    LabeledContent("Method", value: proof.method.displayName)
                    LabeledContent("Issued At", value: proof.issuedAt.formatted(date: .abbreviated, time: .shortened))
                    LabeledContent("Expires", value: proof.expiresAt.formatted(date: .abbreviated, time: .shortened))
                }
                .frame(height: 200)
                .scrollDisabled(true)

                Spacer()
            }
            .padding()
            .navigationTitle("Proof Details")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct VerificationRow: View {
    let record: AgeVerificationRecord

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Age check: \(record.minimumAge)+")
                    .font(.body)
                Text(record.timestamp.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if record.result {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
            }
        }
    }
}
