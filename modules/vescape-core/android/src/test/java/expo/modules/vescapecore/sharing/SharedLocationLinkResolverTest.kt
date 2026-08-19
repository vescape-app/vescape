package expo.modules.vescapecore.sharing

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SharedLocationLinkResolverTest {
  @Test
  fun `follows platform redirect chain then extracts google initialization state`() = runBlocking {
    val requests = mutableListOf<Pair<String, Boolean>>()
    val resolver = SharedLocationLinkResolver { url, follows, _, _ ->
      requests += url to follows
      when (requests.size) {
        1 -> SharedLocationHttpResponse(url, "https://maps.google.com/first", "")
        2 -> SharedLocationHttpResponse(url, "/maps/place/G%C3%B3rka+Szczepi%C5%84ska/data=id", "")
        else -> SharedLocationHttpResponse(
          url,
          null,
          "window.APP_INITIALIZATION_STATE=[[[0,16.941056,51.1246336",
        )
      }
    }

    val result = resolver.resolve("https://maps.app.goo.gl/example")

    assertEquals(51.1246336, result?.latitude)
    assertEquals(16.941056, result?.longitude)
    assertEquals("Górka Szczepińska", result?.name)
    assertEquals(false, requests[0].second)
    assertEquals(false, requests[1].second)
    assertEquals(true, requests[2].second)
  }

  @Test
  fun `unwraps google consent redirect and sends consent cookie`() = runBlocking {
    val requests = mutableListOf<Pair<String, String?>>()
    val destination = "https://www.google.com/maps/place/Target"
    val resolver = SharedLocationLinkResolver { url, _, _, cookie ->
      requests += url to cookie
      when (requests.size) {
        1 -> SharedLocationHttpResponse(url, destination, "")
        2 -> SharedLocationHttpResponse(
          url,
          "https://consent.google.com/ml?continue=${java.net.URLEncoder.encode(destination, Charsets.UTF_8.name())}",
          "",
        )
        else -> SharedLocationHttpResponse(
          url,
          null,
          "window.APP_INITIALIZATION_STATE=[[[0,16.941056,51.1246336",
        )
      }
    }

    assertEquals(51.1246336, resolver.resolve("https://maps.app.goo.gl/example")?.latitude)
    assertEquals(destination, requests.last().first)
    assertEquals("SOCS=CAESHAgBEhIaAB; CONSENT=YES+", requests.last().second)
  }

  @Test
  fun `rejects invalid coordinates`() {
    assertNull(
      SharedLocationLinkResolver.extract(
        "https://google.com/maps/data=!3d95.0!4d201.0",
        "",
      ),
    )
  }
}
