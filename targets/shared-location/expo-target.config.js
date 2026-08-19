/**
 * Share extension that makes Vescape a destination in the iOS share sheet for locations. iOS has
 * no equivalent of Android's share intent reaching the app directly, so the extension is the only
 * way in; it does no work of its own beyond handing the payload to the app.
 *
 * @type {import('@bacons/apple-targets').Config}
 */
module.exports = {
  type: 'share',
  name: 'SharedLocation',
  deploymentTarget: '17.0',
}
