//
//  CloudSharingView.swift
//  airmeishi
//
//  Created by AirMeishi Team.
//

import SwiftUI
import CloudKit
import UIKit

struct CloudSharingView: UIViewControllerRepresentable {
    let share: CKShare
    let container: CKContainer
    
    func makeUIViewController(context: Context) -> UICloudSharingController {
        let controller = UICloudSharingController(share: share, container: container)
        controller.modalPresentationStyle = .formSheet
        controller.delegate = context.coordinator
        return controller
    }
    
    func updateUIViewController(_ uiViewController: UICloudSharingController, context: Context) {}
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject, UICloudSharingControllerDelegate {
        let parent: CloudSharingView
        
        init(_ parent: CloudSharingView) {
            self.parent = parent
        }
        
        func cloudSharingController(_ csc: UICloudSharingController, failedToSaveShareWithError error: Error) {
            print("Failed to save share: \(error)")
        }
        
        func itemTitle(for csc: UICloudSharingController) -> String? {
            return parent.share[CKShare.SystemFieldKey.title] as? String ?? "Group"
        }
        
        // Optional: Handle other delegate methods if needed
    }
}
