package expo.modules.vescapecore.faults

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * VESC Fault Occurrence transition rules: one activation is one occurrence, repetition never
 * duplicates, a clear closes, a direct code change closes and opens, session loss decides nothing,
 * a restart mid-fault rehydrates instead of duplicating, and the collection switch stops writes
 * without touching stored evidence.
 * @parity /modules/vescape-core/ios/faults/VescFaultCoordinatorTests.swift
 */
class VescFaultCoordinatorTest {
  private class FakeStore : VescFaultStore {
    val rows = LinkedHashMap<String, VescFaultOccurrence>()

    override suspend fun getForBoard(boardId: String) =
      rows.values.filter { it.boardId == boardId }.sortedByDescending { it.occurredAtMs }

    override suspend fun getAll() = rows.values.toList()

    /** Set to fail the next hydration read, mirroring a transient Room read error. */
    var openLiveFailsOnce = false

    override suspend fun openLive(boardId: String): VescFaultOccurrence? {
      if (openLiveFailsOnce) {
        openLiveFailsOnce = false
        error("store read failed")
      }
      return rows.values
        .filter { it.boardId == boardId && it.clearedAtMs == null }
        .maxByOrNull { it.occurredAtMs }
    }

    /** Set to fail every write, mirroring a dead Room database. */
    var writesFail = false
    /** Set to fail only the next write, so one step of a two-write transition can fail alone. */
    var failNextWriteOnly = false
    var writes = 0

    override suspend fun upsert(occurrence: VescFaultOccurrence) {
      if (failNextWriteOnly) {
        failNextWriteOnly = false
        error("store write failed")
      }
      if (writesFail) error("store write failed")
      writes += 1
      val existing = rows[occurrence.id]
      // Lifecycle writes never rewrite `dismissed`, matching the DAO's insert-or-advance.
      rows[occurrence.id] = existing?.copy(
        lastObservedAtMs = occurrence.lastObservedAtMs,
        clearedAtMs = occurrence.clearedAtMs,
      ) ?: occurrence
    }

    override suspend fun setDismissed(id: String, dismissed: Boolean): Boolean {
      val row = rows[id] ?: return false
      rows[id] = row.copy(dismissed = dismissed)
      return true
    }
  }

  private val store = FakeStore()
  private var clock = 1_000L
  private var ids = 0
  private val coordinator = VescFaultCoordinator(
    store = store,
    now = { clock },
    newId = { "id-${++ids}" },
  )

  private fun faults() = store.rows.values.toList()

  @Test
  fun `one activation creates one occurrence with an observed time`() = runBlocking {
    coordinator.onActiveFault("board", 9)

    val fault = faults().single()
    assertEquals(9, fault.code)
    assertEquals(1_000L, fault.occurredAtMs)
    assertNull(fault.clearedAtMs)
    assertTrue(!fault.dismissed)
  }

  @Test
  fun `repeated frames for the same code stay one occurrence`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    repeat(50) {
      clock += 30
      coordinator.onActiveFault("board", 9)
    }

