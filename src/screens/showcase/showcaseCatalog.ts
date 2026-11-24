import {
  searchCatalog,
  type CatalogSearchHit,
  type SearchableGroup,
  type SearchableItem,
  type SearchableSection,
} from '@/helpers/search'

export type ShowcaseSectionId =
  | 'theme'
  | 'typography'
  | 'base'
  | 'markdown'
  | 'buttons'
  | 'controls'
  | 'forms'
  | 'modals'
  | 'drawers'
  | 'charts'
  | 'widgets'
  | 'settings'
  | 'board'
  | 'accessories'
  | 'tune'
  | 'history'
  | 'map'
  | 'weather'
  | 'social'
  | 'notices'
  | 'dev'

type ShowcaseItem = SearchableItem

interface ShowcaseSection extends SearchableSection<string, ShowcaseItem> {
  id: ShowcaseSectionId
}

type ShowcaseGroup = SearchableGroup<string, ShowcaseSection>

function item(name: string, keywords?: readonly string[]): ShowcaseItem {
  return keywords ? { id: name, label: name, keywords } : { id: name, label: name }
}

export const SHOWCASE_GROUPS: readonly ShowcaseGroup[] = [
  {
    title: 'Foundations',
    sections: [
      {
        id: 'theme',
        label: 'Theme foundations',
        hint: 'Canvas, interaction surfaces, semantic colors, and contrast',
        route: '/settings/components/theme',
        keywords: ['colors', 'palette', 'dark mode', 'light mode', 'appearance', 'swatches'],
        items: [],
      },
      {
        id: 'typography',
        label: 'Typography',
        hint: 'Raleway across every UI text role, with weight and tabular-nums parity',
        route: '/settings/components/typography',
        keywords: ['fonts', 'text', 'raleway'],
        items: [
          item('Typography roles', ['heading', 'title', 'body', 'caption']),
          item('Font weights', ['bold', 'medium', 'semibold']),
          item('Tabular nums', ['numbers', 'digits', 'alignment']),
          item('Monospace', ['code', 'mono']),
        ],
      },
      {
        id: 'base',
        label: 'Base',
        hint: 'Banners, placeholders, skeletons, and everyday building blocks',
        route: '/settings/components/base',
        keywords: ['primitives', 'loading'],
        items: [
          item('Placeholder', ['empty state', 'ghost']),
          item('Banner', ['alert', 'warning', 'info', 'error', 'notice']),
          item('TickText / MonoValue', ['animated number', 'counter', 'readout']),
          item('SectionHeader', ['heading', 'divider']),
          item('Skeleton', ['loading', 'shimmer', 'pulse']),
        ],
      },
      {
        id: 'markdown',
        label: 'Markdown',
        hint: 'Native rich text — nesting, links, images, and horizontally scrolling tables',
        route: '/settings/components/markdown',
        keywords: ['rich text', 'tables', 'links', 'release notes'],
        items: [item('Markdown', ['rich text', 'table', 'blockquote'])],
      },
    ],
  },
  {
    title: 'UI Kit',
    sections: [
      {
        id: 'buttons',
        label: 'Buttons',
        hint: 'Button, IconButton, and IconButtonExtension with live states',
        route: '/settings/components/buttons',
        keywords: ['cta', 'pressable', 'action'],
        items: [
          item('Button', ['primary', 'secondary', 'ghost', 'destructive']),
          item('IconButton', ['icon', 'circle', 'toolbar']),
          item('IconButtonExtension', ['badge', 'pill', 'extended']),
        ],
      },
      {
        id: 'controls',
        label: 'Controls',
        hint: 'Switches, toggles, selectors, pills, and floating bars',
        route: '/settings/components/controls',
        keywords: ['toggles', 'selectors', 'tabs'],
        items: [
          item('Switch', ['toggle', 'boolean']),
          item('RadioIndicator', ['radio', 'selection']),
          item('AlertPresetControl', ['presets', 'alerts']),
          item('MetricAlerts', ['thresholds', 'warnings']),
          item('Navigation top bar — reference', ['header', 'nav bar']),
          item('Animated board connection', ['ble', 'status', 'floating bar']),
          item('Board connection states', ['ble', 'connected', 'disconnected']),
          item('FloatingActionPill', ['fab', 'pill', 'action']),
          item('PrevNextSelector', ['stepper', 'arrows', 'pager']),
          item('SegmentedToggle', ['segmented control', 'tabs']),
          item('PillSelector', ['chips', 'zone pills', 'filter']),
          item('ExpandableCircleMenu', ['radial', 'fab', 'menu']),
        ],
      },
      {
        id: 'forms',
        label: 'Forms',
        hint: 'Inputs, search, dropdowns, pickers, and steppers',
        route: '/settings/components/forms',
        keywords: ['fields', 'text input', 'pickers'],
        items: [
          item('Select', ['picker', 'options']),
          item('DateField', ['date', 'calendar', 'birthday']),
          item('Input', ['text field', 'textbox']),
          item('SearchInput', ['search bar', 'filter', 'query']),
          item('Textarea (Input multiline)', ['multiline', 'notes', 'description']),
          item('Dropdown', ['menu', 'select']),
          item('SoundPicker', ['audio', 'alert sound']),
          item('ColorPicker', ['swatch', 'hex', 'palette']),
        ],
      },
      {
        id: 'modals',
        label: 'Modals',
        hint: 'Popups, confirmations, and prompt dialogs',
        route: '/settings/components/modals',
        keywords: ['dialogs', 'alerts', 'popups'],
        items: [
          item('FadeCardModal', ['overlay', 'card']),
          item('ConfirmModal', ['confirmation', 'dialog', 'delete']),
          item('InfoModal', ['information', 'dialog']),
          item('VersionNoticeModal', ['update', 'release']),
          item('CommunityMessageModal', ['announcement', 'broadcast']),
          item('AppBlockScreen', ['force update', 'maintenance']),
          item('TextPromptModal', ['input modal', 'rename']),
          item('TextPromptModal (clearable)', ['input modal', 'clear']),
        ],
      },
      {
        id: 'drawers',
        label: 'Drawers',
        hint: 'Edge drawers and floating sheets with drag to dismiss',
        route: '/settings/components/drawers',
        keywords: ['bottom sheet', 'top sheet', 'blur', 'overlays'],
        items: [
          item('EdgeDrawer — bottom resize and dismissal', ['bottom sheet', 'drag']),
          item('EdgeDrawer — top resize and dismissal', ['top sheet', 'drag']),
          item('EdgeDrawer — automatic edge', ['auto', 'popover']),
          item('EdgeDrawer — top edge', ['top sheet']),
          item('EdgeDrawer — bottom edge', ['bottom sheet']),
          item('EdgeDrawer — long scrolling content', ['scroll']),
          item('EdgeDrawer — virtualized list', ['flatlist', 'flashlist']),
          item('EdgeDrawer — late rows', ['async', 'dynamic height']),
          item('EdgeDrawer — initial focus', ['keyboard', 'autofocus']),
          item('FloatingSheet', ['sheet', 'modal']),
        ],
      },
      {
        id: 'charts',
        label: 'Charts',
        hint: 'Sparklines, gauges, and BMS cell voltage bars',
        route: '/settings/components/charts',
        keywords: ['graphs', 'telemetry', 'skia'],
        items: [
          item('Sparkline', ['mini chart', 'line']),
          item('SingleGauge / animated ramp', ['gauge', 'dial', 'arc']),
          item('DualGauge / animated ramp', ['gauge', 'dual']),
          item('LinearGauge', ['bar', 'progress']),
          item('ChartLoadingOverlay', ['spinner', 'loading']),
          item('BmsCellVoltages / horizontal cell rows', ['battery', 'cells', 'voltage']),
          item('ChartGestureHint', ['scrub', 'zoom', 'tooltip']),
        ],
      },
      {
        id: 'widgets',
        label: 'Widgets',
        hint: 'Dashboard tiles for displaying and editing live board data',
        route: '/settings/components/widgets',
        keywords: ['dashboard', 'tiles', 'grid'],
        items: [
          item('ExpandingWidget', ['tile', 'expand']),
          item('SwitchWidget', ['toggle', 'tile']),
          item('DialWidget', ['gauge', 'tile']),
          item('CanvasWidget', ['chart', 'tile']),
          item('InputWidget', ['number', 'tile']),
          item('LinkWidget', ['navigation', 'tile']),
          item('SelectWidget', ['dropdown', 'tile']),
          item('StepperWidget', ['increment', 'decrement', 'tile']),
        ],
      },
      {
        id: 'settings',
        label: 'Settings',
        hint: 'Cards, rows, and settings screen building blocks',
        route: '/settings/components/settings',
        keywords: ['rows', 'cards', 'preferences'],
        items: [
          item('StorageCell', ['database', 'disk', 'size']),
          item('Settings components', ['SettingsCard', 'SettingsRow', 'SettingsSectionTitle']),
          item('BoardTopSpeedCard', ['top speed', 'record']),
          item('AutoStartCard', ['automation', 'recording']),
        ],
      },
    ],
  },
  {
    title: 'Domain',
    sections: [
      {
        id: 'board',
        label: 'Board',
        hint: 'Device rows, badges, attitude dials, timelines, and board warnings',
        route: '/settings/components/board',
        keywords: ['vesc', 'refloat', 'ble', 'faults'],
        items: [
          item('DeviceRow', ['bluetooth', 'scan', 'pair']),
          item('StepTimeline', ['progress', 'steps', 'connection']),
          item('BoardWarningRow', ['warnings', 'health']),
          item('VescFaultRow', ['fault', 'error', 'diagnostics']),
          item('VescFaultCaptureSection', ['fault', 'capture']),
          item('RimTempArc', ['temperature', 'motor', 'mosfet']),
          item('LiveMetricCard', ['telemetry', 'speed', 'duty']),
          item('BoardConfigSection', ['config', 'refloat', 'motor']),
          item('BoardConfigFieldEditor', ['config', 'editor', 'refloat', 'settings']),
          item('BoardConfigReviewModal', ['config', 'review', 'changeset', 'revert', 'import']),
          item('BoardPill', ['chip', 'status']),
          item('BoardSelectorSheet', ['switch board', 'picker']),
          item('BoardConfigChangeNoticeModal', ['diff', 'config changed']),
          item('FootpadIndicator', ['sensors', 'adc', 'switches']),
          item('BoardAttitudeIndicator', ['pitch', 'roll', 'imu']),
          item('ImuAttitudeDial', ['gyro', 'tilt', 'imu']),
          item('Remote Tilt', ['remote tilt', 'pad', 'nose']),
          item('GpsStatusPill', ['gps', 'satellite', 'fix']),
        ],
      },
      {
        id: 'accessories',
        label: 'Accessories',
        hint: 'Accessory rows, compatibility notices, brake lights, and sensors',
        route: '/settings/components/accessories',
        keywords: ['lights', 'sensors', 'peripherals'],
        items: [
          item('AccessorySelectorSection', ['picker', 'list']),
          item('AccessoryCompatibilityNotice', ['firmware', 'compatibility']),
          item('AccessoryCapabilityRow', ['features', 'capabilities']),
          item('GroundClearanceReadout', ['height', 'distance', 'sensor']),
          item('BrakeLightStates', ['led', 'tail light']),
          item('Live sensor readout', ['telemetry', 'sensor']),
        ],
      },
      {
        id: 'tune',
        label: 'Tune',
        hint: 'Dials, sliders, and live previews for board tuning',
        route: '/settings/components/tune',
        keywords: ['tuning', 'profiles', 'refloat'],
        items: [
          item('TuneDial', ['dial', 'knob']),
          item('TuneDial Compact', ['dial', 'compact']),
          item('TuneDial Alert Percentage', ['duty', 'alert']),
          item('TuneDial Geiger Alert', ['geiger', 'alert']),
          item('BasicSliderCell + automatic-edge tune editor', ['slider', 'editor']),
          item('Tune Preview', ['curve', 'simulation']),
          item('Tune Preview — unsupported', ['fallback']),
          item('TuneProfileMetadataModal', ['profile', 'modal']),
          item('Tune editor modes', ['editor', 'modes']),
        ],
      },
      {
        id: 'history',
        label: 'History',
        hint: 'Ride tiles, route sparklines, and ride rows',
        route: '/settings/components/history',
        keywords: ['rides', 'trips', 'stats'],
        items: [
          item('RouteSparkline', ['route', 'path', 'mini map']),
          item('RidePreviewCard · RidePreviewStrip', ['card', 'strip', 'carousel']),
          item('HistoryRideRow', ['ride row', 'list']),
          item('ProfileStatsDetails', ['totals', 'odometer', 'stats']),
        ],
      },
      {
        id: 'map',
        label: 'Map',
        hint: 'Map pins, routes, riders, satellite imagery, and layers',
        route: '/settings/components/map',
        keywords: ['mapbox', 'radar', 'satellite', 'buildings', 'layers', 'pins'],
        items: [],
      },
      {
        id: 'weather',
        label: 'Weather',
        hint: 'Icons, pills, hourly strips, and alert settings',
        route: '/settings/components/weather',
        keywords: ['forecast', 'rain', 'wind', 'temperature'],
        items: [
          item('WeatherIcon', ['sun', 'cloud', 'rain']),
          item('WeatherStat', ['wind', 'humidity', 'uv']),
          item('WeatherPill', ['badge', 'compact']),
          item('WeatherHourlyStrip', ['forecast', 'hourly']),
          item('WeatherAlertsSettingsView', ['alerts', 'settings']),
        ],
      },
      {
        id: 'social',
        label: 'Social',
        hint: 'Friend rows, public rides, and rider rosters',
        route: '/settings/components/social',
        keywords: ['public ride', 'friends', 'riders'],
        items: [
          item('RiderLiveRide', ['live', 'rider']),
          item('Demo riders', ['roster', 'avatars']),
          item('FriendRow', ['friend', 'contact']),
          item('PublicRideRow', ['public ride', 'join']),
          item('RosterList', ['public ride', 'members']),
          item('PublicRideSelector', ['public ride', 'picker']),
        ],
      },
      {
        id: 'notices',
        label: 'Ride Notices',
        hint: 'Ride notice cards with severity, distance, and Show on map',
        route: '/settings/components/notices',
        keywords: ['hazards', 'alerts', 'map notices'],
        items: [item('RideNoticeCard', ['hazard', 'severity', 'notice'])],
      },
    ],
  },
  {
    title: 'Dev',
    sections: [
      {
        id: 'dev',
        label: 'Dev',
        hint: 'DevBadge and the showcase scaffolding these pages are built from',
        route: '/settings/components/dev',
        keywords: ['debug', 'showcase'],
        items: [
          item('DevBadge', ['dev', 'floating badge']),
          item('ShowcaseControls', ['ChipRow', 'ToggleRow', 'ValueRow']),
        ],
      },
    ],
  },
]

type ShowcaseSearchHit = CatalogSearchHit<string, ShowcaseSection, ShowcaseItem>

export function searchShowcase(query: string): ShowcaseSearchHit[] {
  return searchCatalog(SHOWCASE_GROUPS, query)
}
