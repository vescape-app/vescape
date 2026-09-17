import SwiftUI

/// The Phosphor glyphs both watches draw, as path data on Phosphor's 256x256 canvas.
///
/// Wear OS bundles these same icons as VectorDrawables; watchOS has no drawable resource to bundle
/// and no SF Symbol that matches Phosphor's duotone look, so the geometry comes across as path
/// strings instead — emitted from the same assets by the same script, so the two wrists cannot
/// drift onto different artwork. The statics live in the generated `PhosphorIcons.swift`.
///
/// @parity /watch/wearos/src/main/res/drawable
struct PhosphorIcon {
  let layers: [PhosphorLayer]
}

/// One filled shape of a glyph. Duotone icons are two: a back layer at a fifth opacity, then the
/// stroke-like front layer at full. The opacity rides with the layer rather than the colour, so a
/// call site tints a whole glyph with one colour — Compose's `tint` on the Android side.
struct PhosphorLayer {
  var opacity: Double = 1
  let path: String
}

/// Phosphor's canvas. Every path is written in these units and scaled to the frame it is drawn in.
private let PHOSPHOR_VIEWPORT: CGFloat = 256

/// A glyph layer as a `Shape`, scaled from Phosphor's canvas into whatever rect it is given.
private struct PhosphorShape: Shape {
  let layer: PhosphorLayer

  func path(in rect: CGRect) -> Path {
    let scale = min(rect.width, rect.height) / PHOSPHOR_VIEWPORT
    var path = Path()
    // The generator flattens arcs, shorthand and relative commands away, so only these four
    // survive; anything else means the two sides fell out of step and is better ignored than
    // guessed at.
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
        // A minus that is not an exponent's sign starts the next number, with no separator.
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

    // Phosphor's canvas is square; centre it in a frame that is not.
    let size = PHOSPHOR_VIEWPORT * scale
    return path.offsetBy(dx: rect.midX - size / 2, dy: rect.midY - size / 2)
  }
}

/// A tinted Phosphor glyph at an explicit point size.
///
/// Sized rather than font-scaled on purpose: these sit between rim gauges and inside split halves,
/// where a rider's text size pushing a glyph wider would break the layout rather than help it.
///
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
