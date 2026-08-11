import legalPolicies from '../../../../shared/data/legal-policies.json'
import { theme } from '@/constants/theme'
import type { LegalRoadStatus } from '@/modules/legal/lib/types'

export interface LegalLimitCountry {
  name: string
  code: string
  alpha3: string
  legalSpeedKmh: number | null
  warningSpeedKmh: number | null
  referenceSpeedKmh: number | null
  status: LegalRoadStatus
  confidence: 'high' | 'medium' | 'low'
  labelCoordinate: [number, number]
  speedLimitBasis: string
  warningText: string | null
  sourceUrl: string
  checkedAt: string
}

export const LEGAL_LIMIT_COUNTRIES = legalPolicies as unknown as readonly LegalLimitCountry[]

export interface LegalLimitCountryDetail {
  vehicleScope: string
  where: string
  equipment: string
  insurance: string
  notes: string
}

const LEGAL_LIMIT_COUNTRY_DETAILS: Record<string, LegalLimitCountryDetail> = {
  AT: {
    vehicleScope:
      'Monorovers, hoverboards and comparable small electric self-balancing devices are treated like wheeled play/sports devices, not like e-scooters.',
    where:
      'Only at walking pace on pavements/footpaths and in residential or play streets when pedestrians are not endangered or obstructed; not on carriageways or cycle facilities.',
    equipment:
      'No public-road equipment route applies; the rider must maintain walking pace and yield to pedestrians.',
    insurance:
      'The cited guidance does not establish a motor-liability requirement for this limited pedestrian-area use.',
    notes: 'Do not apply Austria’s bicycle-style e-scooter rules to a handlebarless OneWheel/EUC.',
  },
  BE: {
    vehicleScope:
      'Motorised monowheels are expressly included as motorised mobility devices when design-limited to 25 km/h.',
    where:
      'At no more than walking pace, pedestrian rules apply; above walking pace, cyclist rules apply, including use of cycle facilities where required.',
    equipment:
      'The device must be limited by construction to 25 km/h; lighting and visibility rules apply when riding in darkness or poor visibility.',
    insurance:
      'No compulsory motor insurance is generally required for a compliant 25 km/h mobility device; personal liability cover remains prudent.',
    notes: 'A device capable by design of more than 25 km/h falls outside this category.',
  },
  BG: {
    vehicleScope:
      'Bulgarian law expressly defines a self-balancing vehicle as a motor-driven one-wheel or two-parallel-wheel device with design speed no more than 25 km/h. The broader individual-electric-vehicle category is limited to 50 kg.',
    where:
      'Use cycling infrastructure; where none exists, keep as close as possible to the right edge of the carriageway, subject to national and municipal restrictions.',
    equipment:
      'Minimum age 16; helmet is mandatory; lights and reflective clothing/elements are required in reduced visibility. The device must be registered.',
    insurance: 'Compulsory motor third-party liability insurance is required.',
    notes:
      'The device must be design-limited to 25 km/h and may not exceed the 50 kg unladen-mass ceiling.',
  },
  HR: {
    vehicleScope:
      'Electric monocyles and self-balancing vehicles are expressly included as personal transport devices if they have no seat, continuous rated power no more than 0.6 kW and design speed no more than 25 km/h.',
    where:
      'Use cycle paths/lanes. Where none exists, use pedestrian areas and traffic-calmed zones without endangering pedestrians. A carriageway section limited to 50 km/h may be used only exceptionally where an installed traffic sign permits it.',
    equipment:
      'Minimum age 14; helmet is mandatory; visibility requirements apply at night or in poor visibility.',
    insurance:
      'No registration or compulsory liability-insurance requirement was identified for a compliant personal transport device.',
    notes:
      'Most high-powered EUCs and some Onewheel models exceed the 600 W continuous-power ceiling.',
  },
  CY: {
    vehicleScope:
      'Cyprus defines its regulated personal mobility/e-scooter device as having handlebars and at least two wheels.',
    where: 'No public-road category was identified for an ordinary handlebarless one-wheel device.',
    equipment: 'Not applicable without a recognised road category.',
    insurance: 'No insurance route was identified for this excluded device form.',
    notes:
      'Use should be limited to private property unless the transport authority confirms a different classification.',
  },
  CZ: {
    vehicleScope:
      'Czech courts classify a self-balancing electric unicycle as an “osobní přepravník” under § 2(nn) and § 60a. A OneWheel-style board uses the same fore-aft self-balancing mechanism and is treated here as the analogous device covered by the statute.',
    where:
      'Use pedestrian routes and undivided pedestrian/cycle paths only at walking pace. Dedicated cycle lanes and paths follow the applicable cycling rules. Use the carriageway only when the listed pedestrian or cycle infrastructure is unavailable or the pavement is impassable, then stay on the left shoulder or edge. Signposted local bans may apply.',
    equipment:
      'The personal-transporter rules do not set one nationwide design-speed cap. Follow route-specific and local limits, and do not endanger pedestrians or cyclists.',
    insurance:
      'Motor-liability insurance is required when maximum design speed exceeds 25 km/h, or when operating weight exceeds 25 kg and maximum design speed exceeds 14 km/h.',
    notes:
      'The 25 km/h bicycle/e-scooter approval category does not determine the road status of a self-balancing personal transporter. A selected software riding mode does not change the vehicle’s maximum design speed.',
  },
  DK: {
    vehicleScope:
      'The self-balancing-vehicle and motorised-skateboard scheme expressly covers one-person, self-balancing or board-type electric devices without conventional steering.',
    where:
      'Use bicycle infrastructure and bicycle traffic rules. Where no cycle path exists, the carriageway may be used only in a built-up area on a road limited to no more than 50 km/h. Pavements and pedestrian crossings are not riding areas.',
    equipment:
      'Maximum design speed 20 km/h; minimum age 15 unless accompanied by an adult; helmet, all-day lights and required reflectors apply. Maximum weight is 25 kg.',
    insurance:
      'No general compulsory third-party insurance requirement was identified for a compliant device.',
    notes: 'The 20 km/h limit is a design requirement, not merely the speed selected in an app.',
  },
  EE: {
    vehicleScope:
      'A personal light electric vehicle expressly includes a self-balancing vehicle and may be handlebarless; maximum design speed is 25 km/h.',
    where:
      'Use cycle/pedestrian infrastructure under the statutory priority and speed rules; road use is allowed where the Act permits it when suitable paths are absent.',
    equipment:
      'Brakes, audible warning and visibility equipment apply; helmet rules apply to younger riders.',
    insurance:
      'Motor liability insurance can be required when the device weighs over 25 kg and has a design speed over 14 km/h.',
    notes:
      'The ordinary 1 kW cap has a specific exception for self-balancing vehicles, but the 25 km/h design limit remains.',
  },
  FI: {
    vehicleScope:
      'Self-balancing devices are light electric vehicles when rated power is at most 1 kW and design speed at most 25 km/h.',
    where:
      'Bicycle rules and cycle facilities apply; a self-balancing device ridden at walking pace may use a pavement under pedestrian-safe conditions.',
    equipment:
      'Minimum age 15; brakes/controls and required lighting/reflectors apply; a helmet is strongly recommended.',
    insurance:
      'Motor liability insurance is required where the statutory speed/weight thresholds are met, including many devices over 25 kg.',
    notes:
      'A device over 1 kW or over 25 km/h is not roadworthy in this category without another approval.',
  },
  FR: {
    vehicleScope:
      'EDPM rules expressly include monowheels, hoverboards and other motorised personal mobility devices limited to 25 km/h.',
    where:
      'Use urban cycle lanes/paths; where none exists, roads normally limited to 50 km/h. Pedestrian areas may be used only at walking pace without obstructing pedestrians.',
    equipment:
      'Minimum age 14; brakes, audible warning, lights and reflectors are required; only one rider.',
    insurance:
      'Third-party civil-liability insurance for motorised personal mobility use is compulsory.',
    notes: 'A device capable by design of more than 25 km/h is not a compliant EDPM.',
  },
  DE: {
    vehicleScope:
      'The eKFV category requires a steering or holding bar, national operating approval and an insurance plate. Ordinary monowheels and Onewheels are excluded.',
    where:
      'No ordinary public-road or cycle-path use; private property only with the owner’s permission.',
    equipment: 'There is no standard public-road approval equipment route for this device form.',
    insurance: 'Buying insurance cannot cure the lack of vehicle approval.',
    notes: 'This is different from an approved German e-scooter.',
  },
  GR: {
    vehicleScope:
      'Greek light personal electric-vehicle rules include electric skateboards and self-balancing personal vehicles with one or two wheels.',
    where:
      'Very slow devices follow pedestrian-type rules; devices up to 25 km/h use bicycle facilities and permitted urban roads, subject to local restrictions.',
    equipment: 'Helmet and prescribed lighting/visibility equipment apply.',
    insurance:
      'No general compulsory insurance requirement was confirmed for an ordinary compliant device.',
    notes:
      'The 2026 proposal for new insurance and age restrictions was not yet enacted at the audit date. Municipal restrictions and signs may narrow where the device can be used.',
  },
  HU: {
    vehicleScope:
      'The current KRESZ does not provide a sufficiently clear, stable national category for ordinary OneWheel/EUC use.',
    where: 'No reliable nationwide route rule was confirmed as of 30 July 2026.',
    equipment: 'Not confirmed.',
    insurance: 'Not confirmed.',
    notes:
      'The February 2026 new-KRESZ proposal remains a draft and must not be presented as current law.',
  },
  IS: {
    vehicleScope:
      'The statutory small-motor-vehicle category covers a motorised vehicle without a seat that is neither a moped nor a bicycle and is designed for 6–25 km/h; it is not limited to handlebars or a minimum number of wheels.',
    where:
      'Bicycle rules apply. Cycle paths and other bicycle-permitted infrastructure may be used; carriageway use is permitted on roads limited to no more than 30 km/h, subject to local signs.',
    equipment:
      'Minimum age 13; the vehicle must remain design-limited to 25 km/h. Bicycle lighting and visibility rules apply; a helmet is recommended.',
    insurance:
      'Official guidance states that compulsory insurance does not apply to compliant small motor vehicles.',
    notes:
      'A software mode does not make a device designed for more than 25 km/h compliant, and modifying it beyond that limit makes its use unlawful.',
  },
  IE: {
    vehicleScope:
      'A legal electric scooter must have two or more wheels and handlebars. Irish law prohibits other powered personal transporters in a public place.',
    where: 'Private property only with the owner’s permission.',
    equipment: 'No public-road equipment route applies to an ordinary OneWheel/EUC.',
    insurance: 'Not applicable as a route to public-road legality.',
    notes:
      'The legalisation of e-scooters on 20 May 2024 did not legalise electric unicycles or Onewheel-style boards.',
  },
  IT: {
    vehicleScope:
      'Current nationwide rules regulate electric scooters. Monowheels, hoverboards and similar devices appeared only in the earlier municipal experimentation framework.',
    where:
      'No current nationwide public-road permission for ordinary monowheels/OneWheels was confirmed.',
    equipment:
      'Scooter plate, helmet and equipment rules should not be copied onto a device that is outside the scooter category.',
    insurance:
      'Scooter insurance/plate requirements do not create a legal approval route for a monowheel.',
    notes:
      'Do not treat the expired/time-limited experimentation rules as current nationwide permission.',
  },
  LV: {
    vehicleScope:
      'The Road Traffic Law defines an electric scooter as a two-wheel vehicle with handlebars; a OneWheel/EUC does not meet that definition.',
    where:
      'No alternative public-road category was identified for an ordinary handlebarless one-wheel device.',
    equipment: 'Not applicable without an approved category.',
    insurance: 'No insurance or registration route was identified for this device form.',
    notes: 'Private-property use is the prudent interpretation.',
  },
  LT: {
    vehicleScope:
      'The electric micromobility category expressly includes electric skateboards and electric balancing unicycles, with power no more than 1 kW and design speed no more than 25 km/h.',
    where:
      'Use cycle infrastructure and permitted road areas under micromobility rules; operating speed is generally limited to 20 km/h and to 7 km/h near or while passing pedestrians.',
    equipment:
      'Since 1 January 2026, a fastened bicycle, skateboard or motorcycle helmet is mandatory for every rider. Brake, audible warning, lights and reflectors are required.',
    insurance:
      'No general compulsory motor-insurance requirement was identified for an ordinary compliant device.',
    notes: 'Both the 1 kW power ceiling and 25 km/h construction ceiling matter.',
  },
  LU: {
    vehicleScope:
      'A micro electric vehicle may have one or more wheels, be solely electric, have no more than 250 W and a design speed above 6 but no more than 25 km/h; monowheels are expressly included.',
    where:
      'Bicycle-oriented route rules apply, with pedestrian-speed duties in pedestrian contexts.',
    equipment: 'Required braking, warning, lighting and reflector equipment applies.',
    insurance:
      'No registration or compulsory motor-insurance requirement was identified for the compliant category; civil-liability cover is advisable.',
    notes: 'Devices over 250 W or 25 km/h fall outside the category.',
  },
  MT: {
    vehicleScope:
      'Maltese regulations expressly define self-balancing vehicles to include powered one-wheel vehicles.',
    where:
      'A registered self-balancing vehicle may use footpaths, promenades and pedestrian zones at no more than 6 km/h. Carriageway use is allowed only on a Tour Route formally designated by the Authority.',
    equipment:
      'Registration is mandatory. Minimum age 14; a fastened bicycle helmet, front white light, rear red light and horn or bell are required for road use.',
    insurance:
      'The cited self-balancing-vehicle provisions require registration but do not state a separate compulsory-insurance requirement.',
    notes:
      'This is a narrow public-use permission, not the ordinary e-kickscooter route scheme; Tour Route restrictions may be more specific.',
  },
  NL: {
    vehicleScope:
      'The Dutch government expressly identifies monowheels and Onewheels as vehicles that may not be used on public roads or pavements.',
    where:
      'Private property only. Public use would require an RDW-approved special-moped category, which ordinary listed devices do not have.',
    equipment: 'No equipment modification alone makes an unapproved device road-legal.',
    insurance:
      'Insurance and registration apply only after an eligible vehicle approval; they do not legalise an unapproved Onewheel.',
    notes: 'This is a clear prohibition, not merely an uncertain approval status.',
  },
  NO: {
    vehicleScope:
      'A one-person small electric motor vehicle can include standing/self-balancing and board-type devices when it is permanently limited to 20 km/h and meets the 70 kg and dimensional limits.',
    where:
      'Bicycle traffic rules apply; cycle facilities are used where required and pavements only at pedestrian-safe speed.',
    equipment:
      'Minimum age 12; helmet mandatory under 15; lights/reflectors and braking requirements apply.',
    insurance:
      'Compulsory liability insurance has applied to small electric motor vehicles since 1 January 2023.',
    notes:
      'A software riding mode is insufficient if the vehicle is constructed to exceed 20 km/h.',
  },
  PL: {
    vehicleScope:
      'An urządzenie transportu osobistego (UTO) expressly covers electric skateboards and self-balancing devices without a seat or pedals, with maximum design speed 20 km/h.',
    where:
      'Use bicycle paths/lanes. If none is available, a pavement/footpath may be used at pedestrian speed while yielding to pedestrians. UTO riding on the carriageway is prohibited.',
    equipment:
      'The device must meet the UTO construction limits. Since 3 June 2026, a helmet is mandatory for riders under 16; since 3 March 2026, children under 13 may ride only in a residential zone under adult supervision. Riders under 18 need the prescribed cycling entitlement.',
    insurance:
      'No compulsory third-party motor insurance is required for an ordinary compliant UTO.',
    notes: 'The road-up-to-30-km/h exception applies to e-scooters, not to UTO devices.',
  },
  PT: {
    vehicleScope:
      'Self-balancing and similar motor devices are bicycle-equivalent only when continuous rated power is no more than 0.25 kW and design speed no more than 25 km/h.',
    where: 'Compliant devices follow bicycle route rules, subject to local traffic restrictions.',
    equipment: 'Bicycle-equivalent lighting/visibility and safety duties apply.',
    insurance:
      'No compulsory motor insurance was identified for a device that remains within the bicycle-equivalent limits.',
    notes:
      'Most consumer Onewheels/EUCs exceed 250 W and therefore do not qualify even if speed-limited.',
  },
  RO: {
    vehicleScope:
      'Romania’s electric-scooter category requires two or three wheels and handlebars; ordinary one-wheel devices are outside it.',
    where: 'No public-road category for an ordinary OneWheel/EUC was confirmed.',
    equipment: 'Not applicable without a recognised category.',
    insurance: 'No insurance route was identified that would make the device road-legal.',
    notes: 'Do not import Romania’s e-scooter route and speed rules into this device type.',
  },
  SK: {
    vehicleScope:
      'Current law expressly defines and regulates self-balancing vehicles, which must not be capable of more than 25 km/h.',
    where:
      'Use the right side of pavements/footways at no more than walking speed (6 km/h) without endangering pedestrians, and the right side of cycle lanes/paths without endangering cyclists. Other road use is age-restricted.',
    equipment:
      'One rider only; applicable safety and visibility rules apply. Some older wording assumes handlebars, so model-specific enforcement can be imperfect.',
    insurance:
      'No general compulsory motor-insurance requirement was identified under the current non-motor-vehicle classification.',
    notes:
      'Law 131/2026 changes the category to “small electric vehicle” from 1 September 2026 and applies cyclist-style rules with a 25 km/h construction limit.',
  },
  SI: {
    vehicleScope:
      'Slovenian police guidance states that light motor vehicles without handlebars are not permitted in road traffic.',
    where: 'Private property only with the owner’s permission.',
    equipment: 'No public-road equipment route exists for an ordinary handlebarless device.',
    insurance: 'Insurance does not create public-road legality.',
    notes:
      'This directly excludes ordinary OneWheel/EUC devices even though e-scooters are regulated.',
  },
  ES: {
    vehicleScope:
      'A VMP may have one or more wheels, one seat/place and electric propulsion, with design speed 6–25 km/h; a OneWheel/EUC can fit only if it satisfies the VMP technical regime.',
    where:
      'Urban use only under national prohibitions and municipal route rules; pavements and interurban roads are prohibited.',
    equipment:
      'Registration and identifying label are required. Certified models must meet the DGT technical manual; older non-certified VMPs have a transition only until 22 January 2027.',
    insurance: 'Compulsory insurance applies through the 2026 national registration system.',
    notes:
      'From 1 October 2026, national rules add minimum age 15, helmet and night/low-visibility reflective requirements; local rules apply before then.',
  },
  CH: {
    vehicleScope:
      'ASTRA lists mono-wheel/smart-wheel devices separately from approved e-scooters and allows them only on private property.',
    where: 'Private property only.',
    equipment: 'No public-road equipment or approval path is provided for this category.',
    insurance:
      'No public-road insurance route applies because the vehicle is not admitted to public traffic.',
    notes: 'Public-road, cycle-path and pavement use are not permitted.',
  },
  SE: {
    vehicleScope:
      'A self-balancing electric vehicle without pedals can be classified as a bicycle when designed for one rider and no more than 20 km/h; unlike ordinary e-scooters, the self-balancing branch is not subject to the 250 W ceiling.',
    where:
      'Bicycle rules apply: use cycle paths normally; eligible riders may use suitable roads under the stated bicycle rules. At walking pace, a self-balancing rider can be treated as a pedestrian.',
    equipment:
      'Brake and bell are required; lights and reflectors are required in darkness. Helmet required for riders under 15.',
    insurance:
      'Motor liability insurance can be required if the device exceeds the statutory weight/speed threshold, notably over 25 kg and over 14 km/h.',
    notes: 'A device designed for more than 20 km/h does not qualify as a bicycle.',
  },
  GB: {
    vehicleScope:
      'Powered transporters expressly include powered unicycles, U-wheels and similar self-balancing devices and are treated as motor vehicles.',
    where:
      'Ordinary use is limited to private land with the owner’s permission; rental e-scooter trials do not authorise private OneWheels/EUCs.',
    equipment:
      'Public-road use would require vehicle approval, registration, licensing and compliant construction that ordinary devices do not have.',
    insurance:
      'Motor insurance would be required for public use, but insurance alone cannot overcome the lack of approval/registration.',
    notes: 'The e-scooter trial exception does not apply to privately owned one-wheel devices.',
  },
}
export const LEGAL_LIMIT_MAP_CAMERA = {
  centerCoordinate: [13, 53] as [number, number],
  zoomLevel: 3.05,
  heading: 0,
  pitch: 0,
}

