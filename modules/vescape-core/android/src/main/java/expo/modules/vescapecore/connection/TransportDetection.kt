package expo.modules.vescapecore.connection

internal object TransportDetection {
  data class Probe(
    val transport: BoardTransport,
    val confirmed: Boolean,
    val hasBms: Boolean = false,
    val vescFirmwareVersion: String? = null,
    val refloatVersion: String? = null,
    val refloatBaseVersion: String? = null,
  )

  data class Candidate(
    val transport: BoardTransport,
    val hasBms: Boolean,
    val vescFirmwareVersion: String? = null,
    val refloatVersion: String? = null,
    val refloatBaseVersion: String? = null,
  )

  sealed interface Outcome {
    data class Resolved(val transport: BoardTransport) : Outcome

    data class NeedsPick(val candidates: List<BoardTransport>) : Outcome

    object None : Outcome
  }

  data class Result(val candidates: List<Candidate>, val outcome: Outcome) {
    val resolvedTransport: BoardTransport?
      get() = when (outcome) {
        is Outcome.Resolved -> outcome.transport
        is Outcome.NeedsPick,
        Outcome.None -> null
      }
  }

  fun candidatesToProbe(canPingResponders: List<Int>): List<BoardTransport> =
    buildList {
      add(BoardTransport.Direct)
      canPingResponders.distinct().sorted().forEach { add(BoardTransport.Can(it)) }
    }

  fun resolve(probes: List<Probe>): Result {
    val candidates = probes.filter { it.confirmed }.map {
      Candidate(
        transport = it.transport,
        hasBms = it.hasBms,
        vescFirmwareVersion = it.vescFirmwareVersion,
        refloatVersion = it.refloatVersion,
        refloatBaseVersion = it.refloatBaseVersion,
      )
    }
    val transports = candidates.map { it.transport }
    val outcome = when (transports.size) {
      0 -> Outcome.None
      1 -> Outcome.Resolved(transports.single())
      else -> Outcome.NeedsPick(transports)
    }
    return Result(candidates, outcome)
  }
}
