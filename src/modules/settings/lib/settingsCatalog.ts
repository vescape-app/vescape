/* eslint-disable max-lines */
import {
  searchCatalog,
  type CatalogSearchHit,
  type SearchableGroup,
  type SearchableItem,
  type SearchableSection,
} from '@/helpers/search'

export type SettingsPlatform = 'ios' | 'android'

export type SettingsSectionId =
  | 'automation'
  | 'liveTelemetry'
  | 'diagnostics'
  | 'units'
  | 'map'
  | 'sounds'
  | 'watch'
  | 'accessories'
  | 'privacyZones'
  | 'history'
  | 'graphs'
  | 'dev'
  | 'about'
  | 'database'
  | 'rawSettings'
  | 'releaseNotes'

export interface SettingsItem extends SearchableItem {
  route?: string
  platforms?: readonly SettingsPlatform[]
}

export interface SettingsSection extends SearchableSection<string, SettingsItem> {
  id: SettingsSectionId
}

type SettingsGroup = SearchableGroup<string, SettingsSection>

const kw = (csv: string): string[] => csv.split(', ')

const item = (
  id: string,
  label: string,
  hint: string,
  keywords: string,
  extra?: Pick<SettingsItem, 'route' | 'platforms'>,
): SettingsItem => ({ id, label, hint, keywords: kw(keywords), ...extra })

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    title: 'Connection',
    sections: [
      {
        id: 'automation',
        label: 'Automation',
        hint: 'Auto start and auto connect',
        route: '/settings/automation',
        keywords: kw('bluetooth, ble, startup, background, wake'),
        items: [
          item(
            'auto-start',
            'Auto start app',
            'Open the app by itself when a board powers on',
            'wake up, companion, presence, launch, power on, pocket',
            { platforms: ['android'] },
          ),
          item(
            'auto-start-cooldown',
            'Don’t restart for',
            'Quiet window after you close the app yourself',
            'cooldown, auto start, quiet, restart, delay',
            { platforms: ['android'] },
          ),
          item(
            'auto-connect',
            'Auto connect',
            'Connect to your board when the app opens',
            'bluetooth, ble, pair, reconnect',
          ),
          item(
            'auto-recording',
            'Auto recording',
            'Start recording when board connects',
            'record, ride, session, logging, automatic',
          ),
          item(
            'auto-close',
            'Auto close app',
            'Close the app when the board stays disconnected',
            'shutdown, exit, quit, kill, disconnect',
            { platforms: ['android'] },
          ),
          item(
            'auto-close-delay',
            'Close after',
            'Time without a board connection before the app closes itself',
            'shutdown, timeout, auto close, delay, disconnect',
            { platforms: ['android'] },
          ),
        ],
      },
      {
        id: 'liveTelemetry',
        label: 'Live telemetry',
        hint: 'Chart length and update rate',
        route: '/settings/live-telemetry',
        keywords: kw('polling, hz, frequency, live data, buffer, performance'),
        items: [
          item(
            'live-history-limit',
            'Live telemetry length',
            'Minutes of full-rate board data the live charts keep',
            'chart length, history, window, minutes, buffer, memory',
          ),
          item(
            'telemetry-poll-rate',
            'Telemetry rate limit',
            'Caps telemetry requests per second',
            'hz, poll, refresh, frequency, update rate, fps',
          ),
        ],
      },
      {
        id: 'diagnostics',
        label: 'Diagnostics',
        hint: 'Board warnings and health checks',
        route: '/settings/diagnostics',
        keywords: kw('health, faults, errors, logs, debug'),
        items: [
          item(
            'board-warnings',
            'Board warnings',
            'Master switch for board health detection and warnings',
            'alerts, health, checks, detector, overheat, voltage',
          ),
          item(
            'vesc-fault-collection',
            'VESC fault collection',
            'Record live Refloat faults and controller fault log',
            'faults, refloat, controller, errors, vesc',
          ),
          item(
            'ride-markers-on-map',
            'Ride markers on map',
            'Show pause, connection, error, and gap markers on history routes',
            'pins, events, history, pause, gap, disconnect',
          ),
          item(
            'event-log',
            'Event log',
            'Browse locally persisted diagnostic events',
            'logs, events, diagnostics, history, errors',
            { route: '/settings/eventLog' },
          ),
          item(
            'navigation-diagnostics',
            'Navigation diagnostics',
            'Live map heading, GPS, and fallback evidence',
            'gps, compass, heading, location, bearing',
            { route: '/settings/navigationDiagnostic' },
          ),
        ],
      },
    ],
  },
  {
    title: 'Preferences',
    sections: [
      {
        id: 'units',
        label: 'Units',
        hint: 'Speed, distance, temperature, time and date formats',
        route: '/settings/units',
        keywords: kw('metric, imperial, formats'),
        items: [
          item(
            'speed-distance',
            'Speed & distance',
            'km/h · km · m or mph · mi · ft',
            'metric, imperial, km, kmh, miles, mph, meters, feet',
          ),
          item(
            'temperature',
            'Temperature',
            'Board, watch, weather and alerts (°C or °F)',
            'celsius, fahrenheit, degrees, temp, metric, imperial',
          ),
          item(
            'time-format',
            'Time format',
            '24-hour or 12-hour clock',
            'clock, 24h, 12h, am, pm, military',
          ),
          item(
            'date-format',
            'Date format',
            'How dates are formatted across the app',
            'calendar, dmy, mdy, ymd, day, month, year',
          ),
        ],
      },
      {
        id: 'map',
        label: 'Map',
        hint: 'Map appearance and satellite imagery',
        route: '/settings/map',
        keywords: kw('mapbox, navigation, reroute, imagery, poi'),
        items: [
          item(
            'hide-telemetry-map-details',
            'Hide telemetry map details',
            'Hide POIs, transit stops, and district labels on the home map',
            'poi, labels, clean, minimal, clutter, streets',
          ),
          item(
            'recalculate-beyond',
            'Recalculate beyond',
            'Distance from the path before rerouting to your Direction Point',
            'reroute, navigation, direction point, off route, path',
          ),
          item(
            'satellite-overlay',
            'Satellite overlay',
            'Use toned satellite imagery with roads and labels',
            'aerial, imagery, hybrid, map style, photo',
          ),
          item(
            'home-image-opacity',
            'Home image opacity',
            'Maximum satellite opacity for the home map',
            'satellite, dim, brightness, transparency',
          ),
          item(
            'explore-image-opacity',
            'Explore image opacity',
            'Maximum satellite opacity in Explore',
            'satellite, dim, brightness, transparency',
          ),
          item(
            'satellite-desaturation',
            'Satellite desaturation',
            'Base home-map satellite color desaturation',
            'grayscale, saturation, muted, color, night',
          ),
        ],
      },
      {
        id: 'sounds',
        label: 'Sounds',
        hint: 'Choose and preview a sound pack',
        route: '/settings/sounds',
        keywords: kw('audio, alerts, voice, tts, volume, mute, custom sounds'),
        items: [
          item(
            'app-sounds',
            'App sounds',
            'Enable or mute connection and app sound effects',
            'mute, silent, audio, playback, connection sounds',
          ),
          item(
            'audio-output',
            'Audio output',
            'Play sounds on Alarm or Media volume stream',
            'alarm, media, stream, volume, channel, speaker, bluetooth',
            { platforms: ['android'] },
          ),
          item(
            'sound-effects',
            'Sound effects',
            'Choose and preview an effects sound pack',
            'pack, theme, chime, beep, cues',
          ),
          item(
            'voice',
            'Voice',
            'Choose the spoken voice pack for alerts',
            'tts, speech, spoken, announcer, narrator',
          ),
          item(
            'voice-level',
            'Voice detail',
            'How much detail spoken alerts read out',
            'verbosity, speech, tts, chattiness, spoken, voice level',
          ),
          item(
            'my-sounds',
            'My sounds',
            'Import custom WAV, M4A, or MP3 alert sounds and overrides',
            'custom, import, upload, mp3, wav, m4a, overrides',
          ),
        ],
      },
    ],
  },
  {
    title: 'Devices',
    sections: [
      {
        id: 'watch',
        label: 'Watch',
        hint: 'Push rate and what the wrist shows',
        route: '/settings/watch',
        keywords: kw('wear, wearos, apple watch, smartwatch, wrist, mirror'),
        items: [
          item(
            'watch-open-on-connect',
            'Open on connect',
            'Bring the watch app to the front when the board connects',
            'auto launch, wear, wrist, start',
          ),
          item(
            'watch-update-rate',
            'Update rate',
            'How often the watch gets new readings (Hz)',
            'push rate, hz, refresh, battery, frequency',
          ),
          item(
            'watch-trail',
            'Trail on telemetry screen',
            'Show where you have ridden behind the watch gauges',
            'breadcrumb, path, track, gauges',
          ),
          item(
            'watch-group-ride',
            'Public Ride on telemetry screen',
            'Show your Public Ride behind the watch gauges',
            'riders, friends, social, gauges, group ride',
          ),
          item(
            'watch-route-line',
            'Route line on telemetry screen',
            'Show the navigation route behind the watch gauges',
            'navigation, direction, path, gauges',
          ),
          item(
            'watch-street-map',
            'Street map',
            'Draw streets under the route on the watch',
            'tiles, roads, watch map, streets',
          ),
          item(
            'watch-map-behind-gauges',
            'Map behind gauges',
            'How strongly streets show behind the watch gauges',
            'opacity, dim, streets, gauges',
          ),
          item(
            'watch-nav-arrow',
            'Navigation arrow',
            'Draw the direction chevron over the route on the watch',
            'chevron, heading, direction, bearing',
          ),
          item(
            'watch-tilt-speed',
            'Tilt speed',
            'How fast the watch Tilt stick changes tilt',
            'remote, stick, control, nose, angle',
          ),
        ],
      },
      {
        id: 'accessories',
        label: 'Accessories',
        hint: 'Manage sensors and lights',
        route: '/accessories',
        keywords: kw('lights, brake light, lidar, ground clearance, sensors, ble'),
        items: [],
      },
    ],
  },
  {
    title: 'Recording',
    sections: [
      {
        id: 'privacyZones',
        label: 'Privacy zones',
        hint: 'Skip recording near saved places',
        route: '/settings/privacy-zones',
        keywords: kw('home, hide, location, gps, geofence, places'),
        items: [],
      },
      {
        id: 'history',
        label: 'History',
        hint: 'Ride splitting, data filters and battery smoothing',
        route: '/settings/history',
        keywords: kw('rides, sessions, filters, smoothing, stats'),
        items: [
          item(
            'split-rides-after',
            'Split rides after',
            'Stop duration that starts a new ride',
            'gap, session, merge, break, minutes',
          ),
          item(
            'moving-speed-threshold',
            'Moving speed threshold',
            'Speeds below this are ignored for average speed',
            'avg speed, average, stopped, idle, filter',
          ),
          item(
            'battery-smoothing',
            'Battery smoothing',
            'Median window steadies battery % for display and alerts',
            'soc, percentage, median, sag, filter',
          ),
        ],
      },
      {
        id: 'graphs',
        label: 'Graphs',
        hint: 'Hot gradients and color ramps',
        route: '/settings/graphs',
        keywords: kw('charts, colors, gradients, thresholds, heatmap'),
        items: [
          item(
            'graph-hot-gradients',
            'Graph hot gradients',
            'Color live, history, and map graphs by metric value',
            'color ramp, warning, heatmap, charts',
          ),
          item(
            'hot-range-speed',
            'Speed hot range',
            'Graph color ramp start and end for speed',
            'gradient, color, threshold, kmh, mph',
          ),
          item(
            'hot-range-duty',
            'Duty hot range',
            'Graph color ramp start and end for duty',
            'gradient, color, threshold, duty cycle',
          ),
          item(
            'hot-range-tempMotor',
            'Motor temp hot range',
            'Graph color ramp start and end for motor temperature',
            'gradient, color, threshold, temperature, heat',
          ),
          item(
            'hot-range-tempController',
            'Controller temp hot range',
            'Graph color ramp start and end for controller temperature',
            'gradient, color, threshold, mosfet, esc, heat',
          ),
          item(
            'hot-range-motorCurrent',
            'Motor current hot range',
            'Graph color ramp start and end for motor current',
            'gradient, color, threshold, amps',
          ),
          item(
            'hot-range-batteryCurrent',
            'Battery current hot range',
            'Graph color ramp start and end for battery current',
            'gradient, color, threshold, amps',
          ),
        ],
      },
    ],
  },
  {
    title: 'Developer',
    sections: [
      {
        id: 'dev',
        label: 'Dev tools',
        hint: 'Diagnostics and local verification',
        route: '/settings/dev',
        keywords: kw('developer, debug, testing, tools, prototypes'),
        items: [
          item(
            'components-library',
            'Components library',
            'Browse all UI components with live props',
            'showcase, ui, storybook, design system',
            { route: '/settings/components' },
          ),
          item(
            'debug-recordings',
            'Debug recordings',
            'Capture and export raw BLE sessions',
            'ble, capture, export, packets, trace',
            { route: '/settings/debug-recordings' },
          ),
          item(
            'camera-playground',
            'Camera playground',
            'Tune the spring camera engine against fake GPS',
            'map, spring, gps, simulation',
            { route: '/dev/map-playground' },
          ),
          item(
            'rail-generator-prototype',
            'Rail generator prototype',
            'Build and copy rail profile point presets',
            'rails, presets, prototype',
            { route: '/dev/rail-generator-prototype' },
          ),
          item(
            'alert-sounds-test',
            'Alert sounds',
            'Play severity sounds, Geiger, voice lines and TTS',
            'geiger, tts, severity, preview, test',
            { route: '/settings/alert-sounds' },
          ),
          item(
            'dev-other',
            'Other',
            'Small platform probes and local experiments',
            'probes, experiments, misc',
            { route: '/settings/other' },
          ),
        ],
      },
      {
        id: 'about',
        label: 'About us',
        hint: 'The people who built this app',
        route: '/settings/about',
        keywords: kw('credits, team, authors, creators, vescape'),
        items: [
          item(
            'privacy-policy',
            'Privacy policy',
            'Data, Public Ride sharing, and contact',
            'legal, gdpr, terms, data, contact',
          ),
        ],
      },
    ],
  },
]