export const LEGAL_ROAD_STATUS_LABELS: Record<LegalRoadStatus, string> = {
  likelyLegal: 'No major issue',
  restricted: 'Restricted',
  notRoadLegal: 'Not road-legal',
  unknown: 'Unknown',
}

export const LEGAL_ROAD_STATUS_COLORS: Record<LegalRoadStatus, string> = {
  likelyLegal: theme.palette.green.color,
  restricted: theme.palette.amber.color,
  notRoadLegal: theme.palette.red.color,
  unknown: theme.palette.sky.color,
}

export const LEGAL_ROAD_STATUS_LEGEND: readonly LegalRoadStatus[] = [
  'likelyLegal',
  'restricted',
  'notRoadLegal',
  'unknown',
]

export function getLegalLimitCountryByCode(countryCode: string): LegalLimitCountry | null {
  const normalized = countryCode.trim().toUpperCase()
  return (
    LEGAL_LIMIT_COUNTRIES.find(
      (country) => country.code === normalized || country.alpha3 === normalized,
    ) ?? null
  )
}

export function getLegalLimitCountryDetail(
  country: LegalLimitCountry,
): LegalLimitCountryDetail | null {
  return LEGAL_LIMIT_COUNTRY_DETAILS[country.code] ?? null
}

export function legalStatusColorExpression() {
  const expression: unknown[] = ['match', ['get', 'iso_3166_1_alpha_3']]
  for (const country of LEGAL_LIMIT_COUNTRIES) {
    expression.push(country.alpha3, LEGAL_ROAD_STATUS_COLORS[country.status])
  }
  expression.push('transparent')
  return expression
}

export function legalCountryFilterExpression() {
  return [
    'in',
    ['get', 'iso_3166_1_alpha_3'],
    ['literal', LEGAL_LIMIT_COUNTRIES.map((c) => c.alpha3)],
  ]
}

export function legalLimitLabelShape(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: LEGAL_LIMIT_COUNTRIES.map((country) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: country.labelCoordinate },
      properties: {
        code: country.code,
        label: country.referenceSpeedKmh == null ? 'N/A' : `${country.referenceSpeedKmh}`,
        subtitle: country.referenceSpeedKmh == null ? '' : 'km/h',
        speedLimitBasis: country.speedLimitBasis,
        status: LEGAL_ROAD_STATUS_LABELS[country.status],
      },
    })),
  }
}
