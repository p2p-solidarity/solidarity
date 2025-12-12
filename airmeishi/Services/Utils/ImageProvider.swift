//
//  ImageProvider.swift
//  airmeishi
//
//  Lightweight loader for animal images from app bundle Resources.
//

import SwiftUI
import UIKit

struct ImageProvider {
    /// Load a SwiftUI Image for a given animal. Prefers PNG under Resources.
    static func animalImage(for animal: AnimalCharacter) -> Image {
        // Try exact PNG first
        if let ui = loadImage(named: animal.imageBasename + ".png") {
            return Image(uiImage: ui).renderingMode(.original)
        }
        // Try alternative numbered PNGs if exist
        if let ui = loadImage(named: animal.imageBasename + "-1.png") {
            return Image(uiImage: ui).renderingMode(.original)
        }
        // Fallback to SF Symbol per animal
        switch animal {
        case .dog:
            return Image(systemName: "dog")
        case .horse:
            return Image(systemName: "hare")
        case .pig:
            return Image(systemName: "figure.strengthtraining.traditional")
        case .sheep:
            return Image(systemName: "cloud")
        case .dove:
            return Image(systemName: "leaf")
        }
    }

    private static func loadImage(named: String) -> UIImage? {
        if let url = Bundle.main.url(forResource: named.replacingOccurrences(of: ".png", with: ""), withExtension: "png") {
            if let data = try? Data(contentsOf: url), let img = UIImage(data: data) {
                return img
            }
        }
        // Try locating inside Resources subdirectory
        if let resourceURL = Bundle.main.resourceURL?.appendingPathComponent("Resources").appendingPathComponent(named),
           let data = try? Data(contentsOf: resourceURL),
           let img = UIImage(data: data) {
            return img
        }
        return nil
    }
}
