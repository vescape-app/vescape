import Foundation

private let CONFIG_CHUNK_LENGTH = 384
private let CONFIG_SCHEMA_TIMEOUT_MS: Int64 = 10_000
private let CONFIG_READ_TIMEOUT_MS: Int64 = 8_000
private let CONFIG_WRITE_TIMEOUT_MS: Int64 = 10_000

private struct PendingConfigRead {
  let onSuccess: ([String: Any?]) -> Void
  let onError: (String, String) -> Void
}

private struct PendingConfigWrite {
  let onSuccess: ([String: Any?]) -> Void
  let onError: (String, String) -> Void
}

private enum ConfigWritePhase: String {
  case readingSchema = "READING_SCHEMA"
  case readingConfig = "READING_CONFIG"
  case sendingWrite = "SENDING_WRITE"
  case verifying = "VERIFYING"
}

private enum ConfigRWState {
  case idle
  case readCollectingXml(ConfigReadContext, [UInt8], Int?)
  case readAwaitingConfig(ConfigReadContext, [UInt8])
  case writeCollectingXml(ConfigWriteContext, [UInt8], Int?)
  case writeAwaitingConfig(ConfigWriteContext, [UInt8])
  case writeAwaitingSetAck(ConfigWriteContext, RefloatConfigSchema, [UInt8], [UInt8])
  case writeVerifying(ConfigWriteContext, RefloatConfigSchema, [UInt8], [UInt8])
}

private struct ConfigReadContext {
  let opId: String
  let canId: Int?
  let transport: BoardTransport
  let wasPolling: Bool
  let appBoardId: String?
  let fwVersion: String?
  var refloatVersion: String?
}

private struct ConfigWriteContext {
  let opId: String
  let canId: Int?
  let transport: BoardTransport
  let wasPolling: Bool
  let profileFields: [String: Any]
  let appBoardId: String?
  let fwVersion: String?
  var refloatVersion: String?
}

/// iOS peer of Android `ConfigRWController`: pauses polling, reads the Refloat XML schema + config
/// bytes over BLE, then either decodes a snapshot (read) or patches the profile fields, writes them
/// back via `COMM_SET_CUSTOM_CONFIG`, and verifies the readback (write). Resumes polling on finish.
///
/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt
internal final class ConfigRWController {
  private var state: ConfigRWState = .idle
  /// Every consumer waiting on the current read. A read started in the background (post-trust config
  /// acquisition) is joined by a later caller instead of rejecting it with `CONFIG_REQUEST_IN_FLIGHT`
  /// — one board read serves them all.
  private var readCallbacks: [PendingConfigRead] = []
  private var writeCallbacks: PendingConfigWrite?
  private var timeoutGeneration: Int64 = 0

  var isInFlight: Bool {
    if case .idle = state { return false }
    return true
  }

  /// Whether the in-flight operation is a read (joinable) rather than a write (not).
  private var isReadInFlight: Bool {
    switch state {
    case .readCollectingXml, .readAwaitingConfig: return true
    default: return false
    }
  }

