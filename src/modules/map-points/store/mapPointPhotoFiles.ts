import { Directory, File, Paths } from 'expo-file-system'

/**
 * Local media attached to a Map Point. Server Map Points v1 carries no media, so this stays a
 * device-local shape and the UI that uses it is parked behind `MAP_POINT_MEDIA_ENABLED`.
 */
export interface MapPointMediaAsset {
  id: string
  uri: string
  filename: string
  mediaType: 'photo' | 'video'
}

export interface PickedMapPointMediaAsset {
  id: string
  uri: string
  filename: string
  mediaType: 'photo' | 'video'
}

function mapPointMediaDirectory(pointId: string): Directory {
  return new Directory(Paths.document, 'mapPointMedia', pointId)
}

function mediaExtension(uri: string, mediaType: PickedMapPointMediaAsset['mediaType']): string {
  return (
    /\.(\w+)(?:[?#].*)?$/.exec(uri)?.[1]?.toLowerCase() ?? (mediaType === 'video' ? 'mp4' : 'jpg')
  )
}

function safeFilename(index: number, asset: PickedMapPointMediaAsset): string {
  const extension = mediaExtension(asset.uri, asset.mediaType)
  const identity = `${asset.id}_${asset.uri}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24) || 'asset'
  return `${Date.now()}_${index + 1}_${asset.mediaType}_${identity}.${extension}`
}

export async function saveMapPointMediaAssets(
  pointId: string,
  assets: readonly PickedMapPointMediaAsset[],
): Promise<MapPointMediaAsset[]> {
  const directory = mapPointMediaDirectory(pointId)
  directory.create({ intermediates: true, idempotent: true })
  const saved: MapPointMediaAsset[] = []
  for (const [index, asset] of assets.entries()) {
    const filename = safeFilename(index, asset)
    const target = new File(directory, filename)
    if (!target.exists) await new File(asset.uri).copy(target)
    saved.push({ ...asset, uri: target.uri, filename })
  }
  return saved
}

export function deleteMapPointMediaAsset(uri: string): void {
  const file = new File(uri)
  if (file.exists) file.delete()
}
