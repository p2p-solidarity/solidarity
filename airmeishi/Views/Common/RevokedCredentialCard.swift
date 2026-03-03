import SwiftUI

/// A specialized component for the Me Tab Vault to show a credential that has been revoked or expired.
/// It uses a grayscale, dashed-border aesthetic with a "REVOKED" stamp overlay.
struct RevokedCredentialCard: View {
  let title: String
  let subtitle: String
  let revokedDate: Date
  
  var body: some View {
    ZStack {
      // Base Card (Grayscale, Dashed)
      VStack(alignment: .leading, spacing: 12) {
        
        HStack {
          Image(systemName: "doc.text.viewfinder")
            .font(.system(size: 24))
            .foregroundColor(Color.Theme.textTertiary)
          
          VStack(alignment: .leading, spacing: 4) {
            Text(title)
              .font(.system(size: 16, weight: .bold, design: .monospaced))
              .foregroundColor(Color.Theme.textSecondary)
              .strikethrough()
            
            Text(subtitle)
              .font(.system(size: 12, weight: .regular))
              .foregroundColor(Color.Theme.textTertiary)
          }
          
          Spacer()
        }
        
        Rectangle()
          .fill(Color.Theme.divider)
          .frame(height: 1)
        
        HStack {
          Text("REVOKED ON:")
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .foregroundColor(Color.Theme.textTertiary)
          
          Text(formatDate(revokedDate))
            .font(.system(size: 10, weight: .regular, design: .monospaced))
            .foregroundColor(Color.Theme.textSecondary)
        }
      }
      .padding(16)
      .background(Color.Theme.searchBg.opacity(0.5))
      .overlay(
        Rectangle()
          .stroke(Color.Theme.textTertiary, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
      )
      
      // The "Stamp" Overlay
      Text("[ REVOKED ]")
        .font(.system(size: 24, weight: .black, design: .monospaced))
        .foregroundColor(Color.Theme.destructive)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .overlay(
          Rectangle()
            .stroke(Color.Theme.destructive, lineWidth: 3)
        )
        .rotationEffect(.degrees(-15))
        .shadow(color: .black.opacity(0.5), radius: 2)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }
  
  private func formatDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy.MM.dd HH:mm"
    return formatter.string(from: date)
  }
}

#Preview {
  ZStack {
    Color.Theme.pageBg.ignoresSafeArea()
    RevokedCredentialCard(
      title: "Over-18 Verification",
      subtitle: "Proof of Age for Event Access",
      revokedDate: Date()
    )
  }
}
