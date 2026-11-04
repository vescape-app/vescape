/**
 * What a signed-out rider tried to do. Each needs the Device Token: Map Point writes are
 * account-owned, and search and Directions go through the server's map proxy.
 */
export type AccountGateReason = 'contribute' | 'search' | 'navigate' | 'details'

export const accountGateCopy: Record<AccountGateReason, { title: string; message: string }> = {
  details: {
    title: 'Sign in to see details',
    message: 'Addresses for places on the map need a Vescape account.',
  },
  contribute: {
    title: 'Sign in to contribute',
    message:
      'A Vescape account is required to add, edit, delete, or react to map features. Map features are shared with other riders.',
  },
  search: {
    title: 'Sign in to search',
    message: 'Place search needs a Vescape account. Sign in to find places on the map.',
  },
  navigate: {
    title: 'Sign in to navigate',
    message: 'Navigation needs a Vescape account. Sign in to get a route to this place.',
  },
}
