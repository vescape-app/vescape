import { PEER_ACCOUNT, PHONE_ACCOUNT } from './groupRideAccounts.ts'

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
interface PublicRider {
  accountId: string
  nick: string
  presence: { lat: number; lng: number; boardName?: string } | null
  stale: boolean
  away: boolean
}
interface Pin {
  kind: string
}
interface Pins {
  signal?: Pin
  hazard?: Pin
}
interface Message {
  type: string
  on?: boolean
  riders?: PublicRider[]
  rider?: PublicRider
  accountId?: string
  signal?: Pin
  hazard?: Pin
  message?: string
}
export const PHONE_FIX = { lat: 51.131, lng: 16.987 }
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
  private public = false
  private riders = new Map<string, PublicRider>()
  private pins = new Map<string, Pins>()
  readonly transcript: { direction: string; message: unknown }[] = []

  constructor(url: string, version: string) {
    const Socket = WebSocket as unknown as new (
      url: string,
      options: Bun.WebSocketOptions,
    ) => WebSocket
    this.socket = new Socket(url, {
      headers: {
        'Vescape-App-Version': version,
        Authorization: `Bearer ${PEER_ACCOUNT.token}`,
      },
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message
      this.transcript.push({ direction: 'received', message })
      this.receive(message)
    })
    this.socket.addEventListener('error', () => {
      this.error = new Error('Peer WebSocket failed')
    })
    this.socket.addEventListener('close', () => {
      this.error = new Error('Peer WebSocket closed')
    })
  }

  private receive(message: Message) {
    switch (message.type) {
      case 'error':
        this.error = new Error(`Relay: ${message.message}`)
        return
      case 'public-status':
        this.public = message.on === true
        return
      case 'nearby-riders':
        this.riders = new Map((message.riders ?? []).map((rider) => [rider.accountId, rider]))
        return
      case 'public-rider':
        if (message.rider) this.riders.set(message.rider.accountId, message.rider)
        return
      case 'public-rider-gone':
        if (message.accountId) this.riders.delete(message.accountId)
        return
      case 'public-pins':
        if (message.accountId)
          this.pins.set(message.accountId, { signal: message.signal, hazard: message.hazard })
    }
  }

  private send(message: unknown) {
    this.transcript.push({ direction: 'sent', message })
    this.socket.send(JSON.stringify(message))
  }

  private sendPosition() {
    this.send({ type: 'public-position', at: Date.now(), presence: this.presence })
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
    this.send({ type: 'public-on' })
    await this.wait('peer is public', () => this.public)
    this.sendPosition()
    this.timer = setInterval(() => this.sendPosition(), 1000)
  }

  update() {
    this.presence = {
      ...this.presence,
      lat: PHONE_FIX.lat + 0.003,
      speed: 8,
      soc: 0.23,
      boardName: 'E2E Board Beta',
    }
    this.sendPosition()
  }

  raiseSignal(kind: string) {
    this.send({ type: 'public-signal', kind, lat: this.presence.lat, lng: this.presence.lng })
  }

  clearSignal() {
    this.send({ type: 'public-signal-clear' })
  }

  async stop() {
    clearInterval(this.timer)
    this.send({ type: 'public-off' })
    await this.wait('peer stopped riding public', () => !this.public)
  }

  async verifyPhone() {
    await this.wait('phone shares native GPS presence publicly', () => {
      const phone = this.riders.get(PHONE_ACCOUNT.id)
      return (
        phone !== undefined &&
        phone.nick === PHONE_ACCOUNT.nick &&
        !phone.stale &&
        phone.presence != null &&
        Math.abs(phone.presence.lat - PHONE_FIX.lat) < 0.0002 &&
        Math.abs(phone.presence.lng - PHONE_FIX.lng) < 0.0002 &&
        phone.presence.boardName === undefined
      )
    })
  }

  async verifyPhonePins(expected: { signal: string | null; hazard: string | null }) {
    await this.wait(`phone pins signal=${expected.signal} hazard=${expected.hazard}`, () => {
      const pins = this.pins.get(PHONE_ACCOUNT.id)
      return (
        (pins?.signal?.kind ?? null) === expected.signal &&
        (pins?.hazard?.kind ?? null) === expected.hazard
      )
    })
  }

  async verifyPhoneOff() {
    await this.wait('phone stopped riding public', () => !this.riders.has(PHONE_ACCOUNT.id))
  }

  close() {
    clearInterval(this.timer)
    this.socket.close()
  }
}
