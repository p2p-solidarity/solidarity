import SwiftUI

struct MarkdownDocumentView: View {
  let title: String
  let resourceName: String
  let onDismiss: () -> Void

  @State private var blocks: [MarkdownBlock] = []
  @State private var loadError: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          if let loadError {
            Text(loadError)
              .font(.system(size: 13))
              .foregroundColor(Color.Theme.destructive)
              .padding(16)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(
                RoundedRectangle(cornerRadius: 12)
                  .fill(Color.Theme.mutedSurface)
              )
              .padding(.horizontal, 16)
          } else {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
              renderBlock(block)
            }
          }
        }
        .padding(.vertical, 24)
      }
      .background(Color.Theme.pageBg.ignoresSafeArea())
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        SettingsBackToolbar { onDismiss() }
      }
      .onAppear(perform: loadDocument)
    }
  }

  @ViewBuilder
  private func renderBlock(_ block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let text):
      Text(text)
        .font(.system(size: headingSize(for: level), weight: level == 1 ? .bold : .semibold))
        .foregroundColor(Color.Theme.textPrimary)
        .padding(.horizontal, 16)
        .padding(.top, level == 1 ? 8 : 4)
    case .paragraph(let text):
      Text(text)
        .font(.system(size: 14))
        .foregroundColor(Color.Theme.textSecondary)
        .lineSpacing(4)
        .padding(.horizontal, 16)
    case .bullet(let text):
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("•")
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textTertiary)
        Text(text)
          .font(.system(size: 14))
          .foregroundColor(Color.Theme.textSecondary)
          .lineSpacing(4)
      }
      .padding(.horizontal, 24)
    case .spacer:
      Spacer().frame(height: 4)
    }
  }

  private func headingSize(for level: Int) -> CGFloat {
    switch level {
    case 1: return 22
    case 2: return 18
    case 3: return 16
    default: return 15
    }
  }

  private func loadDocument() {
    guard
      let url = Bundle.main.url(forResource: resourceName, withExtension: "md"),
      let raw = try? String(contentsOf: url, encoding: .utf8)
    else {
      loadError = String(localized: "Document not available.")
      return
    }
    blocks = MarkdownDocumentView.parse(raw)
  }

  static func parse(_ raw: String) -> [MarkdownBlock] {
    var result: [MarkdownBlock] = []
    var paragraphLines: [String] = []

    func flushParagraph() {
      guard !paragraphLines.isEmpty else { return }
      let combined = paragraphLines.joined(separator: " ")
      result.append(.paragraph(stripInline(combined)))
      paragraphLines.removeAll()
    }

    for rawLine in raw.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = String(rawLine).trimmingCharacters(in: .whitespaces)
      if line.isEmpty {
        flushParagraph()
        result.append(.spacer)
        continue
      }
      if line.hasPrefix("#") {
        flushParagraph()
        let level = line.prefix(while: { $0 == "#" }).count
        let text = line.drop(while: { $0 == "#" }).trimmingCharacters(in: .whitespaces)
        result.append(.heading(min(level, 4), stripInline(String(text))))
        continue
      }
      if line.hasPrefix("- ") || line.hasPrefix("* ") {
        flushParagraph()
        let text = String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)
        result.append(.bullet(stripInline(text)))
        continue
      }
      paragraphLines.append(line)
    }
    flushParagraph()
    return result
  }

  private static func stripInline(_ text: String) -> String {
    var output = text
    output = output.replacingOccurrences(of: "**", with: "")
    output = output.replacingOccurrences(of: "__", with: "")
    return output
  }
}

enum MarkdownBlock {
  case heading(Int, String)
  case paragraph(String)
  case bullet(String)
  case spacer
}