  func consumeRead(
    connection: ConfigRWConnection,
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    if isInFlight {
      guard isReadInFlight else {
        onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.rawValue, "Config operation already in flight")
        return
      }
      // Join the read already on the wire; it completes for every waiter at once.
      readCallbacks.append(PendingConfigRead(onSuccess: onSuccess, onError: onError))
      return
    }
    guard connection.phase == .connected, connection.appBoardId != nil else {
      onError(
        RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue,
        "Board must be connected before reading Refloat config"
      )
      return
    }
    guard connection.linkIntegrity == .trusted else {
      onError(
        RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue,
        "Trusted board link required before reading Refloat config"
      )
      return
    }
    let wasPolling = connection.isPollingActive()
    connection.stopPolling()
    readCallbacks = [PendingConfigRead(onSuccess: onSuccess, onError: onError)]
    let ctx = ConfigReadContext(
      opId: UUID().uuidString.lowercased(),
      canId: connection.transport.canId,
      transport: connection.transport,
      wasPolling: wasPolling,
      appBoardId: connection.appBoardId,
      fwVersion: connection.fwVersion,
      refloatVersion: nil
    )
    state = .readCollectingXml(ctx, [], nil)
    scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
    guard send(connection, RefloatConfigProtocol.buildGetInfo(transport: ctx.transport)) else { return }
    _ = send(connection, buildXmlRequest(ctx.transport, expected: nil, nextOffset: 0))
  }

  func consumeWrite(
    profileId: String,
    connection: ConfigRWConnection,
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    if isInFlight {
      onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.rawValue, "Config operation already in flight")
      return
    }
    guard connection.phase == .connected, let connectedBoardId = connection.appBoardId, !connectedBoardId.isEmpty else {
      onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue, "Board must be connected before pushing config")
      return
    }
    guard connection.linkIntegrity == .trusted else {
      onError(
        RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue,
        "Trusted board link required before pushing config"
      )
      return
    }
    guard let profile = connection.loadProfile(profileId) else {
      onError(RefloatConfigErrorCode.PROFILE_NOT_FOUND.rawValue, "Tune profile not found: \(profileId)")
      return
    }
    let profileBoardId = (profile["boardId"] ?? nil) as? String
    if profileBoardId == nil || profileBoardId!.isEmpty || profileBoardId != connectedBoardId {
      onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.rawValue, "Tune profile does not belong to the connected board")
      return
    }
    let profileRefloatBaseVersion = (profile["refloatBaseVersion"] ?? nil) as? String
    if profileRefloatBaseVersion == nil || profileRefloatBaseVersion!.isEmpty || profileRefloatBaseVersion != connection.refloatBaseVersion {
      onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.rawValue, "Tune profile does not match the connected board Refloat Tune Compatibility")
      return
    }
    let fields = ((profile["fields"] ?? nil) as? [String: Any]) ?? [:]
    let wasPolling = connection.isPollingActive()
    connection.stopPolling()
    writeCallbacks = PendingConfigWrite(onSuccess: onSuccess, onError: onError)
    let ctx = ConfigWriteContext(
      opId: UUID().uuidString.lowercased(),
      canId: connection.transport.canId,
      transport: connection.transport,
      wasPolling: wasPolling,
      profileFields: fields,
      appBoardId: connectedBoardId,
      fwVersion: connection.fwVersion,
      refloatVersion: nil
    )
    // A board takes one connection at a time, so while this session holds the link the config can
    // only have changed through our own writes — the session's `fresh` bytes are still the board's
    // bytes and back the write directly. `provisional` values carry no write base by construction,
    // so a cache-restored session falls through to the read (ADR 0035).
    if let writeBase = connection.boardConfigValues?.writeBase {
      sendWrite(ctx, writeBase.schema, writeBase.rawConfig, writeBase.packageSignature, .sendingWrite, requestInfo: true, connection)
      return
    }
    state = .writeCollectingXml(ctx, [], nil)
    scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
    guard send(connection, RefloatConfigProtocol.buildGetInfo(transport: ctx.transport)) else { return }
    _ = send(connection, buildXmlRequest(ctx.transport, expected: nil, nextOffset: 0))
  }

  func onPayload(_ payload: [UInt8], connection: ConfigRWConnection) -> Bool {
    guard isInFlight else { return false }
    let cmd = payloadCommand(payload)
    if cmd == COMM_CUSTOM_APP_DATA {
      applyInfo(payload)
      return true
    }
    if cmd == COMM_GET_CUSTOM_CONFIG_XML {
      applyXml(payload, connection)
      return true
    }
    if cmd == COMM_GET_CUSTOM_CONFIG {
      applyConfig(payload, connection)
      return true
    }
    if cmd == COMM_SET_CUSTOM_CONFIG {
      applySetAck(payload, connection)
      return true
    }
    return false
  }

  func onSessionTerminated(_ message: String, connection: ConfigRWConnection) {
    guard isInFlight else { return }
    abort(code: .BOARD_NOT_CONNECTED, message: message, resumePolling: false, connection: connection)
  }

  private func applyInfo(_ payload: [UInt8]) {
    let version: String?
    switch RefloatConfigProtocol.parseGetInfoResponse(payload) {
    case .success(let info): version = info.version
    case .failure: version = nil
    }
    guard let version else { return }
    switch state {
    case .readCollectingXml(var ctx, let xmlBytes, let expected):
      ctx.refloatVersion = version
      state = .readCollectingXml(ctx, xmlBytes, expected)
    case .readAwaitingConfig(var ctx, let xmlBytes):
      ctx.refloatVersion = version
      state = .readAwaitingConfig(ctx, xmlBytes)
    case .writeCollectingXml(var ctx, let xmlBytes, let expected):
      ctx.refloatVersion = version
      state = .writeCollectingXml(ctx, xmlBytes, expected)
    case .writeAwaitingConfig(var ctx, let xmlBytes):
      ctx.refloatVersion = version
      state = .writeAwaitingConfig(ctx, xmlBytes)
    case .writeAwaitingSetAck(var ctx, let schema, let original, let patched):
      ctx.refloatVersion = version
      state = .writeAwaitingSetAck(ctx, schema, original, patched)
    case .writeVerifying(var ctx, let schema, let original, let patched):
      ctx.refloatVersion = version
      state = .writeVerifying(ctx, schema, original, patched)
    case .idle:
      break
    }
  }

  private func applyXml(_ payload: [UInt8], _ connection: ConfigRWConnection) {
    switch state {
    case .readCollectingXml(let ctx, let xmlBytes, _):
      switch RefloatConfigProtocol.parseCustomConfigXmlResponse(payload) {
      case .failure(let message):
        fail(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, rawConfig: nil, connection: connection)
      case .success(let chunk):
        let merged = xmlBytes + chunk.chunk
        let nextOffset = chunk.offset + chunk.chunk.count
        if nextOffset >= chunk.totalLength {
          state = .readAwaitingConfig(ctx, merged)
          cancelTimeout()
          scheduleTimeout(.CONFIG_READ_TIMEOUT, CONFIG_READ_TIMEOUT_MS, connection)
          _ = send(connection, RefloatConfigProtocol.buildGetCustomConfig(transport: ctx.transport, confInd: 0))
        } else {
          state = .readCollectingXml(ctx, merged, chunk.totalLength)
          cancelTimeout()
          scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
          _ = send(connection, buildXmlRequest(ctx.transport, expected: chunk.totalLength, nextOffset: nextOffset))
        }
      }
    case .writeCollectingXml(let ctx, let xmlBytes, _):
      switch RefloatConfigProtocol.parseCustomConfigXmlResponse(payload) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .readingSchema, rawConfig: nil, connection: connection)
      case .success(let chunk):
        let merged = xmlBytes + chunk.chunk
        let nextOffset = chunk.offset + chunk.chunk.count
        if nextOffset >= chunk.totalLength {
          state = .writeAwaitingConfig(ctx, merged)
          cancelTimeout()
          scheduleTimeout(.CONFIG_READ_TIMEOUT, CONFIG_READ_TIMEOUT_MS, connection)
          _ = send(connection, RefloatConfigProtocol.buildGetCustomConfig(transport: ctx.transport, confInd: 0))
        } else {
          state = .writeCollectingXml(ctx, merged, chunk.totalLength)
          cancelTimeout()
          scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
          _ = send(connection, buildXmlRequest(ctx.transport, expected: chunk.totalLength, nextOffset: nextOffset))
        }
      }
    default:
      break
    }
  }

  private func applyConfig(_ payload: [UInt8], _ connection: ConfigRWConnection) {
    switch state {
    case .readAwaitingConfig(let ctx, let xmlBytes):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload) {
      case .failure(let message):
        fail(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, rawConfig: nil, connection: connection)
      case .success(let configBytes):
        decodeAndCompleteRead(ctx, xmlBytes, configBytes, connection)
      }
    case .writeAwaitingConfig(let ctx, let xmlBytes):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .readingConfig, rawConfig: nil, connection: connection)
      case .success(let configBytes):
        encodeAndSendWrite(ctx, xmlBytes, configBytes, connection)
      }
    case .writeVerifying(let ctx, let schema, let original, let patched):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .verifying, rawConfig: original, connection: connection)
      case .success(let configBytes):
        verifyAndCompleteWrite(ctx, schema, original, patched, configBytes, connection)
      }
    default:
      break
    }
  }

  private func applySetAck(_ payload: [UInt8], _ connection: ConfigRWConnection) {
    guard case .writeAwaitingSetAck(let ctx, let schema, let original, let patched) = state else { return }
    switch RefloatConfigProtocol.parseSetCustomConfigResponse(payload) {
    case .failure(let message):
      failWrite(code: .CONFIG_WRITE_FAILED, message: message, phase: .sendingWrite, rawConfig: original, connection: connection)
    case .success:
      state = .writeVerifying(ctx, schema, original, patched)
      cancelTimeout()
      scheduleTimeout(.CONFIG_READ_TIMEOUT, CONFIG_READ_TIMEOUT_MS, connection)
      _ = send(connection, RefloatConfigProtocol.buildGetCustomConfig(transport: ctx.transport, confInd: 0))
    }
  }

  private func decodeAndCompleteRead(
    _ ctx: ConfigReadContext,
    _ xmlBytes: [UInt8],
    _ configBytes: RefloatConfigBytes,
    _ connection: ConfigRWConnection
  ) {
    do {
      let schema = try RefloatConfigSchemaParser.parse(xmlBytes)
      let snapshot = try RefloatConfigDecoder.decode(
        schema: schema,
        rawConfig: configBytes.config,
        boardId: ctx.appBoardId,
        canId: ctx.canId,
        capturedAt: nowMs(),
        fwVersion: ctx.fwVersion,
        refloatVersion: ctx.refloatVersion
      )
      complete(snapshot, boardConfigValues(schema, configBytes, ctx.appBoardId, connection), connection)
    } catch let error as RefloatConfigSchemaException {
      fail(code: .UNSUPPORTED_SCHEMA, message: error.message, rawConfig: configBytes.config, connection: connection)
    } catch let error as RefloatConfigDecodeException {
      fail(code: .CONFIG_DECODE_FAILED, message: error.message, rawConfig: configBytes.config, connection: connection)
    } catch {
      fail(code: .CONFIG_DECODE_FAILED, message: error.localizedDescription, rawConfig: configBytes.config, connection: connection)
    }
  }

  private func encodeAndSendWrite(
    _ ctx: ConfigWriteContext,
    _ xmlBytes: [UInt8],
    _ configBytes: RefloatConfigBytes,
    _ connection: ConfigRWConnection
  ) {
    let rawConfig = configBytes.config
    do {
      let schema = try RefloatConfigSchemaParser.parse(xmlBytes)
      sendWrite(ctx, schema, rawConfig, configBytes.packageSignature, .readingConfig, requestInfo: false, connection)
    } catch let error as RefloatConfigSchemaException {
      failWrite(code: .UNSUPPORTED_SCHEMA, message: error.message, phase: .readingConfig, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    } catch {
      failWrite(code: .CONFIG_WRITE_FAILED, message: error.localizedDescription, phase: .readingConfig, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    }
  }

  /// Patch the write base bytes with the profile fields and send `COMM_SET_CUSTOM_CONFIG`. The base
  /// is either the bytes just read or the session's retained fresh bytes; either way the whole blob
  /// is patched in place, so fields outside the curated tune groups survive untouched.
  private func sendWrite(
    _ ctx: ConfigWriteContext,
    _ schema: RefloatConfigSchema,
    _ rawConfig: [UInt8],
    _ packageSignature: UInt32,
    _ failPhase: ConfigWritePhase,
    requestInfo: Bool,
    _ connection: ConfigRWConnection
  ) {
    do {
      let patched = try RefloatConfigEncoder.encode(schema: schema, rawConfig: rawConfig, fields: ctx.profileFields)
      state = .writeAwaitingSetAck(ctx, schema, rawConfig, patched)
      cancelTimeout()
      scheduleTimeout(.CONFIG_WRITE_TIMEOUT, CONFIG_WRITE_TIMEOUT_MS, connection)
      // The read path already asked for it while collecting the schema; the skip path still needs
      // the Refloat version for the snapshot this write returns (Tune Compatibility reads it).
      if requestInfo {
        guard send(connection, RefloatConfigProtocol.buildGetInfo(transport: ctx.transport)) else { return }
      }
      _ = send(
        connection,
        RefloatConfigProtocol.buildSetCustomConfig(
          transport: ctx.transport,
          confInd: 0,
          packageSignature: packageSignature,
          configBytes: patched
        )
      )
    } catch let error as RefloatConfigEncodeException {
      failWrite(code: .CONFIG_ENCODE_FAILED, message: error.message, phase: failPhase, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    } catch {
      failWrite(code: .CONFIG_WRITE_FAILED, message: error.localizedDescription, phase: failPhase, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    }
  }

  private func verifyAndCompleteWrite(
    _ ctx: ConfigWriteContext,
    _ schema: RefloatConfigSchema,
    _ original: [UInt8],
    _ patched: [UInt8],
    _ boardConfig: RefloatConfigBytes,
    _ connection: ConfigRWConnection
  ) {
    switch RefloatConfigWriteVerifier.verifyExactBytes(expected: patched, actual: boardConfig.config) {
    case .failure(let message):
      failWrite(code: .CONFIG_VERIFY_FAILED, message: message, phase: .verifying, rawConfig: original, connection: connection)
      return
    case .success:
      break
    }
    do {
      let snapshot = try RefloatConfigDecoder.decode(
        schema: schema,
        rawConfig: boardConfig.config,
        boardId: ctx.appBoardId,
        canId: ctx.canId,
        capturedAt: nowMs(),
        fwVersion: ctx.fwVersion,
        refloatVersion: ctx.refloatVersion
      )
      completeWrite(snapshot, boardConfigValues(schema, boardConfig, ctx.appBoardId, connection), connection)
    } catch let error as RefloatConfigDecodeException {
      failWrite(code: .CONFIG_VERIFY_FAILED, message: error.message, phase: .verifying, rawConfig: original, connection: connection)
    } catch {
      failWrite(code: .CONFIG_VERIFY_FAILED, message: error.localizedDescription, phase: .verifying, rawConfig: original, connection: connection)
    }
  }

  /// Build the session's Board Config Values off the bytes just read: the whole-schema decoded map
  /// plus the retained raw bytes, package signature, and schema that a later write patches.
  private func boardConfigValues(
    _ schema: RefloatConfigSchema,
    _ configBytes: RefloatConfigBytes,
    _ boardId: String?,
    _ connection: ConfigRWConnection
  ) -> BoardConfigValues {
    RefloatConfigDecoder.decodeBoardConfigValues(
      schema: schema,
      configBytes: configBytes,
      boardId: boardId,
      refloatBaseVersion: connection.refloatBaseVersion,
      capturedAt: nowMs()
    )
  }

  private func complete(_ snapshot: RefloatConfigSnapshot, _ values: BoardConfigValues, _ connection: ConfigRWConnection) {
    let pending = readCallbacks
    readCallbacks = []
    let resume = currentResumePolling
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    connection.onBoardConfigValues(values)
    let map = snapshot.toMap()
    for callbacks in pending { callbacks.onSuccess(map) }
  }

  private func completeWrite(_ snapshot: RefloatConfigSnapshot, _ values: BoardConfigValues, _ connection: ConfigRWConnection) {
    let pending = writeCallbacks
    writeCallbacks = nil
    let resume = currentResumePolling
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    connection.onBoardConfigValues(values)
    pending?.onSuccess(snapshot.toMap())
  }

  private func fail(
    code: RefloatConfigErrorCode,
    message: String,
    rawConfig: [UInt8]?,
    resumePolling: Bool? = nil,
    connection: ConfigRWConnection
  ) {
    let pending = readCallbacks
    readCallbacks = []
    let resume = resumePolling ?? currentResumePolling
    let opId = currentOpId
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    connection.captureDiagnostic(
      code == .CONFIG_DECODE_FAILED || code == .UNSUPPORTED_SCHEMA ? "config_decode_failed" : "config_read_failed",
      [
        "operation_id": opId,
        "message": message,
        "error_code": code.rawValue,
        "firmware": connection.fwVersion,
        "raw_config_length": rawConfig?.count,
      ]
    )
    for callbacks in pending { callbacks.onError(code.rawValue, message) }
  }

  private func failWrite(
    code: RefloatConfigErrorCode,
    message: String,
    phase: ConfigWritePhase,
    rawConfig: [UInt8]?,
    resumePolling: Bool? = nil,
    connection: ConfigRWConnection
  ) {
    let pending = writeCallbacks
    writeCallbacks = nil
    let resume = resumePolling ?? currentResumePolling
    let opId = currentOpId
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    connection.captureDiagnostic(
      "profile_push_failed",
      [
        "operation_id": opId,
        "message": message,
        "error_code": code.rawValue,
        "phase": phase.rawValue,
        "firmware": connection.fwVersion,
        "raw_config_length": rawConfig?.count,
      ]
    )
    pending?.onError(code.rawValue, message)
  }

  /// Route a transport-level failure (timeout, GATT write failure, session drop) to the read or
  /// write failure handler for the current state, mirroring Android's FSM per-state phase tagging.
  private func abort(
    code: RefloatConfigErrorCode,
    message: String,
    resumePolling: Bool?,
    connection: ConfigRWConnection
  ) {
    switch state {
    case .idle:
      break
    case .readCollectingXml, .readAwaitingConfig:
      fail(code: code, message: message, rawConfig: nil, resumePolling: resumePolling, connection: connection)
    case .writeCollectingXml:
      failWrite(code: code, message: message, phase: .readingSchema, rawConfig: nil, resumePolling: resumePolling, connection: connection)
    case .writeAwaitingConfig:
      failWrite(code: code, message: message, phase: .readingConfig, rawConfig: nil, resumePolling: resumePolling, connection: connection)
    case .writeAwaitingSetAck(_, _, let original, _):
      failWrite(code: code, message: message, phase: .sendingWrite, rawConfig: original, resumePolling: resumePolling, connection: connection)
    case .writeVerifying(_, _, let original, _):
      failWrite(code: code, message: message, phase: .verifying, rawConfig: original, resumePolling: resumePolling, connection: connection)
    }
  }

  private var currentResumePolling: Bool {
    switch state {
    case .readCollectingXml(let ctx, _, _), .readAwaitingConfig(let ctx, _):
      return ctx.wasPolling
    case .writeCollectingXml(let ctx, _, _), .writeAwaitingConfig(let ctx, _):
      return ctx.wasPolling
    case .writeAwaitingSetAck(let ctx, _, _, _), .writeVerifying(let ctx, _, _, _):
      return ctx.wasPolling
    case .idle:
      return false
    }
  }

  private var currentOpId: String? {
    switch state {
    case .readCollectingXml(let ctx, _, _), .readAwaitingConfig(let ctx, _):
      return ctx.opId
    case .writeCollectingXml(let ctx, _, _), .writeAwaitingConfig(let ctx, _):
      return ctx.opId
    case .writeAwaitingSetAck(let ctx, _, _, _), .writeVerifying(let ctx, _, _, _):
      return ctx.opId
    case .idle:
      return nil
    }
  }

  private func send(_ connection: ConfigRWConnection, _ payload: [UInt8]) -> Bool {
    if !connection.sendPayload(payload) {
      abort(code: .GATT_NOT_WRITABLE, message: "Board GATT is not writable", resumePolling: nil, connection: connection)
      return false
    }
    return true
  }

  private func scheduleTimeout(
    _ code: RefloatConfigErrorCode,
    _ timeoutMs: Int64,
    _ connection: ConfigRWConnection
  ) {
    timeoutGeneration += 1
    let generation = timeoutGeneration
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(timeoutMs) / 1000.0) { [weak self] in
      guard let self, self.timeoutGeneration == generation, self.isInFlight else { return }
      self.abort(code: code, message: "Timed out reading Refloat config", resumePolling: nil, connection: connection)
    }
  }

  private func cancelTimeout() {
    timeoutGeneration += 1
  }

  private func buildXmlRequest(_ transport: BoardTransport, expected: Int?, nextOffset: Int) -> [UInt8] {
    let length = max(0, min(expected.map { $0 - nextOffset } ?? CONFIG_CHUNK_LENGTH, CONFIG_CHUNK_LENGTH))
    return RefloatConfigProtocol.buildGetCustomConfigXml(
      transport: transport,
      confInd: 0,
      length: length,
      offset: nextOffset
    )
  }

  private func payloadCommand(_ payload: [UInt8]) -> Int? {
    guard let first = payload.first else { return nil }
    if Int(first) == COMM_FORWARD_CAN, payload.count >= 3 { return Int(payload[2]) }
    return Int(first)
  }
}

private func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

internal struct ConfigRWConnection {
  let phase: BoardPhase
  let appBoardId: String?
  let transport: BoardTransport
  let fwVersion: String?
  let refloatBaseVersion: String?
  let linkIntegrity: LinkIntegrity
  /// The session's held Board Config Values. A `fresh` object carries the write base a tune push
  /// patches, which is what lets the push skip the pre-read entirely (ADR 0035).
  let boardConfigValues: BoardConfigValues?
  let isPollingActive: () -> Bool
  let stopPolling: () -> Void
  let startPolling: () -> Void
  let sendPayload: ([UInt8]) -> Bool
  let captureDiagnostic: (String, [String: Any?]) -> Void
  let loadProfile: (String) -> [String: Any?]?
  /// Hand the freshly decoded Board Config Values to the session controller, which holds them as the
  /// session's config truth, caches them, and runs warning evaluation.
  let onBoardConfigValues: (BoardConfigValues) -> Void
}

private extension BoardTransport {
  var canId: Int? {
    switch self {
    case .direct: return nil
    case .can(let canId): return canId
    }
  }
}
