// Mapbox's export map omits its native hosts. Reuse public props instead of mirroring native specs.
declare module '@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewNativeComponent' {
  import type { ComponentProps } from 'react'
  import type { HostComponent } from 'react-native'
  import type { MarkerView } from '@rnmapbox/maps'
  const component: HostComponent<ComponentProps<typeof MarkerView>>
  export default component
}

declare module '@rnmapbox/maps/lib/module/specs/RNMBXMarkerViewContentNativeComponent' {
  import type { HostComponent, ViewProps } from 'react-native'
  const component: HostComponent<ViewProps>
  export default component
}
