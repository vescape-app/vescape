import Foundation

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt
final class BrakeLightDetector {
  private var previousSpeed: Double?
  private var previousAt: Int64?
  private var deceleration = 0.0
  private(set) var mode: String?
  func clear() {
    previousSpeed = nil
    previousAt = nil
    deceleration = 0
    mode = nil
  }
  func sample(speedKmh: Double, riding: Bool, at: Int64, sensitivity: Int) {
    guard speedKmh.isFinite else {
      clear()
      return
    }
    let speed = abs(speedKmh) / 3.6
    let oldSpeed = previousSpeed
    let dt = previousAt.map { at - $0 }
    previousSpeed = speed
    previousAt = at
    guard riding else {
      deceleration = 0
      mode = "not_riding"
      return
    }
    guard let oldSpeed, let dt else {
      mode = "riding"
      return
    }
    guard dt > 0 && dt <= 500 else {
      deceleration = 0
      mode = nil
      return
    }
    let seconds = Double(dt) / 1000
    let alpha = seconds / (0.2 + seconds)
    deceleration += alpha * ((oldSpeed - speed) / seconds - deceleration)
    let scale = 1.5 - Double(sensitivity) / 100
    let braking = scale * (mode == "braking" ? 0.75 : 1)
    let hard = scale * (mode == "hard_braking" ? 2.25 : 3)
    mode = deceleration >= hard ? "hard_braking" : deceleration >= braking ? "braking" : "riding"
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt `BrakeLightSettings`
/// @parity /modules/vescape-core/src/index.ts `BrakeLightSettings`
struct BrakeLightSettings {
  var sensitivity = 50
  var parked = "off"
  var valid: Bool { (1...100).contains(sensitivity) && ["off", "glow"].contains(parked) }
  func toMap() -> [String: Any?] { ["sensitivity": sensitivity, "parked": parked] }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/accessory/BrakeLight.kt `BrakeLightController`
final class BrakeLightController {
  struct Key: Hashable {
    let accessoryId: String
    let capabilityId: String
  }
  private final class Light {
    var settings = BrakeLightSettings()
    let detector = BrakeLightDetector()
    var preview: String?
  }
  private var lights: [Key: Light] = [:]
  private var riding = false
  private func light(_ key: Key) -> Light {
    if let light = lights[key] { return light }
    let light = Light()
    lights[key] = light
    return light
  }
  func configure(_ key: Key, _ settings: BrakeLightSettings) { light(key).settings = settings }
  func forget(_ accessoryId: String) {
    lights = lights.filter { $0.key.accessoryId != accessoryId }
  }
  /// Returns whether anything a screen renders changed, so an unchanged sample publishes nothing.
  @discardableResult
  func sample(speed: Double, engaged: Bool, at: Int64) -> Bool {
    riding = engaged
    var changed = false
    for light in lights.values {
      // Riding ends a preview: the rider is on the board and the light follows the board.
      if engaged, light.preview != nil {
        light.preview = nil
        changed = true
      }
      let before = light.detector.mode
      light.detector.sample(
        speedKmh: speed, riding: engaged, at: at, sensitivity: light.settings.sensitivity)
      if light.detector.mode != before { changed = true }
    }
    return changed
  }
  func clear() {
    riding = false
    lights.values.forEach { $0.detector.clear() }
  }
  func releasePreviews() { lights.values.forEach { $0.preview = nil } }
  func preview(_ key: Key, mode: String?) -> Bool {
    if let mode, riding || !Self.modes.contains(mode) { return false }
    guard let light = lights[key] else { return false }
    light.preview = mode
    return true
  }
  /// @parity /modules/vescape-core/src/index.ts `AccessoryCapability`
  func describe(_ key: Key) -> [String: Any?] {
    let light = light(key)
    return [
      "brakeLight": light.settings.toMap(), "lightMode": light.detector.mode,
      "lightPreview": light.preview,
    ]
  }
  func command(_ key: Key, enabled: Bool = true) -> AccessoryCommand {
    let light = light(key)
    if !enabled { return .state(capabilityId: key.capabilityId, telemetry: "available", mode: "not_riding", parked: "off", preview: false) }
    return .state(
      capabilityId: key.capabilityId,
      telemetry: light.detector.mode == nil ? "unavailable" : "available",
      mode: light.preview ?? light.detector.mode, parked: light.settings.parked,
      preview: light.preview != nil)
  }
  static let modes = ["riding", "braking", "hard_braking", "not_riding"]
}
