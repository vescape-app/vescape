package expo.modules.vescapecore.config

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

/** Runs against Android's XML provider, which differs from the desktop JVM provider. */
@RunWith(AndroidJUnit4::class)
class RefloatConfigSchemaDeviceTest {
  @Test
  fun validBoardSchemaParsesOnAndroid() {
    val schema = RefloatConfigSchemaParser.parse(
      """<ConfigParams><Params><kp><type>1</type><vTx>8</vTx><vTxDoubleScale>1000</vTxDoubleScale></kp></Params><SerOrder><ser>kp</ser></SerOrder></ConfigParams>""".toByteArray(),
    )
    assertEquals("kp", schema.fields.single().id)
    assertEquals(RefloatConfigValueType.FLOAT32_SCALED, schema.fields.single().type)
  }

  @Test
  fun externalEntitiesRemainForbiddenOnAndroid() {
    assertThrows(RefloatConfigSchemaException::class.java) {
      RefloatConfigSchemaParser.parse(
        """<!DOCTYPE root [<!ENTITY external SYSTEM "file:///nonexistent-refloat-entity">]><root><param name="kp" type="float" label="&external;"/></root>""".toByteArray(),
      )
    }
  }
}
