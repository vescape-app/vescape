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
  case writeAwaitingIdle(ConfigWriteContext, RefloatConfigSchema, [UInt8], [UInt8], UInt32, Int64)
  case writeAwaitingSetAck(ConfigWriteContext, RefloatConfigSchema, [UInt8], [UInt8], UInt32)
  case writeVerifying(ConfigWriteContext, RefloatConfigSchema, [UInt8], [UInt8], UInt32)
}

private struct ConfigReadContext {
  let opId: String
  let canId: Int?
  let transport: BoardTransport
  let wasPolling: Bool
  let appBoardId: String?
  let fwVersion: String?
  var refloatVersion: String?
  var xmlRetried = false
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWStates.kt `ConfigWriteIntent`
internal enum ConfigWriteIntent {
  case changeset([String: Any], source: BoardConfigRevisionSource = .app, expectedSchemaHash: String? = nil)
  case profile(id: String, fields: [String: Any])
}

private struct ConfigWriteContext {
  let opId: String
  let canId: Int?
  let transport: BoardTransport
  let wasPolling: Bool
  let intent: ConfigWriteIntent
  let appBoardId: String?
  let fwVersion: String?
  var refloatVersion: String?
  var xmlRetried = false
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt
internal final class ConfigRWController {
  private let scheduler: Scheduler
  private let profileExecutor: (@escaping () -> Void) -> Void
  private let completeOnSession: (@escaping () -> Void) -> Void
  private let nowMs: () -> Int64
  private var state: ConfigRWState = .idle
  private var readCallbacks: [PendingConfigRead] = []
  private var writeCallbacks: PendingConfigWrite?
  private var activeSetFrameTag: String?
  private var timeoutGeneration: Int64 = 0

  init(
    scheduler: Scheduler = MainQueueScheduler(),
    profileExecutor: @escaping (@escaping () -> Void) -> Void = { $0() },
    completeOnSession: @escaping (@escaping () -> Void) -> Void = { $0() },
    nowMs: @escaping () -> Int64 = wallNowMs
  ) {
    self.scheduler = scheduler
    self.profileExecutor = profileExecutor
    self.completeOnSession = completeOnSession
    self.nowMs = nowMs
  }

  var isInFlight: Bool {
    if case .idle = state { return false }
    return true
  }

