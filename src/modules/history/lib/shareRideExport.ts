import * as Sharing from 'expo-sharing'
import { exportRideGpx, type RideExportOptions } from 'vescape-core'

/** Native closes the writer before returning. Keep its cache file alive for share consumers. */
export async function shareRideGpx(options: RideExportOptions): Promise<void> {
  const file = await exportRideGpx(options)
  await Sharing.shareAsync(file.uri, {
    mimeType: file.mimeType,
    UTI: file.uti,
    dialogTitle: 'Export GPX',
  })
}
