//
//  airmeishiClipApp.swift
//  airmeishiClip
//
//  App Clip entry point for viewing shared business cards
//

import SwiftUI

@main
struct airmeishiClipApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
                    // Handle incoming URL from QR code or share link
                    if let url = userActivity.webpageURL {
                        handleIncomingURL(url)
                    }
                }
        }
    }
    
    /// Handle incoming URL from QR code scan or share link
    private func handleIncomingURL(_ url: URL) {
        print("App Clip received URL: \(url)")
        
        // Parse the URL and extract business card data
        // This will be handled by the ContentView
    }
}