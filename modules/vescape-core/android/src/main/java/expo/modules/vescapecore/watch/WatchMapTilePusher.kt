package expo.modules.vescapecore.watch

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.vescapecore.maptiles.MapTiles
import expo.modules.vescapecore.service.VESC_SESSION_TAG
import java.io.File

/**
 * Street-map tiles on the Wear Data Layer: one item per tile at `/map-tile/<style>/<z>/<x>/<y>`,
 * the JPEG as an Asset (item payloads are small; assets are not). The set of those items *is* what
 * the wrist holds: the phone reads it back with `getDataItems` and drops a tile by deleting its item.
 *
 * @parity /modules/vescape-core/ios/watch/WatchMapTilePusher.swift `WatchMapTilePusher`
 * @platform-diff watchOS has no per-tile item. It sends files with `transferFile`, lists the held
 *   tiles in the Application Context and records finished transfers in its watch directory.
 */
internal class WatchMapTilePusher(context: Context) : WatchMapTileTransport {
    private val dataClient by lazy { Wearable.getDataClient(context) }

    override suspend fun delivered(): Set<WatchMapTile> {
        val prefix = Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(WATCH_MAP_TILE_PATH).build()
        val items = Tasks.await(dataClient.getDataItems(prefix, DataClient.FILTER_PREFIX))
        val tiles = HashSet<WatchMapTile>()
        val foreign = mutableListOf<Uri>()
        try {
            for (item in items) {
                val parsed = item.uri.path?.let(WatchMapTile::fromPath)
                if (parsed?.first == MapTiles.STYLE) tiles += parsed.second else foreign += item.uri
            }
        } finally {
            items.release()
        }
        // Another style's tiles would never be planned again; they only cost the wrist storage. A
        // failed cleanup is retried with the next lookup and never holds up sending.
        foreign.forEach(::delete)
        return tiles
    }

    override suspend fun hold(wanted: List<WatchMapTile>, dropped: Set<WatchMapTile>) {
        for (tile in dropped) {
            delete(Uri.Builder().scheme(PutDataRequest.WEAR_URI_SCHEME).path(tile.path(MapTiles.STYLE)).build())
        }
    }

    private fun delete(uri: Uri) {
        try {
            Tasks.await(dataClient.deleteDataItems(uri, DataClient.FILTER_LITERAL))
        } catch (e: Exception) {
            Log.w(VESC_SESSION_TAG, "Watch map tile drop failed", e)
        }
    }

    override suspend fun send(tile: WatchMapTile, jpeg: File): Boolean = try {
        val request = PutDataRequest.create(tile.path(MapTiles.STYLE)).apply {
            putAsset(WATCH_MAP_TILE_ASSET, Asset.createFromBytes(jpeg.readBytes()))
            // Non-urgent items may wait half an hour to sync; the rider is already on this tile.
            setUrgent()
        }
        Tasks.await(dataClient.putDataItem(request))
        true
    } catch (e: Exception) {
        Log.w(VESC_SESSION_TAG, "Watch map tile send failed", e)
        false
    }
}
