package expo.modules.vescapecore.sync

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The invariant the whole uploader exists to hold: **a row the Rider owns is never left behind.**
 *
 * Every other sync test checks one decision in isolation. These run a backlog all the way to zero
 * against a server that stores what it is sent and a source that scans forward from what was
 * committed, then compare the two sets. That closes the loop the unit tests leave open — a cursor
 * advanced past a row that never went in a batch is indistinguishable from a correct pass when you
 * only look at the engine's return value.
 *
 * The direction of failure is asserted too: after a lost response or a lost checkpoint, rows may be
 * re-sent (the server upserts them) but must never be skipped.
 *
 * @parity /modules/vescape-core/ios/sync/SyncDrainTests.swift
 */
class SyncDrainTest {

  private var now = 1_000L

  private fun engine(source: SyncSource, server: SyncTransport) = SyncEngine(
    source = source,
    transport = server,
    environment = {
      SyncEnvironment(
        ridingSamples = false,
        enabled = true,
        online = true,
        wifiOnly = false,
        onWifi = false,
        credentialReady = true,
        onlineBlocked = false,
      )
    },
    clock = { now },
  )

  /**
   * Runs passes until the backlog is drained, stepping the clock over any backoff so a transient
   * failure costs a wait rather than ending the test. Bounded: a loop that stops making progress
   * fails here rather than hanging.
   */
  private suspend fun drain(engine: SyncEngine, source: FakeSyncSource, maxPasses: Int = 200): Int {
    var passes = 0
    while (source.remaining > 0 && passes < maxPasses) {
      when (val pass = engine.runOnce()) {
        is SyncPass.Waiting -> now = maxOf(now, pass.untilMs) + 1
        is SyncPass.Paused -> return passes
        else -> Unit
      }
      passes += 1
    }
    return passes
  }

  private fun backlog(vararg tables: Pair<SyncTable, Int>): FakeSyncSource =
    FakeSyncSource(tables.associate { (table, count) -> table to (1L..count.toLong()).toList() })

  @Test
  fun `a full drain delivers every row exactly once`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 5, SyncTable.FAVORITES to 3)
    val server = FakeSyncServer()

    drain(engine(source, server), source)

    assertEquals(source.allRows(), server.stored)
    assertEquals(0, source.remaining)
    // Nothing failed, so nothing had to be re-sent.
    assertEquals(source.allRows().size, server.writes)
  }

  /** The scan is the only thing that decides what goes next, so a small budget must not open a gap. */
  @Test
  fun `a backlog larger than one scan still loses nothing`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 17, SyncTable.ALERTS to 11, SyncTable.FAVORITES to 4)
    source.scanLimit = 3
    val server = FakeSyncServer()

    drain(engine(source, server), source)

    assertEquals(source.allRows(), server.stored)
    assertEquals(source.allRows().size, server.writes)
  }

  /**
   * The response was lost, not the write. The engine cannot tell those apart, so it re-sends — and
   * the rows must arrive, once, because the server upserts on identity.
   */
  @Test
  fun `a batch the server stored but never acknowledged is re-sent, not skipped`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 6)
    source.scanLimit = 2
    val server = FakeSyncServer()
    server.loseNextResponse = true
    val engine = engine(source, server)

    engine.runOnce()
    assertTrue("the rows are on the server", (SyncTable.BOARDS to 1L) in server.stored)
    assertTrue("but nothing may be checkpointed", source.committed.isEmpty())

    drain(engine, source)

    assertEquals(source.allRows(), server.stored)
    assertEquals(0, source.remaining)
  }

  /** The server took the rows; the checkpoint did not land. Re-sending is the only safe direction. */
  @Test
  fun `a lost cursor commit re-sends the same rows and still drains`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 6)
    source.scanLimit = 2
    val server = FakeSyncServer()
    source.commitFailure = IllegalStateException("disk full")

    val engine = engine(source, server)
    engine.runOnce()
    assertTrue("nothing may be checkpointed", source.committed.isEmpty())
    assertEquals(6, source.remaining)

    source.commitFailure = null
    drain(engine, source)

    assertEquals(source.allRows(), server.stored)
    // The first batch went twice: failing toward a re-send is the whole design.
    assertTrue("the lost batch must have been re-sent", server.writes > source.allRows().size)
  }

  @Test
  fun `a transient failure part-way through a drain loses nothing`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 9, SyncTable.PRIVACY_ZONES to 5)
    source.scanLimit = 2
    val server = FakeSyncServer()
    val engine = engine(source, server)

    engine.runOnce()
    server.failures += SyncResponse.Transient("5xx")
    server.failures += SyncResponse.Transient("5xx")
    server.failures += SyncResponse.RateLimited(30_000)

    drain(engine, source)

    assertEquals(source.allRows(), server.stored)
    assertEquals(0, source.remaining)
  }

  /**
   * A committed cursor is a promise that everything below it reached the server. Checked after every
   * pass rather than at the end, because a mid-drain violation self-heals by the time the backlog is
   * empty and would otherwise go unseen.
   */
  @Test
  fun `no cursor ever moves past a row the server does not hold`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 8, SyncTable.ALERTS to 6, SyncTable.FAVORITES to 5)
    source.scanLimit = 3
    val server = FakeSyncServer()
    server.failures += SyncResponse.Transient("5xx")
    val engine = engine(source, server)

    var passes = 0
    while (source.remaining > 0 && passes < 100) {
      when (val pass = engine.runOnce()) {
        is SyncPass.Waiting -> now = maxOf(now, pass.untilMs) + 1
        is SyncPass.Paused -> break
        else -> Unit
      }
      for ((table, cursor) in source.cursors) {
        for (position in 1..cursor) {
          assertTrue(
            "$table cursor reached $cursor but the server never received $position",
            (table to position) in server.stored,
          )
        }
      }
      passes += 1
    }

    assertEquals(source.allRows(), server.stored)
  }

  /**
   * The Account changed while the request was in flight. The response belongs to the previous
   * database, so nothing may be checkpointed — and every row stays pending for whoever owns it now.
   */
  @Test
  fun `a response that outlived its Account checkpoints nothing and strands no row`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 4)
    val server = FakeSyncServer()
    server.afterStore = { source.generation += 1 }

    assertEquals(SyncPass.Idle, engine(source, server).runOnce())

    assertTrue(source.committed.isEmpty())
    assertTrue(source.cursors.isEmpty())
    assertEquals(4, source.remaining)
  }

  /** A permanent pause must strand the batch in place: retained, not consumed. */
  @Test
  fun `a refused batch leaves the whole backlog pending`() = runBlocking {
    val source = backlog(SyncTable.BOARDS to 4, SyncTable.FAVORITES to 2)
    val server = FakeSyncServer()
    server.failures += SyncResponse.Invalid(409, "dependency-conflict")

    assertEquals(SyncPass.Paused(SyncPauseReason.PROTOCOL), engine(source, server).runOnce())

    assertTrue(source.committed.isEmpty())
    assertEquals(6, source.remaining)
    assertTrue(server.stored.isEmpty())
  }
}
