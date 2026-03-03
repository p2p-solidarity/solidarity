import SwiftUI

/// A component representing a single connection in the People Tab's Trust Graph.
/// Features a WinCard (Neo-Brutalist) layout, evolving badges, and a notepad snippet for ephemeral messages.
struct TrustGraphContactRow: View {
  let contact: ContactEntity
  
  // Fake properties for visual demo since CoreData might not have these yet
  // In a real app, these would be derived from the ContactEntity's cryptographic proofs
  private var mutualNodesCount: Int {
    return Int.random(in: 0...5)
  }
  
  private var encounterCount: Int {
    return Int.random(in: 1...4)
  }
  
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      
      // Top Area: Identity & Badge
      HStack(alignment: .top, spacing: 12) {
        
        // Avatar Block
        ZStack {
          Rectangle()
            .fill(Color.Theme.searchBg)
            .frame(width: 48, height: 48)
            .overlay(
              Rectangle().stroke(Color.Theme.divider, lineWidth: 1)
            )
          
          Text(String(contact.name.prefix(1)).uppercased())
            .font(.system(size: 20, weight: .bold, design: .monospaced))
            .foregroundColor(.white)
        }
        
        // Name & Title
        VStack(alignment: .leading, spacing: 4) {
          Text(contact.name)
            .font(.system(size: 18, weight: .bold))
            .foregroundColor(.white)
            .lineLimit(1)
          
          if let title = contact.title, !title.isEmpty {
            Text(title)
              .font(.system(size: 14, weight: .regular, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
              .lineLimit(1)
          }
        }
        
        Spacer()
        
        // Evolving Trust Badge
        EvolvingTrustBadge(encounterCount: encounterCount)
      }
      .padding(16)
      
      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)
      
      // Middle Area: Ephemeral Message (Notepad Snippet)
      if let message = contact.theirEphemeralMessage, !message.isEmpty {
        HStack(alignment: .top, spacing: 8) {
          Image(systemName: "quote.opening")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(Color.Theme.primaryBlue)
            .padding(.top, 2)
          
          Text(message)
            .font(.system(size: 14, weight: .medium, design: .default))
            .foregroundColor(.black)
            .lineSpacing(4)
            .italic()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        // High contrast yellow/white notepad paper look
        .background(Color.Theme.warmCream)
      } else if let notes = contact.notes, !notes.isEmpty {
        Text(notes)
          .font(.system(size: 14, design: .monospaced))
          .foregroundColor(Color.Theme.textSecondary)
          .padding(16)
      }
      
      Rectangle()
        .fill(Color.Theme.divider)
        .frame(height: 1)
      
      // Bottom Area: Terminal Metadata
      HStack {
        Text("[\(formatDate(contact.receivedAt))]")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.textTertiary)
        
        Spacer()
        
        if mutualNodesCount > 0 {
          Text("[ Mutual Nodes: \(mutualNodesCount) ]")
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.terminalGreen)
        } else {
          Text("[ Isolated Node ]")
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .background(Color.Theme.searchBg)
    }
    .background(Color.Theme.cardBg)
    .overlay(
      Rectangle().stroke(Color.Theme.divider, lineWidth: 1)
    )
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }
  
  private func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yy.MM.dd HH:mm"
    return formatter.string(from: date)
  }
}

/// A badge that changes complexity based on the number of encounters (signatures) with this person.
struct EvolvingTrustBadge: View {
  let encounterCount: Int
  
  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      if encounterCount >= 3 {
        // High Trust: ASCII Art / Complex
        Text("(★)")
          .font(.system(size: 16, weight: .black, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
          .shadow(color: Color.Theme.terminalGreen.opacity(0.5), radius: 4)
        Text("VERIFIED x\(encounterCount)")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .foregroundColor(Color.Theme.terminalGreen)
      } else if encounterCount == 2 {
        // Medium Trust: Brighter, solid
        Text("VERIFIED")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(Color.Theme.primaryBlue.opacity(0.2))
          .foregroundColor(Color.Theme.primaryBlue)
          .overlay(Rectangle().stroke(Color.Theme.primaryBlue, lineWidth: 1))
      } else {
        // Basic Trust: Standard 1px box
        Text("VERIFIED")
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .foregroundColor(Color.Theme.textSecondary)
          .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      }
    }
  }
}
