/** A real WebSocket participant; no app state or native events are injected. */
interface PeerPresence {
  lat: number
  lng: number
  heading: number
  speed: number
  soc: number
  motorTemp: number
  ctrlTemp: number
  phoneBattery: number
  boardName: string
}
interface Rider {
  id: string
  name: string
  stale: boolean
  presence: { lat: number; lng: number; boardName?: string } | null
}
interface Message {
  type: string
  rideId?: string
  riders?: Rider[]
  message?: string
}
export const PHONE_FIX = { lat: 51.131, lng: 16.987 }
const PEER_ID = 'e2e-peer'
const INITIAL_PRESENCE: PeerPresence = {
  lat: PHONE_FIX.lat + 0.001,
  lng: PHONE_FIX.lng,
  heading: 90,
  speed: 5,
  soc: 0.12,
  motorTemp: 30,
  ctrlTemp: 30,
  phoneBattery: 0.8,
  boardName: 'E2E Board Alpha',
}

export class GroupRidePeer {
  private socket: WebSocket
  private timer?: ReturnType<typeof setInterval>
  private error: Error | null = null
  private presence = INITIAL_PRESENCE
  private joined = false
  roster: Rider[] = []
  readonly transcript: { direction: string; message: unknown }[] = []

  constructor(url: string, version: string) {
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket
    this.socket = new Socket(url, { headers: { 'Vescape-App-Version': version } })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message
      this.transcript.push({ direction: 'received', message })
      if (message.type === 'error') this.error = new Error(`Relay: ${message.message}`)
      if (message.type === 'joined') {
        this.joined = true
      }
      if (message.type === 'roster') this.roster = message.riders ?? []
    })
    this.socket.addEventListener('error', () => {
      this.error = new Error('Peer WebSocket failed')
    })
    this.socket.addEventListener('close', () => {
      this.error = new Error('Peer WebSocket closed')
    })
  }

  private send(message: unknown) {
    this.transcript.push({ direction: 'sent', message })
    this.socket.send(JSON.stringify(message))
  }

  private async wait(description: string, predicate: () => boolean, timeout = 60_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (this.error) throw this.error
      if (predicate()) return
      await Bun.sleep(200)
    }
    throw new Error(`Timed out: ${description}`)
  }

  async start() {
    await this.wait('peer connected', () => this.socket.readyState === WebSocket.OPEN)
    this.send({ type: 'hello', riderId: PEER_ID, name: 'Peer', color: '#41b883' })
    this.send({
      type: 'create',
      name: 'E2E Group Ride',
      location: { lat: this.presence.lat, lng: this.presence.lng },
      presence: this.presence,
    })
    await this.wait('peer created ride', () => this.joined)
    this.timer = setInterval(() => this.send({ type: 'presence', presence: this.presence }), 1000)
  }

  update() {
    this.presence = {
      ...this.presence,
      lat: PHONE_FIX.lat + 0.003,
      speed: 8,
      soc: 0.23,
      boardName: 'E2E Board Beta',
    }
    this.send({ type: 'presence', presence: this.presence })
  }

  async verifyPhone() {
    await this.wait('phone joined with native GPS presence', () =>
      this.roster.some(
        (rider) =>
          rider.id !== PEER_ID &&
          rider.name === 'E2E' &&
          !rider.stale &&
          rider.presence != null &&
          Math.abs(rider.presence.lat - PHONE_FIX.lat) < 0.0002 &&
          Math.abs(rider.presence.lng - PHONE_FIX.lng) < 0.0002 &&
          rider.presence.boardName === undefined,
      ),
    )
  }

  async verifyLeft() {
    await this.wait(
      'phone left relay roster',
      () => this.roster.length === 1 && this.roster[0].id === PEER_ID,
    )
  }

  close() {
    clearInterval(this.timer)
    this.socket.close()
  }
}
