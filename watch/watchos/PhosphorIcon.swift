import SwiftUI

/// @parity /watch/wearos/src/main/res/drawable
struct PhosphorIcon {
  let layers: [PhosphorLayer]
}

struct PhosphorLayer {
  var opacity: Double = 1
  let path: String
}

private let PHOSPHOR_VIEWPORT: CGFloat = 256

private struct PhosphorShape: Shape {
  let layer: PhosphorLayer

  func path(in rect: CGRect) -> Path {
    let scale = min(rect.width, rect.height) / PHOSPHOR_VIEWPORT
    var path = Path()
    var numbers: [CGFloat] = []
    var command: Character?

    func point(_ index: Int) -> CGPoint {
      CGPoint(x: numbers[index] * scale, y: numbers[index + 1] * scale)
    }
    func flush() {
      guard let command else { return }
      switch command {
      case "M" where numbers.count == 2: path.move(to: point(0))
      case "L" where numbers.count == 2: path.addLine(to: point(0))
      case "C" where numbers.count == 6:
        path.addCurve(to: point(4), control1: point(0), control2: point(2))
      default: break
      }
      numbers = []
    }

    var token = ""
    for character in layer.path {
      if character.isNumber || character == "." || character == "-" || character == "e" {
        if character == "-", !token.isEmpty, !token.hasSuffix("e") {
          numbers.append(CGFloat(Double(token) ?? 0))
          token = ""
        }
        token.append(character)
        continue
      }
      if !token.isEmpty {
        numbers.append(CGFloat(Double(token) ?? 0))
        token = ""
      }
      if character == "," { continue }
      flush()
      if character == "Z" {
        path.closeSubpath()
        command = nil
      } else {
        command = character
      }
    }
    if !token.isEmpty { numbers.append(CGFloat(Double(token) ?? 0)) }
    flush()

    let size = PHOSPHOR_VIEWPORT * scale
    return path.offsetBy(dx: rect.midX - size / 2, dy: rect.midY - size / 2)
  }
}

/// @parity /watch/wearos/src/main/res/drawable
struct PhosphorGlyph: View {
  let icon: PhosphorIcon
  var size: CGFloat
  var color: Color

  init(_ icon: PhosphorIcon, size: CGFloat, color: Color) {
    self.icon = icon
    self.size = size
    self.color = color
  }

  var body: some View {
    ZStack {
      ForEach(Array(icon.layers.enumerated()), id: \.offset) { _, layer in
        PhosphorShape(layer: layer).fill(color.opacity(layer.opacity))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}
