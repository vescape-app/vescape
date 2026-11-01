import { expect, test } from 'bun:test'
import { publicRideMapRiderId } from '@/modules/group-ride/components/public-ride-prototype/fixtures'
import { publicRideMapCoordinates } from './publicRideMapFraming'

const riders = [
  { id: publicRideMapRiderId('ola'), presence: { lng: 19, lat: 50 } },
  { id: publicRideMapRiderId('kuba'), presence: { lng: 20, lat: 51 } },
]
const self = { longitude: 18.9, latitude: 49.9 }

test('profile framing contains the selected rider and our position, excluding other riders', () => {
  expect(publicRideMapCoordinates({ riderIds: ['ola'], includeSelf: true }, riders, self)).toEqual([
    [19, 50],
    [18.9, 49.9],
  ])
})

test('profile framing waits for both positions instead of framing just one person', () => {
  const request = { riderIds: ['ola'], includeSelf: true }
  expect(publicRideMapCoordinates(request, riders, null)).toBeNull()
  expect(publicRideMapCoordinates(request, [], self)).toBeNull()
  expect(publicRideMapCoordinates(request, riders, { longitude: NaN, latitude: 50 })).toBeNull()
})

test('list framing uses the whole selected list and does not require our GPS position', () => {
  expect(
    publicRideMapCoordinates({ riderIds: ['ola', 'kuba'], includeSelf: false }, riders, null),
  ).toEqual([
    [19, 50],
    [20, 51],
  ])
  expect(
    publicRideMapCoordinates({ riderIds: ['ola', 'missing'], includeSelf: false }, riders, self),
  ).toBeNull()
})
