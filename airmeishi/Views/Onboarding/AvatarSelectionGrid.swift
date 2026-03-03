import SwiftUI

struct AvatarSelectionGrid: View {
  @Binding var selectedAvatar: AnimalCharacter?
  let onNext: () -> Void
  let onBack: () -> Void
  
  var body: some View {
    VStack(spacing: 24) {
      // Header
      HStack {
        Button(action: onBack) {
          Image(systemName: "chevron.left")
            .foregroundColor(.white)
            .padding(12)
            .background(Color.clear)
            .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
        }
        Spacer()
      }
      .padding(.horizontal, 24)
      
      VStack(spacing: 8) {
        Text("Avatar")
          .font(.system(size: 28, weight: .bold))
          .foregroundColor(.white)
        Text("Choose your beloved creature.")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
      }
      
      // Selected Avatar Preview
      ZStack {
        // Subtle background pattern or silhouette could go here logically
        
        if let sel = selectedAvatar {
          Image(sel.imageBasename)
            .resizable()
            .scaledToFit()
            .frame(width: 150, height: 150)
            .clipShape(Circle())
            // The blue bounding box selection highlight
            .overlay(
              Rectangle()
                .stroke(Color.Theme.primaryBlue, lineWidth: 2)
                .frame(width: 160, height: 160)
            )
            .animation(.spring(response: 0.3), value: selectedAvatar)
        } else {
          Circle()
            .stroke(Color.Theme.divider, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(width: 150, height: 150)
            .overlay(Text("?").foregroundColor(Color.Theme.textTertiary))
        }
      }
      .padding(.vertical, 32)
      
      // Grid
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 24) {
          ForEach(AnimalCharacter.allCases, id: \.self) { animal in
            VStack(spacing: 8) {
              Image(animal.imageBasename)
                .resizable()
                .scaledToFit()
                .frame(width: 60, height: 60)
                .clipShape(Circle())
                .overlay(
                  Circle().stroke(selectedAvatar == animal ? Color.white : Color.clear, lineWidth: 2)
                )
                .onTapGesture {
                  HapticFeedbackManager.shared.rigidImpact()
                  withAnimation {
                    selectedAvatar = animal
                  }
                }
              
              Text(animal.rawValue.capitalized)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(selectedAvatar == animal ? .white : Color.Theme.textSecondary)
            }
          }
        }
        .padding(.horizontal, 24)
      }
      
      VStack(alignment: .leading, spacing: 8) {
        Text("About avatar")
          .font(.system(size: 14, weight: .bold))
          .foregroundColor(.white)
        
        Text("This avatar will develop alongside your journey, based on the activity level you accumulate. " +
             "As you progress, your avatar will evolve!\n\n" +
             "!!! This can't be changed afterward, so please choose wisely. " +
             "Also you can export it after the event.")
          .font(.system(size: 12))
          .foregroundColor(Color.Theme.textTertiary)
          .lineSpacing(4)
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
      .overlay(Rectangle().stroke(Color.Theme.divider, lineWidth: 1))
      .padding(.horizontal, 24)
      
      Spacer()
      
      Button(action: {
        if selectedAvatar != nil {
          HapticFeedbackManager.shared.heavyImpact()
          onNext()
        }
      }) {
        Text("This is the one, set me up")
      }
      .buttonStyle(ThemedInvertedButtonStyle())
      .disabled(selectedAvatar == nil)
      .padding(.horizontal, 24)
      .padding(.bottom, 32)
    }
    .padding(.top, 40)
    .background(Color.Theme.pageBg.ignoresSafeArea())
  }
}

// Need AnimalCharacter to mock if it's not globally available here easily.
// Let's assume AnimalCharacter exists based on ThemeManager references.
