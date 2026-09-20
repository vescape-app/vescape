# Rider units

Status: implemented.

## Preference and scope

One app-wide setting selects metric or imperial speed and distance units across Boards. Metric remains the default. Switching to imperial is explicit; phone region does not select it.

The preference applies to rider-facing speed and distance displays, inputs, charts, spoken alerts, and companion displays. Coverage includes live telemetry, Ride History, profile statistics, maps, Group Ride distances, Board Top Speed, alert thresholds, and tune previews. Temperature and hardware dimensions are outside this feature's scope.

Legal map labels, country-list values, and country-detail speed readouts also use the selected units, without an additional metric value in imperial mode. Authored legal explanations retain their original wording.

## Conversion

Keep existing metric storage, telemetry contracts, and calculations. Convert at presentation and input boundaries. A unit switch changes neither recorded measurements nor the physical meaning of a saved threshold. Existing history uses the currently selected display units.

Metric distance formatting keeps the existing meters-below-1-km convention. Imperial short-distance labels use feet below 0.1 mile, then miles. Ride totals use miles in imperial mode. Imperial speed uses mph.

## Editing speeds

Imperial alert thresholds use 1 mph steps; Board Top Speed uses 5 mph steps. The first increment or decrement snaps to the next clean step in that direction. For Board Top Speed displayed as 24.9 mph, increment selects 25 mph and decrement selects 20 mph.

Converted settings can show one decimal until edited. Preserve the exact stored value when opening, closing, or switching units; never write a rounded display value back without an actual edit.

Examples:

- A saved 40 km/h appears as 24.9 mph. Switching back without editing still shows 40 km/h.
- Choosing 25 mph stores its metric equivalent, 40.2336 km/h. Switching back displays 40.2 km/h without changing that saved value.

## Spoken alerts

Convert speed placeholders such as `{value}`, `{threshold}`, and `{unit}` together. Preserve custom text verbatim, including any manually written unit names. Do not parse or rewrite free text.

## Native and companion behavior

The persisted app-wide `unitSystem` preference is `metric` or `imperial`. Missing or invalid values
resolve to metric. Native alert speech reads the preference without JS; custom alert text remains
verbatim while speed placeholders convert.

Both watches receive `unitSystem` through their existing settings channel. Android publishes the
latest settings at native process startup and after settings writes, including while its Board
Session service is stopped. Wear Data Layer retains the last payload for reconnects. iOS publishes
through process-scoped watch settings and merged Application Context, so changing units without a
Board Session does not bypass delivery. Watches restore the retained settings on startup and use
metric when an older phone omits the key.

Speed, navigation, radar, and accessibility readouts convert on the wrist. Watch Frames, routes,
gauge fractions, and temperature displays retain their existing units. The phone and wrist compile
the same pure native conversion helper on each platform; shared distance fixtures cover the
0.1-mile and 1-kilometer boundaries across Kotlin, Swift, and TypeScript.

## Implementation checks

- Switching units repeatedly leaves saved measurements and thresholds unchanged.
- Editing an imperial threshold stores the corresponding metric value and fires at the same physical speed on Android and iOS.
- Phone and companion displays use the same preference; native spoken alerts honor it while JS is suspended.
- Converted values, chart scales, and unit labels agree.
- Step snapping works in both directions, including values already on a step boundary.
- Custom alert text stays unchanged while placeholders use the selected units.