    val fault = faults().single()
    // Throttled writes still track the fault: last-observed advanced past the opening time.
    assertTrue(fault.lastObservedAtMs > fault.occurredAtMs)
    assertNull(fault.clearedAtMs)
  }

  @Test
  fun `a normal frame closes the open occurrence`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    clock = 5_000
    coordinator.onFaultCleared("board")

    assertEquals(5_000L, faults().single().clearedAtMs)
  }

  @Test
  fun `a direct code change closes the old occurrence and opens a new one`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    clock = 4_000
    coordinator.onActiveFault("board", 6)

    val all = faults()
    assertEquals(2, all.size)
    assertNotEquals(all[0].id, all[1].id)
    assertEquals(4_000L, all[0].clearedAtMs)
    assertEquals(6, all[1].code)
    assertNull(all[1].clearedAtMs)
  }

  @Test
  fun `a gap in observations neither clears nor reactivates`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    clock = 9_000
    // Same code observed again after the session came back: still one unresolved activation.
    coordinator.onActiveFault("board", 9)

    val fault = faults().single()
    assertNull(fault.clearedAtMs)
    assertEquals(1_000L, fault.occurredAtMs)
  }

  @Test
  fun `a restart mid-fault adopts the open occurrence instead of duplicating it`() = runBlocking {
    coordinator.onActiveFault("board", 9)

    val restarted = VescFaultCoordinator(store = store, now = { clock }, newId = { "id-${++ids}" })
    clock = 8_000
    restarted.onActiveFault("board", 9)

    assertEquals(1, faults().size)
  }

  @Test
  fun `collection off stops new occurrences but keeps existing evidence dismissible`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    val existing = faults().single().id

    coordinator.collectionEnabled = false
    clock = 6_000
    coordinator.onActiveFault("board", 6)
    coordinator.onFaultCleared("board")

    assertEquals(1, faults().size)
    assertNull(faults().single().clearedAtMs)

    coordinator.setDismissed(existing, true)
    assertTrue(faults().single().dismissed)
  }

  @Test
  fun `a failed clear write leaves the occurrence open so it can retry`() = runBlocking {
    coordinator.onActiveFault("board", 9)

    store.writesFail = true
    clock = 5_000
    runCatching { coordinator.onFaultCleared("board") }
    assertNull(faults().single().clearedAtMs)

    store.writesFail = false
    clock = 6_000
    coordinator.onFaultCleared("board")
    assertEquals(6_000L, faults().single().clearedAtMs)

    // Normal-frame heartbeats keep retrying failed clears, but never rewrite a successful clear.
    val writesAfterClear = store.writes
    repeat(5) {
      clock += 1_000
      coordinator.onFaultCleared("board")
    }
    assertEquals(writesAfterClear, store.writes)
    assertEquals(6_000L, faults().single().clearedAtMs)
  }

  @Test
  fun `a failed close on a code change does not open the replacement`() = runBlocking {
    coordinator.onActiveFault("board", 9)

    // Only the close of the old occurrence fails; the replacement must not be inserted while the
    // old row stays open, because later heartbeats only know the replacement.
    store.failNextWriteOnly = true
    clock = 5_000
    runCatching { coordinator.onActiveFault("board", 6) }

    assertEquals(1, faults().size)
    assertEquals(9, faults().single().code)
    assertNull(faults().single().clearedAtMs)

    // The retry closes the old occurrence and opens the new one.
    clock = 6_000
    coordinator.onActiveFault("board", 6)
    val all = faults()
    assertEquals(2, all.size)
    assertEquals(6_000L, all.first { it.code == 9 }.clearedAtMs)
    assertNull(all.first { it.code == 6 }.clearedAtMs)
  }

  @Test
  fun `a failed hydration read retries instead of duplicating the open occurrence`() = runBlocking {
    coordinator.onActiveFault("board", 9)

    // Restart with an existing durable open fault, but the first hydration read fails.
    val restarted = VescFaultCoordinator(store = store, now = { clock }, newId = { "id-${++ids}" })
    store.openLiveFailsOnce = true
    clock = 8_000
    restarted.onActiveFault("board", 9)
    assertEquals(1, faults().size)

    // The next observation retries hydration and adopts the open occurrence instead of duplicating.
    clock = 9_000
    restarted.onActiveFault("board", 9)
    assertEquals(1, faults().size)
    assertEquals("id-1", faults().single().id)
    assertEquals(9_000L, faults().single().lastObservedAtMs)
  }

  @Test
  fun `dismissal survives a later activation of the same code as a new undismissed occurrence`() = runBlocking {
    coordinator.onActiveFault("board", 9)
    val first = faults().single().id
    coordinator.setDismissed(first, true)
    clock = 3_000
    coordinator.onFaultCleared("board")
    clock = 7_000
    coordinator.onActiveFault("board", 9)

    val all = faults()
    assertEquals(2, all.size)
    assertTrue(all.first { it.id == first }.dismissed)
    assertTrue(!all.first { it.id != first }.dismissed)
  }
}