  var isWriteInFlight: Bool {
    switch state {
    case .writeCollectingXml, .writeAwaitingConfig, .writeAwaitingIdle, .writeAwaitingSetAck, .writeVerifying:
      return true
    default:
      return false
    }
  }

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
      readCallbacks.append(PendingConfigRead(onSuccess: onSuccess, onError: onError))
      return
    }
    guard connection.liveConnected else {
      onError(
        RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue,
        "Board must be connected before reading Refloat config"
      )
      return
    }
    guard connection.currentLinkIntegrity == .trusted else {
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

  func consumeChangeset(
    boardId: String,
    changes: [String: Any],
    source: BoardConfigRevisionSource = .app,
    expectedSchemaHash: String? = nil,
    connection: ConfigRWConnection,
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    if isInFlight {
      onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.rawValue, "Config operation already in flight")
      return
    }
    guard connection.liveConnected, let connectedBoardId = connection.appBoardId, !connectedBoardId.isEmpty else {
      onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue, "Board must be connected before pushing config")
      return
    }
    guard connection.currentLinkIntegrity == .trusted else {
      onError(
        RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue,
        "Trusted board link required before pushing config"
      )
      return
    }
    let startedAtMs = nowMs()
    if let reason = idleBlockReason(connection, startedAtMs) {
      onError(RefloatConfigErrorCode.BOARD_NOT_IDLE.rawValue, reason)
      return
    }
    guard connectedBoardId == boardId else {
      onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue, "Requested board is not the connected board")
      return
    }
    startWriteOperation(
      intent: .changeset(changes, source: source, expectedSchemaHash: expectedSchemaHash),
      connectedBoardId: connectedBoardId,
      startedAtMs: startedAtMs,
      connection: connection,
      onSuccess: onSuccess,
      onError: onError
    )
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
    guard connection.liveConnected, let initialBoardId = connection.appBoardId, !initialBoardId.isEmpty else {
      onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue, "Board must be connected before pushing config")
      return
    }
    guard connection.currentLinkIntegrity == .trusted else {
      onError(
        RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue,
        "Trusted board link required before pushing config"
      )
      return
    }
    let initialStartedAtMs = nowMs()
    if let reason = idleBlockReason(connection, initialStartedAtMs) {
      onError(RefloatConfigErrorCode.BOARD_NOT_IDLE.rawValue, reason)
      return
    }
    profileExecutor { [weak self] in
      let loadedProfile: [String: Any?]?
      do {
        loadedProfile = try connection.loadProfile(profileId)
      } catch {
        self?.completeOnSession {
          onError(RefloatConfigErrorCode.CONFIG_READ_FAILED.rawValue, "Tune profile could not be loaded")
        }
        return
      }
      self?.completeOnSession { [weak self] in
        guard let self else { return }
        guard let profile = loadedProfile else {
          onError(RefloatConfigErrorCode.PROFILE_NOT_FOUND.rawValue, "Tune profile not found: \(profileId)")
          return
        }
        if self.isInFlight {
          onError(RefloatConfigErrorCode.CONFIG_REQUEST_IN_FLIGHT.rawValue, "Config operation already in flight")
          return
        }
        guard connection.liveConnected, let connectedBoardId = connection.appBoardId, !connectedBoardId.isEmpty else {
          onError(RefloatConfigErrorCode.BOARD_NOT_CONNECTED.rawValue, "Board must be connected before pushing config")
          return
        }
        guard connection.currentLinkIntegrity == .trusted else {
          onError(
            RefloatConfigErrorCode.LINK_NOT_TRUSTED.rawValue,
            "Trusted board link required before pushing config"
          )
          return
        }
        let profileBoardId = (profile["boardId"] ?? nil) as? String
        if profileBoardId == nil || profileBoardId!.isEmpty || profileBoardId != connectedBoardId {
          onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.rawValue, "Tune profile does not belong to the connected board")
          return
        }
        let profileRefloatBaseVersion = TuneProfileStore.validRefloatBaseVersion((profile["refloatBaseVersion"] ?? nil) as? String)
        if profileRefloatBaseVersion == nil || profileRefloatBaseVersion!.isEmpty || profileRefloatBaseVersion != TuneProfileStore.validRefloatBaseVersion(connection.refloatBaseVersion) {
          onError(RefloatConfigErrorCode.PROFILE_BOARD_MISMATCH.rawValue, "Tune profile does not match the connected board Refloat Tune Compatibility")
          return
        }
        let startedAtMs = self.nowMs()
        if let reason = self.idleBlockReason(connection, startedAtMs) {
          onError(RefloatConfigErrorCode.BOARD_NOT_IDLE.rawValue, reason)
          return
        }
        let storedFields = ((profile["fields"] ?? nil) as? [String: Any]) ?? [:]
        self.startWriteOperation(
          intent: .profile(id: profileId, fields: storedFields),
          connectedBoardId: connectedBoardId,
          startedAtMs: startedAtMs,
          connection: connection,
          onSuccess: onSuccess,
          onError: onError
        )
      }
    }
  }

  private func startWriteOperation(
    intent: ConfigWriteIntent,
    connectedBoardId: String,
    startedAtMs: Int64,
    connection: ConfigRWConnection,
    onSuccess: @escaping ([String: Any?]) -> Void,
    onError: @escaping (String, String) -> Void
  ) {
    let wasPolling = connection.isPollingActive()
    connection.stopPolling()
    writeCallbacks = PendingConfigWrite(onSuccess: onSuccess, onError: onError)
    let ctx = ConfigWriteContext(
      opId: UUID().uuidString.lowercased(),
      canId: connection.transport.canId,
      transport: connection.transport,
      wasPolling: wasPolling,
      intent: intent,
      appBoardId: connectedBoardId,
      fwVersion: connection.fwVersion,
      refloatVersion: connection.refloatVersion
    )
    if let writeBase = connection.currentBoardConfigValues?.writeBase {
      sendWrite(
        ctx,
        writeBase.schema,
        RefloatConfigBytes(confInd: 0, packageSignature: writeBase.packageSignature, config: writeBase.rawConfig),
        capturedAtMs: startedAtMs,
        fromFreshRead: false,
        .sendingWrite,
        connection
      )
      return
    }
    state = .writeCollectingXml(ctx, [], nil)
    scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
    guard send(connection, RefloatConfigProtocol.buildGetInfo(transport: ctx.transport)) else { return }
    _ = send(connection, buildXmlRequest(ctx.transport, expected: nil, nextOffset: 0))
  }

  func onPayload(_ payload: [UInt8], connection: ConfigRWConnection) -> Bool {
    guard let transport = currentTransport else { return false }
    guard RefloatConfigProtocol.matchesTransport(payload, transport: transport) else { return false }
    let cmd = payloadCommand(payload)
    if cmd == COMM_CUSTOM_APP_DATA {
      return applyInfo(payload, transport: transport)
    }
    if cmd == COMM_GET_CUSTOM_CONFIG_XML {
      applyXml(payload, transport: transport, connection: connection)
      return true
    }
    if cmd == COMM_GET_CUSTOM_CONFIG {
      applyConfig(payload, transport: transport, connection: connection)
      return true
    }
    if cmd == COMM_SET_CUSTOM_CONFIG {
      applySetAck(payload, transport: transport, connection: connection)
      return true
    }
    return false
  }

  func onRideState(_ rideState: BoardRideState, connection: ConfigRWConnection) {
    guard case .writeAwaitingIdle(let ctx, let schema, let original, let patched, let expectedSignature, let minRideStateAtMs) = state else {
      return
    }
    guard rideState.receivedAtMs >= minRideStateAtMs else { return }
    let freshSinceMs = max(minRideStateAtMs, BoardIdleGate.freshSinceMs(nowMs()))
    if let reason = BoardIdleGate.blockReason(rideState, freshSinceMs: freshSinceMs) {
      failWrite(
        code: .BOARD_NOT_IDLE,
        message: reason,
        phase: .sendingWrite,
        rawConfig: original,
        resumePolling: ctx.wasPolling,
        connection: connection
      )
      return
    }
    transmitSetConfig(
      ctx,
      schema: schema,
      original: original,
      patched: patched,
      expectedSignature: expectedSignature,
      minRideStateAtMs: minRideStateAtMs,
      connection: connection
    )
  }

  func onSessionTerminated(_ message: String, connection: ConfigRWConnection) {
    cancelQueuedSetFrames(connection)
    guard isInFlight else { return }
    abort(code: .BOARD_NOT_CONNECTED, message: message, resumePolling: false, connection: connection)
  }

  private func applyInfo(_ payload: [UInt8], transport: BoardTransport) -> Bool {
    let version: String
    switch RefloatConfigProtocol.parseGetInfoResponse(payload, transport: transport) {
    case .success(let info): version = info.version
    case .failure: return false
    }
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
    case .writeAwaitingIdle(var ctx, let schema, let original, let patched, let sig, let minAtMs):
      ctx.refloatVersion = version
      state = .writeAwaitingIdle(ctx, schema, original, patched, sig, minAtMs)
    case .writeAwaitingSetAck(var ctx, let schema, let original, let patched, let sig):
      ctx.refloatVersion = version
      state = .writeAwaitingSetAck(ctx, schema, original, patched, sig)
    case .writeVerifying(var ctx, let schema, let original, let patched, let sig):
      ctx.refloatVersion = version
      state = .writeVerifying(ctx, schema, original, patched, sig)
    case .idle:
      return false
    }
    return true
  }

  private func applyXml(_ payload: [UInt8], transport: BoardTransport, connection: ConfigRWConnection) {
    switch state {
    case .readCollectingXml(var ctx, let xmlBytes, _):
      switch RefloatConfigProtocol.parseCustomConfigXmlResponse(payload, transport: transport) {
      case .failure(let message):
        fail(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, rawConfig: nil, connection: connection)
      case .success(let chunk):
        guard chunk.offset == xmlBytes.count else { return }
        ctx.xmlRetried = false
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
    case .writeCollectingXml(var ctx, let xmlBytes, _):
      switch RefloatConfigProtocol.parseCustomConfigXmlResponse(payload, transport: transport) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .readingSchema, rawConfig: nil, connection: connection)
      case .success(let chunk):
        guard chunk.offset == xmlBytes.count else { return }
        ctx.xmlRetried = false
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

  private func applyConfig(_ payload: [UInt8], transport: BoardTransport, connection: ConfigRWConnection) {
    switch state {
    case .readAwaitingConfig(let ctx, let xmlBytes):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload, transport: transport) {
      case .failure(let message):
        fail(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, rawConfig: nil, connection: connection)
      case .success(let configBytes):
        decodeAndCompleteRead(ctx, xmlBytes, configBytes, connection)
      }
    case .writeAwaitingConfig(let ctx, let xmlBytes):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload, transport: transport) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .readingConfig, rawConfig: nil, connection: connection)
      case .success(let configBytes):
        encodeAndSendWrite(ctx, xmlBytes, configBytes, connection)
      }
    case .writeVerifying(let ctx, let schema, let original, let patched, let expectedSignature):
      switch RefloatConfigProtocol.parseCustomConfigResponse(payload, transport: transport) {
      case .failure(let message):
        failWrite(code: .UNEXPECTED_CONFIG_RESPONSE, message: message, phase: .verifying, rawConfig: original, connection: connection)
      case .success(let configBytes):
        verifyAndCompleteWrite(ctx, schema, original, patched, expectedSignature, configBytes, connection)
      }
    default:
      break
    }
  }

  private func applySetAck(_ payload: [UInt8], transport: BoardTransport, connection: ConfigRWConnection) {
    guard case .writeAwaitingSetAck(let ctx, let schema, let original, let patched, let expectedSignature) = state else { return }
    switch RefloatConfigProtocol.parseSetCustomConfigResponse(payload, transport: transport) {
    case .failure(let message):
      failWrite(code: .CONFIG_WRITE_FAILED, message: message, phase: .sendingWrite, rawConfig: original, connection: connection)
    case .success:
      state = .writeVerifying(ctx, schema, original, patched, expectedSignature)
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
      let values = try boardConfigValues(
        schema,
        configBytes,
        ctx.appBoardId,
        connection,
        refloatBaseVersion: connection.refloatBaseVersion ?? RefloatConfigProtocol.normalizeBaseVersion(ctx.refloatVersion),
        refloatVersion: ctx.refloatVersion ?? connection.refloatVersion
      )
      complete(values, connection)
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
      sendWrite(ctx, schema, configBytes, capturedAtMs: nowMs(), fromFreshRead: true, .readingConfig, connection)
    } catch let error as RefloatConfigSchemaException {
      failWrite(code: .UNSUPPORTED_SCHEMA, message: error.message, phase: .readingConfig, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    } catch {
      failWrite(code: .CONFIG_WRITE_FAILED, message: error.localizedDescription, phase: .readingConfig, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    }
  }

  private func sendWrite(
    _ ctx: ConfigWriteContext,
    _ schema: RefloatConfigSchema,
    _ configBytes: RefloatConfigBytes,
    capturedAtMs: Int64,
    fromFreshRead: Bool,
    _ failPhase: ConfigWritePhase,
    _ connection: ConfigRWConnection
  ) {
    let rawConfig = configBytes.config
    if case .changeset(_, _, let expectedSchemaHash) = ctx.intent,
       let expectedSchemaHash,
       !expectedSchemaHash.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
       schema.hash != expectedSchemaHash {
      failWrite(
        code: .CONFIG_SCHEMA_MISMATCH,
        message: "Board config schema changed (expected \(expectedSchemaHash), got \(schema.hash))",
        phase: failPhase,
        rawConfig: rawConfig,
        resumePolling: ctx.wasPolling,
        connection: connection
      )
      return
    }
    do {
      let freshValues: BoardConfigValues? = fromFreshRead
        ? try boardConfigValues(
            schema,
            configBytes,
            ctx.appBoardId,
            connection,
            capturedAtMs: capturedAtMs,
            refloatVersion: ctx.refloatVersion ?? connection.refloatVersion
          )
        : nil
      let changes = resolveChanges(ctx.intent, schema: schema)
      let encoded = try RefloatConfigEncoder.encodeChangeset(schema: schema, rawConfig: rawConfig, changes: changes)
      if encoded.changedFieldIds.isEmpty {
        let values = try freshValues ?? boardConfigValues(
          schema,
          configBytes,
          ctx.appBoardId,
          connection,
          capturedAtMs: capturedAtMs,
          refloatVersion: ctx.refloatVersion ?? connection.refloatVersion
        )
        completeWrite(
          values,
          origin: .freshRead,
          emitBoardConfigValues: fromFreshRead,
          resumePolling: ctx.wasPolling,
          connection
        )
        return
      }
      if fromFreshRead {
        if let freshValues {
          connection.onBoardConfigValues(freshValues, .freshRead)
        }
        state = .writeAwaitingIdle(
          ctx,
          schema,
          rawConfig,
          encoded.rawConfig,
          configBytes.packageSignature,
          capturedAtMs
        )
        cancelTimeout()
        scheduleTimeout(.BOARD_NOT_IDLE, CONFIG_READ_TIMEOUT_MS, connection)
        _ = send(connection, RefloatConfigProtocol.buildGetAllData(transport: ctx.transport))
        return
      }
      transmitSetConfig(
        ctx,
        schema: schema,
        original: rawConfig,
        patched: encoded.rawConfig,
        expectedSignature: configBytes.packageSignature,
        minRideStateAtMs: nil,
        connection: connection
      )
    } catch let error as RefloatConfigEncodeException {
      failWrite(code: error.code, message: error.message, phase: failPhase, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    } catch let error as RefloatConfigDecodeException {
      failWrite(code: .CONFIG_DECODE_FAILED, message: error.message, phase: failPhase, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    } catch {
      failWrite(code: .CONFIG_WRITE_FAILED, message: error.localizedDescription, phase: failPhase, rawConfig: rawConfig, resumePolling: ctx.wasPolling, connection: connection)
    }
  }

  private func transmitSetConfig(
    _ ctx: ConfigWriteContext,
    schema: RefloatConfigSchema,
    original: [UInt8],
    patched: [UInt8],
    expectedSignature: UInt32,
    minRideStateAtMs: Int64?,
    connection: ConfigRWConnection
  ) {
    guard connection.liveConnected else {
      failWrite(
        code: .BOARD_NOT_CONNECTED,
        message: "Board must be connected before pushing config",
        phase: .sendingWrite,
        rawConfig: original,
        resumePolling: ctx.wasPolling,
        connection: connection
      )
      return
    }
    guard connection.currentLinkIntegrity == .trusted else {
      failWrite(
        code: .LINK_NOT_TRUSTED,
        message: "Trusted board link required before pushing config",
        phase: .sendingWrite,
        rawConfig: original,
        resumePolling: ctx.wasPolling,
        connection: connection
      )
      return
    }
    if let reason = idleBlockReason(connection, nowMs(), minRideStateAtMs: minRideStateAtMs) {
      failWrite(
        code: .BOARD_NOT_IDLE,
        message: reason,
        phase: .sendingWrite,
        rawConfig: original,
        resumePolling: ctx.wasPolling,
        connection: connection
      )
      return
    }
    state = .writeAwaitingSetAck(ctx, schema, original, patched, expectedSignature)
    cancelTimeout()
    scheduleTimeout(.CONFIG_WRITE_TIMEOUT, CONFIG_WRITE_TIMEOUT_MS, connection)
    let tag = setFrameTag(ctx.opId)
    activeSetFrameTag = tag
    _ = send(
      connection,
      RefloatConfigProtocol.buildSetCustomConfig(
        transport: ctx.transport,
        confInd: 0,
        packageSignature: expectedSignature,
        configBytes: patched
      ),
      tag: tag
    )
  }

  private func resolveChanges(_ intent: ConfigWriteIntent, schema: RefloatConfigSchema) -> [String: Any] {
    switch intent {
    case .changeset(let changes, _, _):
      return changes
    case .profile(_, let fields):
      let schemaIds = Set(schema.fields.map(\.id))
      let internalSchemaIds = RefloatConfigEncoder.collectInternalSchemaFieldIds(schema)
      return fields.filter { fieldId, _ in
        schemaIds.contains(fieldId)
          && !RefloatConfigEncoder.isInternalField(fieldId, internalSchemaIds: internalSchemaIds)
      }
    }
  }

  private func verifyAndCompleteWrite(
    _ ctx: ConfigWriteContext,
    _ schema: RefloatConfigSchema,
    _ original: [UInt8],
    _ patched: [UInt8],
    _ expectedSignature: UInt32,
    _ boardConfig: RefloatConfigBytes,
    _ connection: ConfigRWConnection
  ) {
    guard boardConfig.packageSignature == expectedSignature else {
      failWrite(
        code: .CONFIG_VERIFY_FAILED,
        message: "Verification failed: package signature mismatch (expected \(expectedSignature), got \(boardConfig.packageSignature))",
        phase: .verifying,
        rawConfig: original,
        connection: connection
      )
      return
    }
    switch RefloatConfigWriteVerifier.verify(schema: schema, written: patched, readBack: boardConfig.config) {
    case .failure(let message):
      failWrite(code: .CONFIG_VERIFY_FAILED, message: message, phase: .verifying, rawConfig: original, connection: connection)
      return
    case .success:
      break
    }
    do {
      let values = try boardConfigValues(
        schema,
        boardConfig,
        ctx.appBoardId,
        connection,
        refloatVersion: ctx.refloatVersion ?? connection.refloatVersion
      )
      let origin: BoardConfigOperationOrigin
      switch ctx.intent {
      case .changeset(_, let source, _):
        origin = .vescapeWrite(source: source, tuneProfileId: nil)
      case .profile(let profileId, _):
        origin = .vescapeWrite(source: .app, tuneProfileId: profileId)
      }
      completeWrite(values, origin: origin, connection)
    } catch let error as RefloatConfigDecodeException {
      failWrite(code: .CONFIG_VERIFY_FAILED, message: error.message, phase: .verifying, rawConfig: original, connection: connection)
    } catch {
      failWrite(code: .CONFIG_VERIFY_FAILED, message: error.localizedDescription, phase: .verifying, rawConfig: original, connection: connection)
    }
  }

  private func boardConfigValues(
    _ schema: RefloatConfigSchema,
    _ configBytes: RefloatConfigBytes,
    _ boardId: String?,
    _ connection: ConfigRWConnection,
    capturedAtMs: Int64? = nil,
    refloatBaseVersion: String? = nil,
    refloatVersion: String? = nil
  ) throws -> BoardConfigValues {
    try RefloatConfigDecoder.decodeBoardConfigValues(
      schema: schema,
      configBytes: configBytes,
      boardId: boardId,
      refloatBaseVersion: refloatBaseVersion ?? connection.refloatBaseVersion,
      capturedAt: capturedAtMs ?? nowMs(),
      refloatVersion: refloatVersion
    )
  }

  private func complete(_ values: BoardConfigValues, _ connection: ConfigRWConnection) {
    let pending = readCallbacks
    readCallbacks = []
    let resume = currentResumePolling
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    connection.onBoardConfigValues(values, .freshRead)
    let map = values.toBridgeMap()
    for callbacks in pending { callbacks.onSuccess(map) }
  }

  private func completeWrite(
    _ values: BoardConfigValues,
    origin: BoardConfigOperationOrigin = .vescapeWrite(),
    emitBoardConfigValues: Bool = true,
    resumePolling: Bool? = nil,
    _ connection: ConfigRWConnection
  ) {
    cancelQueuedSetFrames(connection)
    let pending = writeCallbacks
    writeCallbacks = nil
    let resume = resumePolling ?? currentResumePolling
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    if emitBoardConfigValues { connection.onBoardConfigValues(values, origin) }
    pending?.onSuccess(values.toBridgeMap())
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
    cancelQueuedSetFrames(connection)
    let pending = writeCallbacks
    writeCallbacks = nil
    let resume = resumePolling ?? currentResumePolling
    let opId = currentOpId
    let demoted = setConfigSent
    if demoted { connection.demoteWriteBase() }
    state = .idle
    cancelTimeout()
    if resume { connection.startPolling() }
    let baseProperties: [String: Any?] = [
      "operation_id": opId,
      "message": message,
      "error_code": code.rawValue,
      "phase": phase.rawValue,
      "firmware": connection.fwVersion,
    ]
    if demoted {
      connection.captureDiagnostic("board_config_write_base_demoted", baseProperties)
    }
    var failureProperties = baseProperties
    failureProperties["raw_config_length"] = rawConfig?.count
    connection.captureDiagnostic("profile_push_failed", failureProperties)
    pending?.onError(code.rawValue, message)
  }

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
    case .writeAwaitingIdle(_, _, let original, _, _, _):
      failWrite(code: code, message: message, phase: .sendingWrite, rawConfig: original, resumePolling: resumePolling, connection: connection)
    case .writeAwaitingSetAck(_, _, let original, _, _):
      failWrite(code: code, message: message, phase: .sendingWrite, rawConfig: original, resumePolling: resumePolling, connection: connection)
    case .writeVerifying(_, _, let original, _, _):
      failWrite(code: code, message: message, phase: .verifying, rawConfig: original, resumePolling: resumePolling, connection: connection)
    }
  }

  private func cancelQueuedSetFrames(_ connection: ConfigRWConnection) {
    guard let tag = activeSetFrameTag else { return }
    activeSetFrameTag = nil
    connection.cancelQueuedPayloads(tag)
  }

  private func setFrameTag(_ opId: String) -> String { "config-set:\(opId)" }

  private func idleBlockReason(
    _ connection: ConfigRWConnection,
    _ referenceMs: Int64,
    minRideStateAtMs: Int64? = nil
  ) -> String? {
    let freshSinceMs = max(minRideStateAtMs ?? Int64.min, BoardIdleGate.freshSinceMs(referenceMs))
    return BoardIdleGate.blockReason(connection.rideState(), freshSinceMs: freshSinceMs)
  }

  private var setConfigSent: Bool {
    switch state {
    case .writeAwaitingSetAck, .writeVerifying: return true
    default: return false
    }
  }

  private var currentResumePolling: Bool {
    switch state {
    case .readCollectingXml(let ctx, _, _), .readAwaitingConfig(let ctx, _):
      return ctx.wasPolling
    case .writeCollectingXml(let ctx, _, _), .writeAwaitingConfig(let ctx, _):
      return ctx.wasPolling
    case .writeAwaitingIdle(let ctx, _, _, _, _, _),
      .writeAwaitingSetAck(let ctx, _, _, _, _),
      .writeVerifying(let ctx, _, _, _, _):
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
    case .writeAwaitingIdle(let ctx, _, _, _, _, _),
      .writeAwaitingSetAck(let ctx, _, _, _, _),
      .writeVerifying(let ctx, _, _, _, _):
      return ctx.opId
    case .idle:
      return nil
    }
  }

  private var currentTransport: BoardTransport? {
    switch state {
    case .readCollectingXml(let ctx, _, _), .readAwaitingConfig(let ctx, _):
      return ctx.transport
    case .writeCollectingXml(let ctx, _, _), .writeAwaitingConfig(let ctx, _):
      return ctx.transport
    case .writeAwaitingIdle(let ctx, _, _, _, _, _),
      .writeAwaitingSetAck(let ctx, _, _, _, _),
      .writeVerifying(let ctx, _, _, _, _):
      return ctx.transport
    case .idle:
      return nil
    }
  }

  private func send(_ connection: ConfigRWConnection, _ payload: [UInt8], tag: String? = nil) -> Bool {
    let ok = connection.sendTaggedPayload?(payload, tag) ?? connection.sendPayload(payload)
    if !ok {
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
    scheduler.postDelayed(timeoutMs) { [weak self] in
      guard let self, self.timeoutGeneration == generation, self.isInFlight else { return }
      if case .readCollectingXml(var ctx, let bytes, let expected) = self.state {
        if !ctx.xmlRetried {
          ctx.xmlRetried = true
          self.state = .readCollectingXml(ctx, bytes, expected)
          self.scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
          _ = self.send(connection, self.buildXmlRequest(ctx.transport, expected: expected, nextOffset: bytes.count))
          return
        }
        self.abort(
          code: code,
          message: "Timed out reading Refloat config at XML offset \(bytes.count)",
          resumePolling: nil,
          connection: connection
        )
        return
      }
      if case .writeCollectingXml(var ctx, let bytes, let expected) = self.state {
        if !ctx.xmlRetried {
          ctx.xmlRetried = true
          self.state = .writeCollectingXml(ctx, bytes, expected)
          self.scheduleTimeout(.CONFIG_SCHEMA_TIMEOUT, CONFIG_SCHEMA_TIMEOUT_MS, connection)
          _ = self.send(connection, self.buildXmlRequest(ctx.transport, expected: expected, nextOffset: bytes.count))
          return
        }
        self.abort(
          code: code,
          message: "Timed out reading Refloat config at XML offset \(bytes.count)",
          resumePolling: nil,
          connection: connection
        )
        return
      }
      if case .writeAwaitingIdle = self.state {
        self.abort(
          code: .BOARD_NOT_IDLE,
          message: "No fresh telemetry shows the board idle",
          resumePolling: nil,
          connection: connection
        )
        return
      }
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

private func wallNowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

internal struct ConfigRWConnection {
  let phase: BoardPhase
  let appBoardId: String?
  let transport: BoardTransport
  let fwVersion: String?
  let refloatVersion: String?
  let refloatBaseVersion: String?
  let linkIntegrity: LinkIntegrity
  let boardConfigValues: BoardConfigValues?
  let isPollingActive: () -> Bool
  let stopPolling: () -> Void
  let startPolling: () -> Void
  let sendPayload: ([UInt8]) -> Bool
  let captureDiagnostic: (String, [String: Any?]) -> Void
  let loadProfile: (String) throws -> [String: Any?]?
  let onBoardConfigValues: (BoardConfigValues, BoardConfigOperationOrigin) -> Void
  let demoteWriteBase: () -> Void
  let rideState: () -> BoardRideState?
  let isSessionActive: (() -> Bool)?
  let liveLinkIntegrity: (() -> LinkIntegrity)?
  let liveBoardConfigValues: (() -> BoardConfigValues?)?
  let sendTaggedPayload: (([UInt8], String?) -> Bool)?
  let cancelQueuedPayloads: (String) -> Void

  init(
    phase: BoardPhase,
    appBoardId: String?,
    transport: BoardTransport,
    fwVersion: String?,
    refloatVersion: String?,
    refloatBaseVersion: String?,
    linkIntegrity: LinkIntegrity,
    boardConfigValues: BoardConfigValues?,
    isPollingActive: @escaping () -> Bool,
    stopPolling: @escaping () -> Void,
    startPolling: @escaping () -> Void,
    sendPayload: @escaping ([UInt8]) -> Bool,
    captureDiagnostic: @escaping (String, [String: Any?]) -> Void,
    loadProfile: @escaping (String) throws -> [String: Any?]?,
    onBoardConfigValues: @escaping (BoardConfigValues, BoardConfigOperationOrigin) -> Void,
    demoteWriteBase: @escaping () -> Void,
    rideState: @escaping () -> BoardRideState?,
    isSessionActive: (() -> Bool)? = nil,
    liveLinkIntegrity: (() -> LinkIntegrity)? = nil,
    liveBoardConfigValues: (() -> BoardConfigValues?)? = nil,
    sendTaggedPayload: (([UInt8], String?) -> Bool)? = nil,
    cancelQueuedPayloads: @escaping (String) -> Void = { _ in }
  ) {
    self.phase = phase
    self.appBoardId = appBoardId
    self.transport = transport
    self.fwVersion = fwVersion
    self.refloatVersion = refloatVersion
    self.refloatBaseVersion = refloatBaseVersion
    self.linkIntegrity = linkIntegrity
    self.boardConfigValues = boardConfigValues
    self.isPollingActive = isPollingActive
    self.stopPolling = stopPolling
    self.startPolling = startPolling
    self.sendPayload = sendPayload
    self.captureDiagnostic = captureDiagnostic
    self.loadProfile = loadProfile
    self.onBoardConfigValues = onBoardConfigValues
    self.demoteWriteBase = demoteWriteBase
    self.rideState = rideState
    self.isSessionActive = isSessionActive
    self.liveLinkIntegrity = liveLinkIntegrity
    self.liveBoardConfigValues = liveBoardConfigValues
    self.sendTaggedPayload = sendTaggedPayload
    self.cancelQueuedPayloads = cancelQueuedPayloads
  }

  var liveConnected: Bool {
    if let isSessionActive { return isSessionActive() }
    return phase == .connected && appBoardId != nil && !appBoardId!.isEmpty
  }

  var currentLinkIntegrity: LinkIntegrity {
    liveLinkIntegrity?() ?? linkIntegrity
  }

  var currentBoardConfigValues: BoardConfigValues? {
    liveBoardConfigValues?() ?? boardConfigValues
  }
}

/// @parity /modules/vescape-core/android/src/main/java/expo/modules/vescapecore/config/ConfigRWController.kt `BoardConfigOperationOrigin`
internal enum BoardConfigOperationOrigin: Equatable {
  case freshRead
  case vescapeWrite(source: BoardConfigRevisionSource = .app, tuneProfileId: String? = nil)
}

private extension BoardTransport {
  var canId: Int? {
    switch self {
    case .direct: return nil
    case .can(let canId): return canId
    }
  }
}
