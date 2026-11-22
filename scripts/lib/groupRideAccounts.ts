export interface E2eAccount {
  id: string
  token: string
  nick: string
}

export const PHONE_ACCOUNT: E2eAccount = {
  id: '00000000-0000-4000-8000-0000000000e1',
  token: 'e2e-phone-device-token',
  nick: 'E2E',
}

export const PEER_ACCOUNT: E2eAccount = {
  id: '00000000-0000-4000-8000-0000000000e2',
  token: 'e2e-peer-device-token',
  nick: 'Peer',
}

export const E2E_ACCOUNTS = [PHONE_ACCOUNT, PEER_ACCOUNT]
