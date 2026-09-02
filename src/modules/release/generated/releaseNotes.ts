import type { BundledReleaseNote } from '../lib/releaseNotes'

export const bundledReleaseNotes = [
  {
    version: '0.91.1',
    markdown:
      '## Improved\n\n- The event log now gives clearer details when GPS updates stop, lose signal, recover, or fail because of permissions or provider errors.\n\n## Fixed\n\n- Fixed a crash that could occur when live ride and battery readouts used adaptive theme colors.\n',
  },
  {
    version: '0.91.0',
    markdown:
      '## New\n\n- Vescape now records VESC controller faults for each Board, with telemetry from up to five seconds before detection through two seconds after the fault clears. Review or dismiss each occurrence and read the controller fault log while the Board is connected and stopped.\n- Control board lights and the headlight independently from the Board drawer on compatible Refloat firmware.\n\n## Improved\n\n- Ride History now stays tied to the Board instead of its BLE address. Renaming a Board relabels past rides, while deleting a Board keeps its Ride History and Tune Profiles.\n- Expandable controls now open in a focused panel without shifting the drawer. Tap or drag the backdrop to close it.\n\n## Fixed\n\n- Vescape no longer warns that "Disable Moving Faults" is unsafe, since riders may deliberately use it with unreliable footpad sensors.\n- Live BMS cell-voltage and balancing trends now decode correctly.\n- The footpad indicator now matches the Board\'s physical left and right sensor zones, and both rails glow when either sensor engages in Posi mode.\n- Map light and dark changes now persist, and widget borders use the correct theme colors on iOS.\n',
  },
  {
    version: '0.90.0',
    markdown:
      "## New\n\n- Choose light, dark, system, or automatic sunrise and sunset themes. Maps, charts, controls, and navigation now adapt with the app.\n- Vescape now reads your board's Refloat and motor configuration during linking. Relevant pushback, cutoff, current, temperature, and footpad settings appear beside live telemetry, and Vescape reports changes made outside the app.\n- Duty, motor temperature, and controller temperature alert presets can now follow the board's own protection settings.\n- Active navigation now stays accessible in a compact sheet with remaining distance, ride time, and a quick cancel action.\n\n## Improved\n\n- Tune opens with the board's last known values while the latest configuration is being read.\n- The dashboard footpad indicator now shows both sensor zones against their real engagement voltages. The telemetry strip also fits better on smaller screens.\n- Cell voltage spread warnings now trigger at 0.20 V and become critical at 0.50 V, reducing premature warnings.\n- Group Ride discovery now finds nearby riders within 40 km.\n\n## Fixed\n\n- Fixed an iPhone crash that could occur while stopping or changing alert audio.\n- Board linking now retries interrupted integrity checks, times out cleanly when a link cannot be proven, and shows the actual reason linking was blocked.\n- Map style changes no longer leave a blank map or stuck spinner, and they preserve the camera position. Compass, pinch, and preview-pan transitions also keep the expected orientation.\n- Database restore now opens the file picker before confirmation and restores the selected backup correctly.\n",
  },
  {
    version: '0.89.2',
    markdown:
      '## Improved\n\n- Compass-follow mode is smoother and more reliable during long rides, with less background processing.\n- Mapy maps now use sharper, high-resolution tiles.\n\n## Fixed\n\n- Satellite imagery brightness and saturation settings now apply correctly on iOS.\n',
  },
  {
    version: '0.89.1',
    markdown:
      '## Fixed\n\n- Ride History now shows rides still in progress and refreshes them while the list is open. Active rides end at “now,” and your selected ride stays current as new data arrives.\n',
  },
  {
    version: '0.89.0',
    markdown:
      '## New\n\n- History now opens with an overview of your riding stats, recent rides, favorites, and route previews, with quick access to complete ride lists.\n- Group Ride now works on iPhone with live rider positions, roster updates, reconnection, and background continuity during active rides.\n\n## Improved\n\n- Alert presets now explain what you’ll hear at each level and make it easier to preview alert sounds before riding.\n- Ride History now loads complete rides in reliable pages, keeping long histories and profile stats consistent.\n- Auto-connect on iPhone now starts when Vescape launches and avoids duplicate connections when restoring an active session.\n\n## Fixed\n\n- Board Move now runs steadily instead of pulsing on boards using Refloat 1.0–1.2.\n- Opening a ride or favorite from History now selects the correct item, and favorite route thumbnails render reliably.\n- Compass heading on iPhone now points in the correct direction and stays stable during rides; off-screen map indicators no longer twitch in compass mode.\n- Weather radar now opens near current conditions and displays consistent 24-hour times.\n',
  },
  {
    version: '0.88.2',
    markdown:
      '## Fixed\n\n- Pushback voltage warnings now correctly handle legacy pack-voltage values on newer firmware, preventing false safety alerts.\n- Pinch-to-zoom no longer accidentally reveals the map, and map gestures remain responsive as the first GPS fix arrives.\n- The compass direction arrow now remains visible when GPS accuracy is approximate.\n',
  },
  {
    version: '0.88.1',
    markdown:
      '## Improved\n\n- Live telemetry charts now keep related readings synchronized while zooming and scrubbing, making battery, footpad, and IMU data easier to compare at the same moment.\n- Empty telemetry readouts now show their units and hide unavailable maximums, making disconnected screens easier to understand.\n\n## Fixed\n\n- Bottom drawers now stay fully visible when their content changes and remain stable during drag gestures.\n- Chart scrubbing now reports the closest recorded value when telemetry samples are sparse.\n',
  },
  {
    version: '0.88.0',
    markdown:
      '## New\n\n- Explore recorded rides with zoomable, scrubbable charts that stay in sync with the map and ride statistics. A new full-screen view shows every metric together, while favorites, GPS gaps, and selected ranges remain clearly marked.\n- Choose any linked boards that should automatically start Vescape when powered on, with a configurable quiet period after closing the app.\n\n## Improved\n\n- Active rides on iPhone are more resilient in the background: Vescape can restore an interrupted board connection, resume recording, and preserve the latest buffered telemetry.\n- Live metric detail charts now show full-resolution data, including their time coverage and sample rate.\n\n## Fixed\n\n- GPS recording on iPhone now starts immediately after first-time location permission is granted, without requiring a restart, and stale locations are no longer written into ride telemetry.\n- The iPhone Live Activity now clearly shows when it has lost contact with Vescape instead of continuing to display outdated ride data.\n',
  },
  {
    version: '0.87.0',
    markdown:
      '## New\n\n- Move a disengaged board forward or backward from your phone or Wear OS watch with hold-to-move controls. Choose the strength; releasing stops immediately, and wrist movement stops automatically if commands are interrupted.\n- Plan a route from your live position to a map destination, choose paths, cycleways, or roads, and review its distance and duration before riding. Follow remaining distance on your phone, with the route and optional direction arrow mirrored to Wear OS.\n- View current conditions and an hourly forecast on Wear OS, including rain chances and sunrise and sunset times.\n- Stop an active ride directly from the iOS Lock Screen or expanded Dynamic Island after authentication.\n- Open account status, updates, storage, and frequently used settings from the new ride-screen Settings drawer.\n- Choose how long a stop must last before Vescape splits a ride; changing it also regroups past rides.\n\n## Improved\n\n- Alerts now re-arm only after telemetry returns to a safe margin, preventing repeated warnings near a threshold. Each rule can repeat at a chosen interval or use one to five beeps, while sustained warning ranges are clearer on gauges.\n- Live gauges now scale speed to the active board’s top speed and extend temperature scales to 100°C.\n- The Wear OS mirror uses less battery during long rides by entering ambient mode and reducing unnecessary phone-link work.\n- Map search now favors nearby results and uses icons that better match each place, while enabled privacy zones appear directly on the map.\n- Tune now presents Basic settings first and keeps Tune Preview and advanced values hidden until requested.\n\n## Fixed\n\n- Board scans on iOS now continue when system UI briefly makes the app inactive instead of stopping before the board appears.\n',
  },
  {
    version: '0.86.0',
    markdown:
      '## New\n\n- Move your board forward or backward from Board Settings with hold-to-move controls, adjustable strength, trusted-link checks, and an immediate stop on release.\n- Open a new Settings drawer from the ride screen for quick access to account status, app updates, storage, and frequently used settings.\n- Choose how long a stop must be before Vescape splits a ride; changes also regroup past rides.\n\n## Improved\n\n- Alerts now re-arm only after telemetry returns to a safe margin, preventing repeated warnings near a threshold. Alerts can also repeat at a chosen interval, use one to five beeps, and clearly show sustained warning ranges on gauges.\n- Temperature presets now better reflect motor and controller limits, with repeating warnings near critical temperatures and gauges extending to 100°C.\n\n## Fixed\n\n- Legal Mode errors remain visible while the modal closes, giving you enough time to read what went wrong.\n- Drawers now dismiss with a smoother, more consistent fade.\n',
  },
  {
    version: '0.85.1',
    markdown:
      '## Fixed\n\n- On Android, direct board connections now restore live telemetry after an automatic reconnect instead of getting stuck waiting for data.\n- Map recentering and focus controls now reliably stop existing fling momentum and hold the intended view.\n- iOS can now restore Android backups without losing access to saved boards and ride history.\n',
  },
  {
    version: '0.85.0',
    markdown:
      '## Improved\n\n- Automatic ride recording is now enabled by default for new setups.\n- Map movement is smoother when following your ride, dragging to reveal the map, recentering, focusing on riders or points, and viewing ride history.\n\n## Fixed\n\n- Live telemetry readouts no longer disappear on iOS or cause rapid-update failures on Android.\n- The Android board notification now stays in sync through stale telemetry, reconnection, errors, and disconnects. It no longer shows old values and keeps Disconnect available during recovery.\n- Map movement no longer overshoots or vibrates after dragging to reveal the map.\n',
  },
  {
    version: '0.84.2',
    markdown:
      '## Fixed\n\n- The Wear OS splash screen now shows the complete Vescape logo on a black background.\n',
  },
  {
    version: '0.84.0',
    markdown:
      '## New\n\n- Test your alert setup before a ride. Vescape sweeps a simulated gauge through active thresholds, plays the real sounds or spoken messages, and marks thresholds on the chart without affecting saved rules or live board alerts.\n- View release notes for installed versions anytime from Settings.\n\n## Improved\n\n- Motor and battery current charts now cover the full ±300 A alert range, keeping higher readings and alert thresholds visible.\n\n## Fixed\n\n- Vescape now launches and connects to boards correctly on Android 11 and 12.\n- Tune Profiles now clearly explain missing or unsupported Refloat versions, and Retry re-reads the connected board.\n- Edge drawers now finish closing reliably when another gesture interrupts the animation.\n- The Wear OS splash screen now shows the complete Vescape logo on a black background.\n',
  },
  {
    version: '0.83.1',
    markdown:
      "## Fixed\n\n- Legal Mode's European guidance was re-audited, correcting road status and speed references for Bulgaria, Czechia, Iceland, and Malta while updating route, equipment, age, helmet, power, registration, and insurance rules across the catalog.\n- Tune Profiles now support two-part Refloat versions such as 1.1, allowing the first profile to be created correctly.\n",
  },
  {
    version: '0.83.0',
    markdown:
      '## New\n\n- Save any section of a ride as a named Favorite by trimming its chart. Favorites keep exact stats and routes, protect their telemetry from history deletion, and can hold imported photos and videos.\n\n## Fixed\n\n- Ride History charts now show their actual local start and end times instead of relative live-chart labels.\n- Ride and Favorites lists now open with the current selection in view.\n',
  },
  {
    version: '0.82.0',
    markdown:
      "## New\n\n- Shared Map Points let riders discover, filter, and navigate to nearby drops, bonks, nose slides, trail entries, viewpoints, and charging spots. Signed-in riders can contribute named points with descriptions, manage their own points, and vote on others' contributions.\n\n## Improved\n\n- Map navigation is more reliable, with steadier reveal movement, responsive destination markers, correctly updating map layers, and more dependable off-screen direction indicators.\n",
  },
  {
    version: '0.81.2',
    markdown:
      '## Improved\n\n- Group Ride identity controls now make editing your rider name and color clearer, with an expanded color selection.\n\n## Fixed\n\n- Tune History now reliably shows the newest entry first on Android when multiple changes occur within the same millisecond.\n',
  },
  {
    version: '0.81.1',
    markdown:
      '## Fixed\n\n- Telemetry charts with a secondary data series no longer crash when opened or scrubbed.\n',
  },
  {
    version: '0.81.0',
    markdown:
      '## New\n\n- Alert Presets provide Safe, Normal, Minimal, and Off protection levels for speed, duty, motor temperature, controller temperature, and battery. Individual metrics can still use custom alert rules.\n- Vescape can now show update notices, important announcements, and required-update guidance directly in the app.\n- Board Top Speed can be configured per board to scale speed gauges and preset alert thresholds appropriately.\n\n## Improved\n\n- Alerts are now stored separately for each board and can be configured during board setup or later in Board Settings.\n- Legal Mode is now enabled per board and enforced by the native riding service, so its speed warnings continue without relying on the app interface. Enabling it requires a connected board with a trusted link.\n',
  },
  {
    version: '0.80.2',
    markdown:
      '## New\n\n- Legal Mode can warn as you approach and exceed local speed limits, with jurisdiction guidance and a legal-limits map.\n- The map now has dedicated Explore, Weather, and Legal Limits views, including an animated, scrubbable weather-radar timeline.\n- Optional Vescape accounts let you sign in and manage your identity for online features while local riding features continue to work offline.\n\n## Improved\n\n- Satellite imagery now has adjustable opacity and smoother transitions, while weather navigation and map search behave more reliably.\n\n## Fixed\n\n- Fixed Legal Mode alert editing and several map issues involving satellite layers, weather positioning, search results, and the navigation north indicator.\n',
  },
  {
    version: '0.80.0',
    markdown:
      '## New\n\n- Board Warnings now monitor for unsafe configuration and battery conditions, including disabled footpad sensing, late pushback thresholds, disabled moving-fault protection, excessive cell spread, and battery configuration mismatches. Warnings explain the risk and can be dismissed or restored.\n- A new Auto Close option can close Vescape after your board remains disconnected for a configurable time.\n\n## Improved\n\n- The Wear OS companion can now open automatically when your board connects, shows clearer live gauges and connection state, and includes on-watch diagnostics.\n- Ride History now provides a clearer empty state before your first recorded ride.\n',
  },
  {
    version: '0.79.0',
    markdown:
      "## New\n\n- Vescape now verifies your board's firmware, Refloat package, and BMS after connecting. Firmware commands remain blocked until the saved Board Link is trusted, and hardware or firmware changes prompt you to re-link.\n- Tune Preview lets you compare how Tune Profiles respond to speed, pitch, hills, and ATR before syncing them to your board.\n\n## Improved\n\n- Smart-BMS details now follow the ride scrubber and show peak cell spread, the worst cell group, balancing, and charging state.\n- Tune Profiles can now have their own icon and color, and are easier to select from the main screen.\n- Photos and videos added to a ride are now kept with that ride and remain available in its gallery and map without ongoing photo-library access.\n- Manually closing Vescape can now pause Auto Start, preventing the app from immediately reopening.\n\n## Fixed\n\n- Compass-follow navigation is available again with a smoother, more efficient map-rendering path.\n",
  },
  {
    version: '0.77.0',
    markdown:
      '## Improved\n\n- Smart-BMS cell groups now use horizontal, automatically scaled bars and three-decimal voltage readings, making small imbalances easier to compare. Minimum, average, maximum, and total spread are shown together.\n\n## Fixed\n\n- Android now validates permissions and connection settings before starting background board, GPS, auto-connect, or Group Ride work, preventing service-start failures and using the correct system mode for each activity.\n',
  },
  {
    version: '0.76.0',
    markdown:
      "## New\n\n- Vescape's core riding experience is now available on iPhone, including board connection, live telemetry, alerts, ride recording and history, privacy zones, Refloat tuning, and Tune Profiles.\n- iPhone riders can follow connection, battery, and fault status from a Live Activity on the Lock Screen and Dynamic Island. Board faults can also raise a notification while the app is backgrounded when notification access is enabled.\n- The Battery screen now includes detailed smart-BMS telemetry with cell voltages, balancing state, temperatures, health, humidity, current, and a shareable raw snapshot.\n\n## Improved\n\n- Board connections now keep retrying until the board returns instead of eventually giving up.\n- Battery percentage, voltage, and current charts now share a synchronized scrubber, making load-related voltage sag easier to inspect.\n- Vescape now uses the Raleway typeface throughout for clearer, more consistent text.\n- Map and Group Ride updates use less processing power. Compass-follow mode has been temporarily disabled to prevent excessive battery use and device heating.\n\n## Fixed\n\n- Fixed Tune data sometimes remaining stale after reconnecting or returning to the app.\n- Fixed duplicate or outdated ride-status notifications and Live Activities.\n- Fixed map pins rendering incorrectly on iPhone.\n- Native changes such as updated settings and saved battery readings now appear without restarting the app.\n",
  },
  {
    version: '0.75.0',
    markdown:
      '## Improved\n\n- The battery gauge now remembers the last reading while disconnected and shows its age when it is over an hour old.\n- Tune differences now offer clear "Update tune" and "Send to board" actions, and the connected board\'s Refloat version is shown alongside its firmware details.\n\n## Fixed\n\n- Fixed Refloat tune writes that could fail because required package information was missing.\n- Group Ride heading arrows now point in the correct direction.\n',
  },
  {
    version: '0.74.0',
    markdown:
      "## Improved\n\n- Social and Tune panels now open as smooth, full-width edge drawers that scroll naturally and can be dismissed with a swipe or fling.\n- Direction markers now match your chosen rider color, including when shown at the edge of the map.\n\n## Fixed\n\n- Tune dials no longer conflict with the editor's dismiss gesture, keeping horizontal adjustments responsive.\n",
  },
  {
    version: '0.73.0',
    markdown:
      '## New\n\n- Group Rides now share each rider’s map target, shown as a color-matched pin and off-screen indicator.\n\n## Improved\n\n- Off-screen riders now appear along the map edge; tap an indicator to jump to that rider.\n\n## Fixed\n\n- Focusing on a rider no longer repeatedly snaps the map back as their position updates.\n',
  },
  {
    version: '0.72.0',
    markdown:
      '## Improved\n\n- Ride History now frames an early route preview while full ride details load, then smoothly refines to the complete route.\n- Your selected rider color now carries through to your live map position and trail.\n- Phone-heading movement is steadier, and approximate locations no longer show a misleading direction arrow.\n\n## Fixed\n\n- Pinch zoom momentum now continues while map perspective adjusts, and touching the map stops competing camera motion.\n',
  },
  {
    version: '0.71.0',
    markdown:
      '## Improved\n\n- Compass follow now waits for a valid heading and remains active through centered zoom and rotation gestures.\n- Weather opens in a consistent flat, north-up overview.\n\n## Fixed\n\n- Group Rides now connect to the live service in release builds, while create and join controls wait until the connection is ready.\n- Ride History no longer recenters the map over manual inspection when detailed route data finishes loading.\n',
  },
  {
    version: '0.70.0',
    markdown:
      '## New\n\n- Group Ride riders now leave recent trails on the live map, making it easier to see where the group is moving.\n\n## Improved\n\n- Group Ride rosters highlight low board battery and high motor or controller temperatures with warning and critical colors.\n\n## Fixed\n\n- Stationary Group Ride members no longer incorrectly appear stale while still connected.\n',
  },
  {
    version: '0.69.0',
    markdown:
      '## Improved\n\n- Group Ride rosters now include your own rider and show live speed, board battery, motor and controller temperatures, and phone battery for each rider.\n- Automatic idle pauses now wait three minutes, avoiding pauses during short stops.\n- The board selector now shows the telemetry rate currently sustained by the connection.\n\n## Fixed\n\n- Automatic idle pauses now appear with a clear marker and label in Ride History.\n',
  },
  {
    version: '0.68.0',
    markdown:
      '## New\n\n- Android riders can create or join nearby Group Rides, see live rider locations and board status on the map, and keep their location private inside enabled Privacy Zones.\n- Profile stats now show all-time and monthly distance, ride count, ride time, speeds, longest ride, and battery energy totals.\n\n## Improved\n\n- Ride Recording automatically pauses while idle and resumes as soon as you start moving again, with a clear paused state on the recording control.\n\n## Fixed\n\n- Android auto-start rides can now retain their GPS track in the background, with guidance for granting the required location permission.\n',
  },
  {
    version: '0.67.0',
    markdown:
      '## Improved\n\n- Active ride recordings now pause after 30 seconds without movement, reducing battery use and unnecessary history growth. Recording resumes with the first moving sample, and the record control clearly shows when it is paused.\n\n## Fixed\n\n- Long-press menus for Tune Profiles and Privacy Zones no longer also switch the selected item when released.\n- Floating controls on Android now contain touch ripples within their rounded edges.\n',
  },
  {
    version: '0.66.0',
    markdown:
      '## New\n\n- A new Wear OS companion mirrors live speed, duty cycle, battery level, and motor and controller temperatures. It clearly dims stale readings, reports disconnections, and keeps the display awake during live telemetry.\n\n## Improved\n\n- Ride History charts now scrub smoothly and stay synchronized with each other and the position marker on the map.\n- New ride recordings use less storage while preserving accurate totals, averages, energy, and peak values. Ride stats now also show the recorded point count.\n',
  },
  {
    version: '0.65.0',
    markdown:
      '## New\n\n- On Android 12 and newer, Auto Start can wake Vescape in the background and connect when your selected board is detected nearby.\n- The Android board notification now provides Connect and Disconnect controls.\n\n## Improved\n\n- Auto Start, Auto Connect, automatic recording, and connection sounds are now grouped on a dedicated Connection settings screen.\n',
  },
  {
    version: '0.64.0',
    markdown:
      "## Fixed\n\n- Disconnecting from a board on Android no longer risks crashing Vescape's background service.\n",
  },
  {
    version: '0.63.0',
    markdown:
      '## Fixed\n\n- Restoring a database backup now reloads Vescape so saved boards, settings, and ride history appear correctly.\n',
  },
] as const satisfies readonly BundledReleaseNote[]
