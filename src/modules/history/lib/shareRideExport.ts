import * as Sharing from 'expo-sharing'
import { exportRideGpx, exportRideCsv, type RideExportOptions } from 'vescape-core'

/** Native closes the writer before returning. Keep its cache file alive for share consumers. */
export async function shareRideExport(
  options: RideExportOptions,
  format: 'gpx' | 'csv',
): Promise<void> {
  const file = await (format === 'gpx' ? exportRideGpx(options) : exportRideCsv(options))
  await Sharing.shareAsync(file.uri, {
    mimeType: file.mimeType,
    UTI: file.uti,
    dialogTitle: `Export ${format.toUpperCase()}`,
  })
}
