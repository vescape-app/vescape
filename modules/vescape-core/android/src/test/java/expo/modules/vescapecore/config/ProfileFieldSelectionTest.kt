package expo.modules.vescapecore.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProfileFieldSelectionTest {
    private val stored = mapOf<String, Any>("kp" to 20.0, "ki" to 0.01, "kp2" to 1.2)

    @Test
    fun selectsOnlyNamedFields() {
        assertEquals(mapOf("kp" to 20.0), selectProfileFields(stored, listOf("kp")))
    }

    @Test
    fun rejectsEmptyOrUnstoredFieldIds() {
        assertNull(selectProfileFields(stored, emptyList()))
        assertNull(selectProfileFields(stored, listOf("kp", "missing")))
    }
}
