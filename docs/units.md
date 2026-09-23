# Rider units

Status: implemented.

## Preference and scope

One app-wide setting selects metric or imperial speed and distance units across Boards. Metric remains the default. Switching to imperial is explicit; phone region does not select it.

The preference applies to rider-facing speed and distance displays, inputs, charts, spoken alerts, and companion displays. Coverage includes live telemetry, Ride History, profile statistics, maps, Group Ride distances, Board Top Speed, alert thresholds, and tune previews. Temperature and hardware dimensions are outside this feature's scope.

Legal map labels, country-list values, and country-detail speed readouts also use the selected units, without an additional metric value in imperial mode. Authored legal explanations retain their original wording.

## Conversion

Keep existing metric storage, telemetry contracts, and calculations. Convert at presentation and input boundaries. A unit switch preserves recorded measurements and custom alert thresholds. Speed presets are regenerated with whole-number thresholds in the newly selected units. Existing history uses the currently selected display units.

Metric distance formatting keeps the existing meters-below-1-km convention. Imperial short-distance labels use feet below 0.1 mile, then miles. Ride totals use miles in imperial mode. Imperial speed uses mph.

## Editing speeds

Imperial alert thresholds use 1 mph steps; Board Top Speed uses 5 mph steps. The first increment or decrement snaps to the next clean step in that direction. For Board Top Speed displayed as 24.9 mph, increment selects 25 mph and decrement selects 20 mph.

New custom speed alerts initialize their thresholds at whole mph in imperial mode, then store the metric equivalents. Opening an existing alert preserves its saved thresholds exactly.

Speed labels omit trailing `.0`. Converted custom alerts and Board Top Speed can show one decimal until edited. Preserve their exact stored values when opening, closing, or switching units; never write a rounded display value back without an actual edit.

Examples:

- A saved 40 km/h appears as 24.9 mph. Switching back without editing still shows 40 km/h.
- Choosing 25 mph stores its metric equivalent, 40.2336 km/h. Switching back displays 40.2 km/h without changing that saved value.

## Speed presets

Speed presets use whole-number range endpoints in the current app units, then store canonical
km/h equivalents. The ceiling stays within Board Top Speed and the start stays at least one
selected speed unit below the ceiling for supported Board Top Speeds. At low top speeds, preset
levels can share a range. The same calculation serves native persistence and unsaved wizard previews.

Changing display units regenerates speed preset rules for every live Board in the same transaction
as the preference change. This changes actual firing speeds: Normal at a Board Top Speed of
50 km/h uses 36–45 km/h in metric and exactly 22–28 mph in imperial. Regeneration starts from
Board Top Speed and the preset definition, so repeated switches do not accumulate rounding drift.
Selecting a preset or changing Board Top Speed uses the current app units too.

The Board's `alertPreset` bag stores only the selected levels. Legacy `speedUnitSystem` metadata
is ignored. Saved-board previews and chart markers use persisted rules. Customization freezes
those rules at their current thresholds; neither custom nor manual alert thresholds are rounded
when units change. Their converted labels can show one decimal.

## Spoken alerts

Spoken speeds use whole numbers in both unit systems, rounding after conversion. This applies to
native announcements and the JS message preview; alert evaluation retains exact thresholds.

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

- Switching units repeatedly preserves measurements and custom thresholds; preset rules regenerate without cumulative drift.
- Editing an imperial threshold stores the corresponding metric value and fires at the same physical speed on Android and iOS.
- Phone and companion displays use the same preference; native spoken alerts honor it while JS is suspended.
- Converted values, chart scales, and unit labels agree.
- Step snapping works in both directions, including values already on a step boundary.
- Custom alert text stays unchanged while placeholders use the selected units.
