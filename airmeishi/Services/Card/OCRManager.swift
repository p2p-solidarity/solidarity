//
//  OCRManager.swift
//  airmeishi
//
//  Apple Vision OCR manager for extracting business card information with confidence scoring
//

import Foundation
import Vision
import UIKit

/// Manager for OCR operations using Apple Vision framework
class OCRManager: ObservableObject {
    
    /// Confidence scores for the last extraction
    @Published var lastConfidenceScores: [String: Float] = [:]
    
    /// Extract business card information from an image
    func extractBusinessCardInfo(from image: UIImage, completion: @escaping (CardResult<BusinessCard>) -> Void) {
        guard let cgImage = image.cgImage else {
            completion(.failure(.ocrError("Invalid image format")))
            return
        }
        
        let request = VNRecognizeTextRequest { [weak self] request, error in
            if let error = error {
                completion(.failure(.ocrError("Text recognition failed: \(error.localizedDescription)")))
                return
            }
            
            guard let observations = request.results as? [VNRecognizedTextObservation] else {
                completion(.failure(.ocrError("No text found in image")))
                return
            }
            
            self?.processTextObservations(observations, completion: completion)
        }
        
        // Configure text recognition for optimal business card scanning
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                completion(.failure(.ocrError("Failed to process image: \(error.localizedDescription)")))
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func processTextObservations(_ observations: [VNRecognizedTextObservation], completion: @escaping (CardResult<BusinessCard>) -> Void) {
        var extractedTexts: [(text: String, confidence: Float, boundingBox: CGRect)] = []
        
        // Extract all text with confidence scores and positions
        for observation in observations {
            guard let topCandidate = observation.topCandidates(1).first else { continue }
            
            extractedTexts.append((
                text: topCandidate.string,
                confidence: topCandidate.confidence,
                boundingBox: observation.boundingBox
            ))
        }
        
        // Sort by vertical position (top to bottom)
        extractedTexts.sort { $0.boundingBox.minY > $1.boundingBox.minY }
        
        let businessCard = extractBusinessCardFields(from: extractedTexts)
        completion(.success(businessCard))
    }
    
    private func extractBusinessCardFields(from texts: [(text: String, confidence: Float, boundingBox: CGRect)]) -> BusinessCard {
        var name = ""
        var title: String?
        var company: String?
        var email: String?
        var phone: String?
        
        // Reset confidence scores
        lastConfidenceScores = [:]
        
        var processedTexts = Set<String>()
        
        for (text, confidence, _) in texts {
            let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
            
            // Skip if already processed or too short
            if processedTexts.contains(trimmedText) || trimmedText.count < 2 {
                continue
            }
            processedTexts.insert(trimmedText)
            
            // Extract email
            if email == nil, let extractedEmail = extractEmail(from: trimmedText) {
                email = extractedEmail
                lastConfidenceScores["email"] = confidence
                continue
            }
            
            // Extract phone
            if phone == nil, let extractedPhone = extractPhone(from: trimmedText) {
                phone = extractedPhone
                lastConfidenceScores["phone"] = confidence
                continue
            }
            
            // Extract company (look for common company indicators)
            if company == nil, isLikelyCompany(trimmedText) {
                company = trimmedText
                lastConfidenceScores["company"] = confidence
                continue
            }
            
            // Extract title (look for common job titles)
            if title == nil, isLikelyJobTitle(trimmedText) {
                title = trimmedText
                lastConfidenceScores["title"] = confidence
                continue
            }
            
            // Extract name (usually the first non-company, non-title text)
            if name.isEmpty, isLikelyName(trimmedText) {
                name = trimmedText
                lastConfidenceScores["name"] = confidence
            }
        }
        
        // If no name was found, use the first text as name
        if name.isEmpty && !texts.isEmpty {
            let firstText = texts[0]
            name = firstText.text.trimmingCharacters(in: .whitespacesAndNewlines)
            lastConfidenceScores["name"] = firstText.confidence
        }
        
        return BusinessCard(
            name: name,
            title: title,
            company: company,
            email: email,
            phone: phone
        )
    }
    
    // MARK: - Text Pattern Recognition
    
    private func extractEmail(from text: String) -> String? {
        let emailRegex = #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#
        
        if let range = text.range(of: emailRegex, options: .regularExpression) {
            return String(text[range])
        }
        
        return nil
    }
    
    private func extractPhone(from text: String) -> String? {
        // Remove common separators and spaces for pattern matching
        let cleanedText = text.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
            .replacingOccurrences(of: ".", with: "")
        
        // Look for phone number patterns
        let phonePatterns = [
            #"\+?1?[0-9]{10,}"#,  // Basic 10+ digit pattern
            #"[0-9]{3}[0-9]{3}[0-9]{4}"#  // XXX-XXX-XXXX pattern
        ]
        
        for pattern in phonePatterns {
            if let range = cleanedText.range(of: pattern, options: .regularExpression) {
                let phoneNumber = String(cleanedText[range])
                // Return original text format if it looks like a phone number
                if phoneNumber.count >= 10 {
                    return text
                }
            }
        }
        
        return nil
    }
    
    private func isLikelyCompany(_ text: String) -> Bool {
        let companyIndicators = [
            "Inc", "LLC", "Corp", "Corporation", "Company", "Co.", "Ltd", "Limited",
            "Group", "Associates", "Partners", "Consulting", "Solutions", "Services",
            "Technologies", "Tech", "Systems", "Enterprises", "Holdings"
        ]
        
        let lowercaseText = text.lowercased()
        
        return companyIndicators.contains { indicator in
            lowercaseText.contains(indicator.lowercased())
        }
    }
    
    private func isLikelyJobTitle(_ text: String) -> Bool {
        let titleIndicators = [
            "CEO", "CTO", "CFO", "COO", "President", "Vice President", "VP",
            "Director", "Manager", "Senior", "Lead", "Principal", "Chief",
            "Head", "Supervisor", "Coordinator", "Specialist", "Analyst",
            "Engineer", "Developer", "Designer", "Consultant", "Associate",
            "Executive", "Officer", "Administrator", "Representative"
        ]
        
        let lowercaseText = text.lowercased()
        
        return titleIndicators.contains { indicator in
            lowercaseText.contains(indicator.lowercased())
        }
    }
    
    private func isLikelyName(_ text: String) -> Bool {
        // Basic heuristics for names
        let words = text.components(separatedBy: .whitespaces)
        
        // Should be 1-4 words
        guard words.count >= 1 && words.count <= 4 else { return false }
        
        // Each word should start with capital letter
        for word in words {
            guard let firstChar = word.first, firstChar.isUppercase else { return false }
        }
        
        // Should not contain numbers or special characters (except common name characters)
        let allowedCharacters = CharacterSet.letters.union(CharacterSet.whitespaces).union(CharacterSet(charactersIn: "'-"))
        let textCharacterSet = CharacterSet(charactersIn: text)
        
        return allowedCharacters.isSuperset(of: textCharacterSet)
    }
}
