//
//  VCSettingsView.swift
//  airmeishi
//
//  Settings view for importing and exporting Verifiable Credentials
//

import SwiftUI
import UniformTypeIdentifiers

struct VCExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    
    var vcs: [String] = []
    
    init(vcs: [String]) {
        self.vcs = vcs
    }
    
    init(configuration: ReadConfiguration) throws {
        let data = try configuration.file.regularFileContents
        guard let data = data else { throw CocoaError(.fileReadCorruptFile) }
        let wrapper = try JSONDecoder().decode(VCExportWrapper.self, from: data)
        self.vcs = wrapper.vcs
    }
    
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        let wrapper = VCExportWrapper(vcs: vcs)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        let data = try encoder.encode(wrapper)
        return FileWrapper(regularFileWithContents: data)
    }
}

struct VCExportWrapper: Codable {
    let version: Int = 1
    let vcs: [String]
}

class VCSettingsViewModel: ObservableObject {
    @Published var importedCount: Int = 0
    @Published var errorMessage: String?
    @Published var showError: Bool = false
    @Published var successMessage: String?
    @Published var showSuccess: Bool = false
    
    private let vcService = VCService()
    private let vcLibrary = VCLibrary.shared
    
    func getAllVCs() -> [String] {
        switch vcLibrary.list() {
        case .success(let credentials):
            return credentials.map { $0.jwt }
        case .failure(let error):
            self.errorMessage = error.localizedDescription
            self.showError = true
            return []
        }
    }
    
    func importVCs(from url: URL) {
        do {
            let data = try Data(contentsOf: url)
            let wrapper = try JSONDecoder().decode(VCExportWrapper.self, from: data)
            
            var successCount = 0
            var failureCount = 0
            
            for jwt in wrapper.vcs {
                switch vcService.importPresentedCredential(jwt: jwt) {
                case .success:
                    successCount += 1
                case .failure(let error):
                    print("Failed to import VC: \(error)")
                    failureCount += 1
                }
            }
            
            DispatchQueue.main.async {
                self.importedCount = successCount
                if successCount > 0 {
                    self.successMessage = "Successfully imported \(successCount) VCs." + (failureCount > 0 ? " (\(failureCount) failed)" : "")
                    self.showSuccess = true
                } else if failureCount > 0 {
                    self.errorMessage = "Failed to import VCs. All \(failureCount) attempts failed."
                    self.showError = true
                } else {
                    self.errorMessage = "No VCs found in the file."
                    self.showError = true
                }
            }
        } catch {
            DispatchQueue.main.async {
                self.errorMessage = "Failed to read file: \(error.localizedDescription)"
                self.showError = true
            }
        }
    }
}

struct VCSettingsView: View {
    @StateObject private var viewModel = VCSettingsViewModel()
    @State private var showingExporter = false
    @State private var showingImporter = false
    @State private var exportDocument: VCExportDocument?
    
    var body: some View {
        Form {
            Section {
                Text("Manage your Verifiable Credentials (VCs) for did:key and did:ethr.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
            
            Section("Actions") {
                Button {
                    let vcs = viewModel.getAllVCs()
                    if !vcs.isEmpty {
                        exportDocument = VCExportDocument(vcs: vcs)
                        showingExporter = true
                    } else {
                        viewModel.errorMessage = "No VCs found to export."
                        viewModel.showError = true
                    }
                } label: {
                    Label("Export VCs", systemImage: "square.and.arrow.up")
                }
                
                Button {
                    showingImporter = true
                } label: {
                    Label("Import VCs", systemImage: "square.and.arrow.down")
                }
            }
        }
        .navigationTitle("VC Management")
        .fileExporter(
            isPresented: $showingExporter,
            document: exportDocument,
            contentType: .json,
            defaultFilename: "airmeishi_vcs.json"
        ) { result in
            switch result {
            case .success(let url):
                print("Saved to \(url)")
            case .failure(let error):
                viewModel.errorMessage = error.localizedDescription
                viewModel.showError = true
            }
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                guard url.startAccessingSecurityScopedResource() else { return }
                defer { url.stopAccessingSecurityScopedResource() }
                viewModel.importVCs(from: url)
            case .failure(let error):
                viewModel.errorMessage = error.localizedDescription
                viewModel.showError = true
            }
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(viewModel.errorMessage ?? "Unknown error")
        }
        .alert("Success", isPresented: $viewModel.showSuccess) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(viewModel.successMessage ?? "Operation successful")
        }
    }
}

#Preview {
    NavigationView {
        VCSettingsView()
    }
}
