package expo.modules.vescapecore.warnings

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeBoardWarningStore : BoardWarningStore {
  private val rows = LinkedHashMap<String, BoardWarning>()
  private fun key(boardId: String, kind: String) = "$boardId $kind"

  override suspend fun get(boardId: String, kind: String): BoardWarning? = rows[key(boardId, kind)]
  override suspend fun getForBoard(boardId: String): List<BoardWarning> =
    rows.values.filter { it.boardId == boardId }.sortedBy { it.firstDetectedAtMs }

  override suspend fun getAll(): List<BoardWarning> = rows.values.toList()

  override suspend fun upsert(warning: BoardWarning) {
    rows[key(warning.boardId, warning.kind)] = warning
  }

  override suspend fun delete(boardId: String, kind: String): Boolean =
    rows.remove(key(boardId, kind)) != null

  override suspend fun deleteForBoard(boardId: String): Boolean {
    val toRemove = rows.keys.filter { rows[it]?.boardId == boardId }
    toRemove.forEach { rows.remove(it) }
    return toRemove.isNotEmpty()
  }
}

class BoardWarningRegistryTest {
  private val breadcrumbs = mutableListOf<Pair<String, Map<String, Any?>>>()
  private var clock = 1_000L
  private val emits = mutableListOf<Pair<String, List<BoardWarning>>>()

  private fun registry(store: BoardWarningStore = FakeBoardWarningStore()): BoardWarningRegistry =
    BoardWarningRegistry(
      store = store,
      recordDiagnostic = { name, props -> breadcrumbs.add(name to props) },
      now = { clock },
    ).also { it.onChange = { boardId, warnings -> emits.add(boardId to warnings) } }

  @Test
  fun upsertPreservesFirstDetectedAtAndUpdatesRest() = runBlocking {
    val registry = registry()
    clock = 1_000L
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{\"peak\":0.1}")
    clock = 5_000L
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.CRITICAL, "{\"peak\":0.3}")

    val warnings = registry.warningsForBoard("board-a")
    assertEquals(1, warnings.size)
    val warning = warnings.single()
    assertEquals(1_000L, warning.firstDetectedAtMs)
    assertEquals(5_000L, warning.lastDetectedAtMs)
    assertEquals(BoardWarningSeverity.CRITICAL, warning.severity)
    assertEquals("{\"peak\":0.3}", warning.payloadJson)
  }

  @Test
  fun cleanEvaluationWithDataClearsWarning() = runBlocking {
    val registry = registry()
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")
    registry.reportCleanEvaluation("board-a", "cell-spread")

    assertTrue(registry.warningsForBoard("board-a").isEmpty())
  }

  @Test
  fun cleanEvaluationWithoutRowLeavesStoreUntouchedAndDoesNotEmit() = runBlocking {
    val registry = registry()
    emits.clear()
    registry.reportCleanEvaluation("board-a", "cell-spread")

    assertTrue(registry.warningsForBoard("board-a").isEmpty())
    assertTrue(emits.isEmpty())
  }

  @Test
  fun manualClearDeletesAndReDetectionReFires() = runBlocking {
    val registry = registry()
    registry.reportFinding("board-a", "footpad-disabled", BoardWarningSeverity.CRITICAL, "{}")
    registry.clearWarning("board-a", "footpad-disabled")
    assertTrue(registry.warningsForBoard("board-a").isEmpty())

    registry.reportFinding("board-a", "footpad-disabled", BoardWarningSeverity.CRITICAL, "{}")
    assertEquals(1, registry.warningsForBoard("board-a").size)
  }

  @Test
  fun manualClearInvokesOnManualClearEvenWithoutRow() = runBlocking {
    val registry = registry()
    val clears = mutableListOf<Pair<String, String?>>()
    registry.onManualClear = { boardId, kind -> clears.add(boardId to kind) }

    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")
    registry.clearWarning("board-a", "cell-spread")
    registry.clearWarning("board-a", "battery-config-mismatch")
    registry.clearAllWarnings("board-a")

    assertEquals(
      listOf<Pair<String, String?>>(
        "board-a" to "cell-spread",
        "board-a" to "battery-config-mismatch",
        "board-a" to null,
      ),
      clears,
    )
  }

  @Test
  fun clearAllRemovesEveryWarningForBoardOnly() = runBlocking {
    val registry = registry()
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")
    registry.reportFinding("board-a", "footpad-disabled", BoardWarningSeverity.CRITICAL, "{}")
    registry.reportFinding("board-b", "cell-spread", BoardWarningSeverity.WARN, "{}")

    registry.clearAllWarnings("board-a")

    assertTrue(registry.warningsForBoard("board-a").isEmpty())
    assertEquals(1, registry.warningsForBoard("board-b").size)
  }

  @Test
  fun oneBreadcrumbPerKindPerSession() = runBlocking {
    val registry = registry()
    registry.beginSession("board-a")
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.CRITICAL, "{}")

    assertEquals(1, breadcrumbs.size)
    assertEquals("board_warning_detected", breadcrumbs.single().first)
    assertEquals("cell-spread", breadcrumbs.single().second["kind"])

    registry.beginSession("board-a")
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.CRITICAL, "{}")
    assertEquals(2, breadcrumbs.size)
  }

  @Test
  fun sessionIsScopedToExactBoardIdWhenOneIdPrefixesAnother() = runBlocking {
    val registry = registry()
    registry.reportFinding("board-ab", "x", BoardWarningSeverity.WARN, "{}")
    registry.reportFinding("board-a", "bx", BoardWarningSeverity.WARN, "{}")
    assertEquals(2, breadcrumbs.size)

    registry.beginSession("board-a")
    registry.reportFinding("board-ab", "x", BoardWarningSeverity.WARN, "{}")
    assertEquals(2, breadcrumbs.size)
  }

  @Test
  fun emitSnapshotEmitsEveryBoardWithWarnings() = runBlocking {
    val registry = registry()
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")
    registry.reportFinding("board-b", "footpad-disabled", BoardWarningSeverity.CRITICAL, "{}")
    emits.clear()

    registry.emitSnapshot()

    assertEquals(setOf("board-a", "board-b"), emits.map { it.first }.toSet())
  }

  @Test
  fun findingEmitsFullBoardList() = runBlocking {
    val registry = registry()
    emits.clear()
    registry.reportFinding("board-a", "cell-spread", BoardWarningSeverity.WARN, "{}")

    assertEquals("board-a", emits.last().first)
    assertEquals(1, emits.last().second.size)
  }
}
