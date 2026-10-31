import * as Sharing from 'expo-sharing'
import {
  exportRideGpx,
  exportRideCsv,
  exportRideFloaty,
  type RideExportFile,
  type RideExportOptions,
} from 'vescape-core'

export type RideExportFormat = 'gpx' | 'csv' | 'floaty'

const exporters: Record<RideExportFormat, (options: RideExportOptions) => Promise<RideExportFile>> =
  { gpx: exportRideGpx, csv: exportRideCsv, floaty: exportRideFloaty }

export const rideExportLabels: Record<RideExportFormat, string> = {
  gpx: 'Export GPX',
  csv: 'Export CSV',
  floaty: 'Export Floaty',
}

export async function shareRideExport(
  options: RideExportOptions,
  format: RideExportFormat,
): Promise<void> {
  const file = await exporters[format](options)
  await shareExportFile(file, rideExportLabels[format])
}

/** Native closes the writer before returning. Keep its cache file alive for share consumers. */
export async function shareExportFile(file: RideExportFile, dialogTitle: string): Promise<void> {
  await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, UTI: file.uti, dialogTitle })
}
