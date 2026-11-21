package expo.modules.vescapecore.alerts

/**
 * File name of a My sound's audio: `<uuid>.<wav|m4a|mp3>`.
 * Shared by the audio library and backup codec without Android media dependencies.
 *
 * @parity /modules/vescape-core/ios/alerts/MySounds.swift `isFileName`
 */
internal val mySoundFileName = Regex("[0-9a-fA-F-]{36}\\.(wav|m4a|mp3)")