export const SETTINGS_EXTRA_GROUPS: readonly SettingsGroup[] = [
  {
    title: 'App',
    sections: [
      {
        id: 'database',
        label: 'Database',
        hint: 'Back up, restore, and inspect ride database maintenance',
        route: '/settings/database',
        keywords: kw('storage, sqlite, backup, export, import, maintenance'),
        items: [
          item(
            'backup-database',
            'Back up database',
            'Export your ride history database',
            'export, backup, save, sqlite, rides',
          ),
          item(
            'restore-database',
            'Restore database',
            'Replace current database from a backup file',
            'import, restore, backup, sqlite, recover',
          ),
          item(
            'database-maintenance',
            'Maintenance',
            'Background database updates and cleanup jobs',
            'jobs, cleanup, rebuild, migration, storage',
          ),
        ],
      },
      {
        id: 'rawSettings',
        label: 'Raw settings',
        hint: 'Inspect all stored setting keys and values',
        route: '/settings/raw-settings',
        keywords: kw('json, keys, values, inspect, all settings'),
        items: [],
      },
      {
        id: 'releaseNotes',
        label: 'Release notes',
        hint: 'See what changed in recent app versions',
        route: '/settings/release-notes',
        keywords: kw('changelog, whats new, updates, version, history'),
        items: [],
      },
    ],
  },
]

const ALL_SETTINGS_GROUPS: readonly SettingsGroup[] = [...SETTINGS_GROUPS, ...SETTINGS_EXTRA_GROUPS]

export type SettingsSearchHit = CatalogSearchHit<string, SettingsSection, SettingsItem>

export function searchSettings(query: string, platform?: SettingsPlatform): SettingsSearchHit[] {
  const hits = searchCatalog(ALL_SETTINGS_GROUPS, query)
  if (!platform) return hits
  return hits.filter((hit) => !hit.item?.platforms || hit.item.platforms.includes(platform))
}
