package expo.modules.vescapecore.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GpsCourseDeriverTest {
  @Test
  fun `trusts the reported bearing while moving`() {
    val deriver = GpsCourseDeriver()

    val course = deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = 91.0, timestamp = 1_000)

    assertEquals(GpsCourse(91.0, 1_000), course)
  }

  @Test
  fun `normalizes the reported bearing into 0-360`() {
    val deriver = GpsCourseDeriver()

    val course = deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = -90.0, timestamp = 1_000)

    assertEquals(270.0, course?.bearingDeg)
  }

  @Test
  fun `ignores the reported bearing while stopped`() {
    val deriver = GpsCourseDeriver()

    val course = deriver.derive(52.0, 21.0, speedMps = 0.2, bearingDeg = 91.0, timestamp = 1_000)

    assertNull(course)
  }

  @Test
  fun `derives the course from two fixes when the receiver reports no bearing`() {
    val deriver = GpsCourseDeriver()
    deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = null, timestamp = 1_000)

    // ~11 m due north.
    val course =
      checkNotNull(deriver.derive(52.0001, 21.0, speedMps = 5.0, bearingDeg = null, timestamp = 2_000))

    assertEquals(0.0, course.bearingDeg, 0.5)
    assertEquals(2_000L, course.sourceTimestamp)
  }

  @Test
  fun `does not derive a course from two fixes closer than the jitter floor`() {
    val deriver = GpsCourseDeriver()
    deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = null, timestamp = 1_000)

    // ~1 m apart.
    val course = deriver.derive(
      52.00001,
      21.0,
      speedMps = 5.0,
      bearingDeg = null,
      timestamp = 2_000,
    )

    assertNull(course)
  }

  @Test
  fun `retains the last course through a stop inside the retention window`() {
    val deriver = GpsCourseDeriver()
    deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = 91.0, timestamp = 1_000)

    val course = deriver.derive(52.0, 21.0, speedMps = 0.0, bearingDeg = 12.0, timestamp = 10_000)

    assertEquals(GpsCourse(91.0, 1_000), course)
  }

  @Test
  fun `drops the retained course once the retention window passes`() {
    val deriver = GpsCourseDeriver()
    deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = 91.0, timestamp = 1_000)
    deriver.derive(52.0, 21.0, speedMps = 0.0, bearingDeg = 12.0, timestamp = 10_000)

    val course = deriver.derive(52.0, 21.0, speedMps = 0.0, bearingDeg = 12.0, timestamp = 11_001)

    assertNull(course)
  }

  @Test
  fun `retention is measured from the source fix, not the last reported one`() {
    val deriver = GpsCourseDeriver()
    deriver.derive(52.0, 21.0, speedMps = 5.0, bearingDeg = 91.0, timestamp = 1_000)
    // Held at 8 s: still inside the window, and must not refresh the source timestamp.
    deriver.derive(52.0, 21.0, speedMps = 0.0, bearingDeg = null, timestamp = 9_000)

    val course = deriver.derive(52.0, 21.0, speedMps = 0.0, bearingDeg = null, timestamp = 15_000)

    assertNull(course)
  }
}
