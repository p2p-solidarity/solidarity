//
//  OIDCRequestView.swift
//  airmeishi
//
//  View for generating and displaying OIDC Authentication Requests via QR Code.
//

import SwiftUI

struct OIDCRequestView: View {
    @State private var qrCode: UIImage?
    @State private var requestURL: URL?
    @State private var errorMessage: String?
    
    private let oidcService = OIDCService()
    
    var body: some View {
        VStack(spacing: 20) {
            Text("OpenID Request")
                .font(.title2)
                .fontWeight(.bold)
            
            if let qrCode = qrCode {
                Image(uiImage: qrCode)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(width: 250, height: 250)
                    .padding()
                    .background(Color.white)
                    .cornerRadius(12)
                    .shadow(radius: 5)
                
                if let url = requestURL {
                    Text(url.absoluteString)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                        .contextMenu {
                            Button {
                                UIPasteboard.general.string = url.absoluteString
                            } label: {
                                Label("Copy URL", systemImage: "doc.on.doc")
                            }
                        }
                }
                
                Text("Scan this QR code with another AirMeishi app to present your credential.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            } else {
                VStack {
                    Image(systemName: "qrcode")
                        .font(.system(size: 60))
                        .foregroundColor(.secondary)
                    Text("Generate a request to receive a credential")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .padding(.top, 8)
                }
                .frame(width: 250, height: 250)
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }
            
            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .foregroundColor(.red)
                    .font(.caption)
            }
            
            Button(action: generateRequest) {
                Label("Generate OIDC Request", systemImage: "qrcode")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
            .foregroundColor(.black)
            
            Spacer()
        }
        .padding()
        .navigationTitle("Receive Card")
        .navigationBarTitleDisplayMode(.inline)
    }
    
    private func generateRequest() {
        // Request a BusinessCardCredential
        let claims: [String: Any] = [
            "id_token": [
                "verifiable_credentials": [
                    "essential": true,
                    "purpose": "To exchange business cards",
                    "credential_type": "BusinessCardCredential"
                ]
            ]
        ]
        
        switch oidcService.generateRequest(claims: claims) {
        case .success(let url):
            self.requestURL = url
            if let image = oidcService.generateQRCode(from: url) {
                self.qrCode = image
                self.errorMessage = nil
            } else {
                self.errorMessage = "Failed to generate QR code image."
            }
        case .failure(let error):
            self.errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    OIDCRequestView()
}
