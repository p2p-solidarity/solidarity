//
//  BusinessCardFormView.swift
//  airmeishi
//
//  Complete business card creation and editing form with skills categorization
//

import SwiftUI
import PhotosUI

struct BusinessCardFormView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var cardManager = CardManager.shared
    
    @State private var businessCard: BusinessCard
    @State private var isEditing: Bool
    @State private var showingImagePicker = false
    @State private var showingCamera = false
    @State private var showingOCRScanner = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var showingAlert = false
    @State private var alertMessage = ""
    @State private var isLoading = false
    @State private var showingWalletPassSheet = false
    @State private var createdCardForWallet: BusinessCard?
    @State private var isInitializing = true

    // Validation states
    @State private var nameError: String?
    @State private var emailError: String?
    @State private var phoneError: String?
    
    // Group Selection
    @State private var selectedGroupId: String?
    @State private var availableGroups: [GroupModel] = []
    
    let onSave: (BusinessCard) -> Void
    
    init(businessCard: BusinessCard? = nil, forceCreate: Bool = false, onSave: @escaping (BusinessCard) -> Void) {

        let initialCard = businessCard ?? BusinessCard(name: "")
        self._businessCard = State(initialValue: initialCard)
        if forceCreate {
            self._isEditing = State(initialValue: false)
        } else if let bc = businessCard {
            // Only treat as editing if the card already exists in storage
            let exists: Bool
            switch CardManager.shared.getCard(id: bc.id) {
            case .success:
                exists = true
            case .failure:
                exists = false
            }
            self._isEditing = State(initialValue: exists)
        } else {
            self._isEditing = State(initialValue: false)
        }
        
        // Initialize selectedGroupId from card categories
        if let tag = initialCard.categories.first(where: { $0.hasPrefix("group:") }) {
            let uuidString = String(tag.dropFirst("group:".count))
            self._selectedGroupId = State(initialValue: uuidString)
        } else if forceCreate, let currentGroupId = SemaphoreGroupManager.shared.selectedGroupId?.uuidString {
            // Pre-select group if creating from a group context
            self._selectedGroupId = State(initialValue: currentGroupId)
        } else {
            self._selectedGroupId = State(initialValue: nil)
        }
        
        self.onSave = onSave
    }
    
    var body: some View {
        // Removed debug print to reduce body re-evaluation overhead
        bodyContent
    }

    private var bodyContent: some View {
        NavigationView {
            ZStack {
                // Base layer - always visible to prevent gray screen
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()

                Form {
                    groupSection
                    basicInfoSection
                    contactInfoSection
                    animalSection
                    // socialNetworksSection - Removed due to crashes
                    simplePrivacySection
                    if businessCard.sharingPreferences.useZK {
                        Section {
                            ZKVerifyButton(businessCard: businessCard, sharingLevel: .professional)
                        } header: {
                            Text("ZK Tools")
                        }
                    }
                }
                .opacity(isInitializing ? 0 : 1)

                if isInitializing {
                    VStack(spacing: 20) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle())
                            .scaleEffect(1.5)

                        Text("Loading card...")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemGroupedBackground))
                }
            }
            .navigationTitle(isEditing ? "Edit Card" : "New Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        saveBusinessCard()
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .bold))
                            Text("Add")
                                .font(.system(size: 16, weight: .semibold))
                        }
                        .foregroundColor((isLoading || !isFormValid) ? .gray : .white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill((isLoading || !isFormValid) ? Color.gray.opacity(0.2) : Color.black)
                                .shadow(
                                    color: (isLoading || !isFormValid) ? .clear : Color.black.opacity(0.3),
                                    radius: 8,
                                    x: 0,
                                    y: 4
                                )
                        )
                    }
                    .disabled(isLoading || !isFormValid)
                }
            }
            .alert("Error", isPresented: $showingAlert) {
                Button("OK") { }
            } message: {
                Text(alertMessage)
            }
            // OCR scanner removed per new flow
            .photosPicker(isPresented: $showingImagePicker, selection: $selectedPhotoItem, matching: .images)
            .onChange(of: selectedPhotoItem) { _, newItem in
                loadSelectedImage(newItem)
            }
            .sheet(isPresented: $showingWalletPassSheet, onDismiss: { dismiss() }) {
                if let card = createdCardForWallet {
                    WalletPassGenerationView(
                        businessCard: card,
                        sharingLevel: .professional
                    )
                }
            }
            .onAppear {
                // Load available groups
                availableGroups = CloudKitGroupSyncManager.shared.getAllGroups()
                
                // Set loading state to false immediately to prevent gray screen
                DispatchQueue.main.async {
                    isInitializing = false
                }
            }
        }
        .hideKeyboardAccessory()
    }
    
    // MARK: - Form Sections
    
    // socialNetworksSection removed - feature disabled due to crashes
    
    private var simplePrivacySection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { businessCard.sharingPreferences.useZK },
                set: { businessCard.sharingPreferences.useZK = $0 }
            )) {
                VStack(alignment: .leading) {
                    Text("Zero-Knowledge Privacy")
                        .font(.headline)
                    Text("Selective Disclosure Enabled")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .tint(.purple) // Make it look premium
            
            if businessCard.sharingPreferences.useZK {
                Text("Your data is cryptographically protected. When you share via QR, only the fields you explicitly allow are revealed. The receiver verifies your identity without seeing hidden data.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        } header: {
            Label("Privacy & Security", systemImage: "lock.shield")
        }
    }

    
    private var basicInfoSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField("Full Name", text: $businessCard.name)
                    .textContentType(.name)
                    .onChange(of: businessCard.name) { _, _ in
                        validateName()
                    }
                if let error = nameError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            
            // Re-enable Job Title input (even with group), but keep company hidden
            TextField("Job Title", text: Binding(
                get: { businessCard.title ?? "" },
                set: { businessCard.title = $0.isEmpty ? nil : $0 }
            ))
            .textContentType(.jobTitle)
        } header: {
            Text("Basic Information")
        }
    }
    
    private var contactInfoSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField("Email", text: Binding(
                    get: { businessCard.email ?? "" },
                    set: { businessCard.email = $0.isEmpty ? nil : $0 }
                ))
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .onChange(of: businessCard.email) { _, _ in
                    validateEmail()
                }
                
                if let error = emailError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            
            VStack(alignment: .leading, spacing: 4) {
                TextField("Phone", text: Binding(
                    get: { businessCard.phone ?? "" },
                    set: { businessCard.phone = $0.isEmpty ? nil : $0 }
                ))
                .textContentType(.telephoneNumber)
                .keyboardType(.phonePad)
                .onChange(of: businessCard.phone) { _, _ in
                    validatePhone()
                }
                
                if let error = phoneError {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                }
            }
            
            // Scan business card removed per new flow
        } header: {
            Text("Contact Information (Sensitive Information)")
        }
    }

    private var animalSection: some View {
        Section {
            AnimalSelectorView(selection: Binding(
                get: { businessCard.animal ?? .dog },
                set: { businessCard.animal = $0 }
            ))
        } header: {
            Text("Card Character")
        } footer: {
            if let animal = businessCard.animal {
                Text(animal.personality).font(.caption).foregroundColor(.secondary)
            } else {
                EmptyView()
            }
        }
    }
    
    
    // MARK: - Computed Properties
    
    private var isFormValid: Bool {
        !businessCard.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        nameError == nil &&
        emailError == nil &&
        phoneError == nil
    }
    
    // MARK: - Methods
    
    private func saveBusinessCard() {
        isLoading = true
        
        // Update group tag based on selection
        businessCard.categories.removeAll { $0.hasPrefix("group:") }
        if let gid = selectedGroupId {
            businessCard.categories.append("group:\(gid)")
        }

        let result = isEditing ? 
            cardManager.updateCard(businessCard) : 
            cardManager.createCard(businessCard)
        
        switch result {
        case .success(let savedCard):
            onSave(savedCard)
            if isEditing {
                dismiss()
            } else {
                createdCardForWallet = savedCard
                showingWalletPassSheet = true
            }
        case .failure(let error):
            alertMessage = error.localizedDescription
            showingAlert = true
        }
        
        isLoading = false
    }
    
    private func validateName() {
        let trimmedName = businessCard.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            nameError = "Name is required"
        } else {
            nameError = nil
        }
    }
    
    private func validateEmail() {
        guard let email = businessCard.email, !email.isEmpty else {
            emailError = nil
            return
        }
        
        let emailRegex = "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$"
        let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        
        if !emailPredicate.evaluate(with: email) {
            emailError = "Invalid email format"
        } else {
            emailError = nil
        }
    }
    
    private func validatePhone() {
        guard let phone = businessCard.phone, !phone.isEmpty else {
            phoneError = nil
            return
        }
        
        let phoneRegex = "^[+]?[0-9\\s\\-\\(\\)]{10,}$"
        let phonePredicate = NSPredicate(format: "SELF MATCHES %@", phoneRegex)
        
        if !phonePredicate.evaluate(with: phone) {
            phoneError = "Invalid phone format"
        } else {
            phoneError = nil
        }
    }
    
    // Social network functions removed - feature disabled
    
    private func loadSelectedImage(_ item: PhotosPickerItem?) {
        guard let item = item else { return }
        
        item.loadTransferable(type: Data.self) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let data):
                    if let data = data {
                        businessCard.profileImage = data
                    }
                case .failure(let error):
                    alertMessage = "Failed to load image: \(error.localizedDescription)"
                    showingAlert = true
                }
            }
        }
    }
    
    private func applyExtractedData(_ extractedCard: BusinessCard) {
        // Apply OCR extracted data to current card
        if !extractedCard.name.isEmpty {
            businessCard.name = extractedCard.name
        }
        if let title = extractedCard.title, !title.isEmpty {
            businessCard.title = title
        }
        if let company = extractedCard.company, !company.isEmpty {
            businessCard.company = company
        }
        if let email = extractedCard.email, !email.isEmpty {
            businessCard.email = email
        }
        if let phone = extractedCard.phone, !phone.isEmpty {
            businessCard.phone = phone
        }
        
        // Validate after applying extracted data
        validateName()
        validateEmail()
        validatePhone()
    }

    // MARK: - Helpers
    private func groupForCurrentCard() -> SemaphoreGroupManager.ManagedGroup? {
        if let tag = businessCard.categories.first(where: { $0.hasPrefix("group:") }) {
            let uuidString = String(tag.dropFirst("group:".count))
            if let id = UUID(uuidString: uuidString) {
                return SemaphoreGroupManager.shared.allGroups.first(where: { $0.id == id })
            }
        }
        return nil
    }

    // Group Selection Section
    private var groupSection: some View {
        Section {
            if let selectedId = selectedGroupId, let group = availableGroups.first(where: { $0.id == selectedId }) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(LinearGradient(colors: [.purple, .blue], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 32, height: 32)
                        Image(systemName: "person.3.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.name)
                            .font(.headline)
                            .foregroundColor(.primary)
                        Text("Issuing Group")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        selectedGroupId = nil
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.gray)
                            .font(.system(size: 22))
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                .padding(.vertical, 4)
                
                NavigationLink("Change Group") {
                    GroupSelectionView(groups: availableGroups, selectedGroupId: $selectedGroupId)
                }
            } else {
                HStack {
                    Text("Not linked to any group")
                        .foregroundColor(.secondary)
                    Spacer()
                    NavigationLink("Link to Group") {
                        GroupSelectionView(groups: availableGroups, selectedGroupId: $selectedGroupId)
                    }
                }
            }
        } header: {
            Text("Group Affiliation")
        }
    }
}

struct GroupSelectionView: View {
    let groups: [GroupModel]
    @Binding var selectedGroupId: String?
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        List {
            Section {
                Button(action: {
                    selectedGroupId = nil
                    dismiss()
                }) {
                    HStack {
                        Text("None")
                            .foregroundColor(.primary)
                        Spacer()
                        if selectedGroupId == nil {
                            Image(systemName: "checkmark")
                                .foregroundColor(.blue)
                        }
                    }
                }
            }
            
            Section("Available Groups") {
                ForEach(groups) { group in
                    Button(action: {
                        selectedGroupId = group.id
                        dismiss()
                    }) {
                        HStack {
                            Text(group.name)
                                .foregroundColor(.primary)
                            Spacer()
                            if selectedGroupId == group.id {
                                Image(systemName: "checkmark")
                                .foregroundColor(.blue)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Select Group")
    }
}

#Preview {
    BusinessCardFormView { _ in }
}