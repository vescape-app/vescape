import CoreText
import SwiftUI

/// App typography from the shared font assets. Keep symbols in the system font.
/// @parity /watch/wearos/src/main/java/app/vescape/wear/WatchTypography.kt
enum WatchTypography {
  enum Weight: String {
    case medium = "Medium"
    case semibold = "SemiBold"
  }

  static func ui(size: CGFloat, weight: Weight = .medium) -> Font {
    let descriptor = CTFontDescriptorCreateWithAttributes([
      kCTFontNameAttribute: "Raleway-\(weight.rawValue)",
      kCTFontFeatureSettingsAttribute: [[
        kCTFontFeatureTypeIdentifierKey: kNumberCaseType,
        kCTFontFeatureSelectorIdentifierKey: kUpperCaseNumbersSelector,
      ]],
    ] as CFDictionary)
    return Font(CTFontCreateWithFontDescriptor(descriptor, size, nil))
  }

  static func mono(size: CGFloat, weight: Weight = .medium) -> Font {
    .custom("JetBrainsMono-\(weight.rawValue)", fixedSize: size)
  }
}
