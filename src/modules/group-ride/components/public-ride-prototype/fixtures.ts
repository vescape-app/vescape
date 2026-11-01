// UI-only fixtures. Never passed to the relay, native presence, or preference stores.
export type PublicMode = 'off' | 'ride' | 'day' | 'automatic'
export interface MockRider {
  id: string
  name: string
  friend: boolean
  board: string | null
  freshness: 'live' | 'recent'
  updatedAt: string
  age: string
  distance: string
  speed: number | null
  battery: number | null
  rideDistance: number | null
  voltage: number | null
  controller: number | null
  motor: number | null
  phone: number | null
  position: { x: number; y: number }
}
export const PUBLIC_MODES: { value: PublicMode; title: string; subtitle: string }[] = [
  { value: 'off', title: 'Off', subtitle: 'Your location is hidden' },
  { value: 'ride', title: 'One ride', subtitle: 'Visible until this ride ends' },
  { value: 'day', title: 'Today', subtitle: 'Visible until midnight' },
  {
    value: 'automatic',
    title: 'Always',
    subtitle: 'Visible whenever my board connects',
  },
]
export const MOCK_RIDERS: MockRider[] = [
  {
    id: 'ola',
    name: 'Ola',
    friend: true,
    board: 'Floatwheel ADV',
    freshness: 'live',
    updatedAt: '21:28:58',
    age: '2 s ago',
    distance: '240 m',
    speed: 22,
    battery: 72,
    rideDistance: 8.4,
    voltage: 75.2,
    controller: 38,
    motor: 46,
    phone: 64,
    position: { x: 70, y: 55 },
  },
  {
    id: 'kuba',
    name: 'Kuba',
    friend: false,
    board: 'Onewheel GT',
    freshness: 'recent',
    updatedAt: '21:28:00',
    age: '1 min ago',
    distance: '≈ 680 m',
    speed: 18,
    battery: 58,
    rideDistance: 6.1,
    voltage: 68.3,
    controller: 35,
    motor: 42,
    phone: null,
    position: { x: 44, y: 25 },
  },
  {
    id: 'maja',
    name: 'Maja',
    friend: true,
    board: 'Floatwheel ADV2',
    freshness: 'live',
    updatedAt: '21:28:57',
    age: '3 s ago',
    distance: '1.2 km',
    speed: 0,
    battery: 84,
    rideDistance: 3.2,
    voltage: 79.1,
    controller: null,
    motor: null,
    phone: 81,
    position: { x: 80, y: 77 },
  },
  {
    id: 'jan',
    name: 'Jan',
    friend: false,
    board: null,
    freshness: 'live',
    updatedAt: '21:28:56',
    age: '4 s ago',
    distance: '1.6 km',
    speed: null,
    battery: null,
    rideDistance: null,
    voltage: null,
    controller: null,
    motor: null,
    phone: 52,
    position: { x: 28, y: 70 },
  },
]
