# Legal Mode Speed Limits

Seed reference for Legal Mode jurisdiction defaults.

This is not legal advice. Micromobility categories differ by country: Poland has **UTO**, France uses EDPM, Germany's eKFV covers e-scooters and Segways but not monowheels/hoverboards/electric skateboards, and some countries let cities add stricter rules. These values are bundled Legal Policy catalog data, not rider-editable settings.

Legal Mode needs two separate ideas:

- **Legal Speed Limit**: the speed value used by the app for warning/limit controls.
- **Legal Road Status**: whether the board category appears road-legal in that jurisdiction.

A country can have a useful speed reference while still being not road-legal for this board category. Show that status without treating the speed as permission to ride.

All 31 country records and their detailed descriptions were rechecked on 2026-07-30. The country-specific primary or official source URL is stored with each record in `shared/data/legal-policies.json`.

Key sources used for corrections in this audit:

- Bulgarian Ministry of Interior, individual electric and self-balancing vehicle rules: https://mvr.bg/opp/полезна-информация1/уязвими-участници/водачи-на-иепс
- Danish self-balancing vehicle and motorised skateboard order 41/2019: https://www.retsinformation.dk/eli/lta/2019/41
- Icelandic Act 92/2024 on small motor vehicles: https://www.althingi.is/altext/stjt/2024.092.html
- Maltese Low-Powered Vehicles and Pedal Cycles Regulations, S.L. 65.26: https://legislation.mt/eli/sl/65.26/eng/pdf
- Lithuanian 2026 helmet and equipment amendment: https://e-seimas.lrs.lt/rs/legalact/TAD/9390fee4d4f311f0948bfb5fa1e0c51b/
- Polish consolidated Road Traffic Act, including the 2026 age and helmet amendments: https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20240001251/U/D20241251Lj.pdf

Czech sources checked on 2026-07-30:

- Czech Road Traffic Act 361/2000, § 2(nn) and § 60a: https://www.zakonyprolidi.cz/cs/2000-361
- Czech Supreme Administrative Court, 2 As 192/2025-48: https://www.zakonyprolidi.cz/judikat/nsscr/2-as-192-2025-48
- Czech Constitutional Court, II. ÚS 1129/26: https://nalus.usoud.cz/Search/GetText.aspx?sz=2-1129-26_1
- Czech motor-liability insurance act 30/2024, § 2 and § 6: https://www.zakonyprolidi.cz/cs/2024-30

Czech sources checked on 2026-07-30:

- Czech Road Traffic Act 361/2000, § 2(nn) and § 60a: https://www.zakonyprolidi.cz/cs/2000-361
- Czech Supreme Administrative Court, 2 As 192/2025-48: https://www.zakonyprolidi.cz/judikat/nsscr/2-as-192-2025-48
- Czech Constitutional Court, II. ÚS 1129/26: https://nalus.usoud.cz/Search/GetText.aspx?sz=2-1129-26_1
- Czech motor-liability insurance act 30/2024, § 2 and § 6: https://www.zakonyprolidi.cz/cs/2024-30

## UI Rules

- If `legalRoadStatus` is `notRoadLegal` or `restricted`, show a red warning mark on the Legal Mode icon.
- Tapping the warning opens a short explanation of why the status is risky or not road-legal.
- For not-road-legal or unknown countries, show the nearest regulated micromobility reference speed with the warning/status clearly.
- For numeric legal speed countries, warning speed remains `legalSpeedKmh - 5`.

## GPS Lookup Rules

- Do not continuously check GPS for Legal Mode.
- Run jurisdiction lookup only once when the app has a usable GPS/country signal and no saved Legal Mode jurisdiction result exists.
- Persist the resolved jurisdiction result so app restart reuses it without another lookup.
- A later explicit rider action may refresh jurisdiction, but passive UI rendering must not poll GPS or re-run lookup.
- Legal Mode UI should re-render when the saved jurisdiction reference changes.

## Seed Table

`warningSpeedKmh` should default to `legalSpeedKmh - 5` when a numeric limit exists. For `notRoadLegal` and `unknown` countries, the speed is the nearest regulated micromobility max-speed reference, not a claim that the one-wheel category is road-legal.

| Country        | Country code | Legal speed default | Warning speed default | Speed basis                                        | Legal Road Status for VESC board-style vehicle | Confidence | Notes                                                                                                                                               |
| -------------- | ------------ | ------------------: | --------------------: | -------------------------------------------------- | ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Austria        | AT           |              5 km/h |                4 km/h | Walking-pace play/sports-device rule               | restricted                                     | high       | Walking pace only (shown as 5 km/h because the rule has no fixed numeric value); not a road or cycle-lane vehicle.                                  |
| Belgium        | BE           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | No warning.                                                                                                                                         |
| Bulgaria       | BG           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | Explicit self-balancing category; maximum 50 kg, registration, insurance, helmet and minimum-age rules apply.                                       |
| Croatia        | HR           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | Only devices up to 600 W qualify; carriageway use additionally requires a permitting traffic sign.                                                  |
| Cyprus         | CY           |             20 km/h |               15 km/h | E-scooter reference limit                          | notRoadLegal                                   | medium     | The legal e-scooter category requires handlebars and at least two wheels.                                                                           |
| Czech Republic | CZ           |                 N/A |                   N/A | Route-dependent personal-transporter rules         | restricted                                     | high       | Walking pace on pedestrian routes; cycling rules on dedicated cycle facilities; carriageway use only as a fallback.                                 |
| Denmark        | DK           |             20 km/h |               15 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | No warning.                                                                                                                                         |
| Estonia        | EE           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | No warning.                                                                                                                                         |
| Finland        | FI           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | Maximum rated power is 1 kW; faster or more powerful devices need another approval category.                                                        |
| France         | FR           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | No warning.                                                                                                                                         |
| Germany        | DE           |             20 km/h |               15 km/h | eKFV small-electric-vehicle reference limit        | notRoadLegal                                   | high       | The eKFV approval route requires a steering or holding bar and therefore excludes ordinary monowheels/OneWheels.                                    |
| Greece         | GR           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | medium     | No warning.                                                                                                                                         |
| Hungary        | HU           |             25 km/h |               20 km/h | E-scooter reference fallback                       | unknown                                        | low        | A 2026 draft traffic code is not yet the law; the current national classification remains unclear.                                                  |
| Iceland        | IS           |             25 km/h |               20 km/h | Small-motor-vehicle category limit                 | likelyLegal                                    | high       | The category covers motorised vehicles without seats; bicycle rules apply and carriageway use is generally limited to roads up to 30 km/h.          |
| Ireland        | IE           |             20 km/h |               15 km/h | E-scooter reference limit                          | notRoadLegal                                   | high       | Public use of powered personal transporters is prohibited except for compliant two-or-more-wheel e-scooters.                                        |
| Italy          | IT           |             20 km/h |               15 km/h | E-scooter reference limit                          | notRoadLegal                                   | medium     | Historic municipal experimentation for monowheels should not be treated as current nationwide permission.                                           |
| Latvia         | LV           |             25 km/h |               20 km/h | E-scooter reference limit                          | notRoadLegal                                   | medium     | The statutory electric-scooter category requires two wheels and handlebars.                                                                         |
| Lithuania      | LT           |             20 km/h |               15 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | The device must be no more than 1 kW and 25 km/h by design; a helmet is mandatory for every rider.                                                  |
| Luxembourg     | LU           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | The category is limited to 250 W and a design speed above 6 km/h and no more than 25 km/h.                                                          |
| Malta          | MT           |              6 km/h |                5 km/h | Restricted self-balancing-vehicle route limit      | restricted                                     | high       | Registered one-wheel devices may use pedestrian areas up to 6 km/h; carriageway use is limited to designated Tour Routes.                           |
| Netherlands    | NL           |             25 km/h |               20 km/h | Approved special-moped reference limit             | notRoadLegal                                   | high       | The Dutch government expressly lists monowheels and Onewheels among vehicles prohibited on roads and pavements.                                     |
| Norway         | NO           |             20 km/h |               15 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | The device must be permanently design-limited to 20 km/h and meet size/weight limits.                                                               |
| Poland         | PL           |             20 km/h |               15 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | UTO devices may not use the carriageway; riders under 16 need a helmet and children under 13 are restricted to supervised residential-zone use.     |
| Portugal       | PT           |             25 km/h |               20 km/h | Restricted one-wheel/self-balancing category limit | restricted                                     | high       | Only self-balancing devices up to 250 W continuous power and 25 km/h are bicycle-equivalent.                                                        |
| Romania        | RO           |             25 km/h |               20 km/h | E-scooter reference limit                          | notRoadLegal                                   | medium     | The statutory e-scooter definition requires two or three wheels and handlebars.                                                                     |
| Slovakia       | SK           |             25 km/h |               20 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | Current rules explicitly cover self-balancing vehicles; a revised small-electric-vehicle regime starts 1 September 2026.                            |
| Slovenia       | SI           |             25 km/h |               20 km/h | E-scooter/light-motor-vehicle reference limit      | notRoadLegal                                   | high       | Light motor vehicles without handlebars are not permitted in road traffic.                                                                          |
| Spain          | ES           |             25 km/h |               20 km/h | Restricted one-wheel/self-balancing category limit | restricted                                     | high       | Registration, an identifying label and compulsory insurance are required; non-certified legacy VMPs may circulate only until 22 January 2027.       |
| Switzerland    | CH           |             20 km/h |               15 km/h | E-scooter reference limit                          | notRoadLegal                                   | high       | ASTRA states mono-wheel/smart-wheel devices may be used only on private property.                                                                   |
| Sweden         | SE           |             20 km/h |               15 km/h | One-wheel/self-balancing category limit            | likelyLegal                                    | high       | A self-balancing device qualifies as a bicycle only when designed for no more than 20 km/h.                                                         |
| United Kingdom | GB           |             25 km/h |               20 km/h | Rental e-scooter trial reference limit             | notRoadLegal                                   | high       | Powered unicycles and similar devices are motor vehicles but cannot ordinarily meet public-road licensing, registration and insurance requirements. |

## Implementation Notes

- `shared/data/legal-policies.json` is the single catalog consumed by JS, Android, and iOS.
- Native reverse geocodes the first usable GPS fix when no jurisdiction is stored and persists only `legalPolicy: { jurisdictionCode }` in App Settings.
- JS reads that reference plus the shared catalog for presentation and can request an explicit native refresh; it does not resolve or persist jurisdiction.
- Treat `legalRoadStatus` separately from numeric speed references.
- Start with country code lookup. Avoid municipality-level geofencing until there is a sourced city-rule dataset and a privacy review.
- Keep source URL and checked date with each catalog record.
