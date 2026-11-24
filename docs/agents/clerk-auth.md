# Clerk authentication

Vescape uses Clerk's production instance for native Android authentication. The Expo app renders
Clerk's native authentication UI and stores its session with `expo-secure-store`.

## Secret handling

Never put Clerk keys, session tokens, verification URLs, email addresses, IP addresses, user IDs,
trace IDs, or dashboard exports in this repository, issues, logs, screenshots, or chat messages.

- Keep `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in the local or deployment environment.
- A publishable key is client-facing configuration, but still keep its value out of documentation
  and commits so environments cannot be confused accidentally.
- Secret keys belong only in the server or deployment secret store. They must never use an
  `EXPO_PUBLIC_` name or enter the mobile bundle.
- Redact query strings before sharing email-link URLs. They contain short-lived verification data.
- When sharing Android logs, replace personal and instance identifiers with placeholders.

`.env.example` contains variable names only. Real environment files must remain gitignored.

## Durable app configuration

The integration is owned by these durable files:

- `app.config.ts` enables the Clerk and SecureStore Expo plugins.
- `src/app/_layout.tsx` creates `ClerkProvider` with the publishable key and Clerk token cache.
- `src/modules/profile/screens/ClerkAuthScreen.tsx` renders the native `AuthView`.
- `src/modules/profile/screens/ClerkAccountScreen.tsx` owns sign-out and account deletion teardown.
- `src/modules/profile/components/DeviceAuthSync.tsx` exchanges the active Clerk session once and
  provisions native Device Token storage.
- `src/modules/profile/components/AccountWidget.tsx` exposes sign-in and account management in the
  Social sheet.
- `modules/vescape-core/{android,ios}/auth/` owns Device Token storage and authenticated native
  requests. Android encrypts with an Android Keystore key. iOS uses Keychain accessibility
  `AfterFirstUnlockThisDeviceOnly`, so long-lived native work can read it while the screen is locked.

Device Tokens are bound to the server origin they were minted for (a token for one origin is never
sent to another) and are never exposed back to JS after provisioning. Native App Status attaches the
credential, persists renewed expiry, and changes the credential state to `rejected` for expired or
revoked tokens. A `401` from a native request using `AuthMode.Required` with the stored token does
the same without retrying; optional-auth requests and explicit bearer provisioning calls do not
reject the stored credential.

Both teardowns turn off every Account feature on the phone before anything leaves Clerk or the
server: the Device Token is gone locally before Clerk sign-out and before the account deletion
request. Both run in `ClerkAccountScreen` through `src/modules/profile/lib/accountTeardown.ts`.
Suspending `DeviceAuthSync` (`src/modules/profile/lib/deviceProvisioning.ts`) blocks new exchanges,
invalidates any exchange still in flight so its Device Token is never installed, and waits only for
a native install already running, so nothing reinstalls a credential after the local clear. Clearing
the credential fires the credential change listeners, which stop Public Ride sharing and Rider Month
Stats sending on both platforms; native requests that require a Device Token stop. Resuming
provisioning forgets which Clerk sessions already exchanged, so the same session can exchange a
fresh Device Token and the features come back; Public Ride sharing stays off until the rider turns
it on again, because credential loss resets it on both platforms. An exchange abandoned by a
teardown settles as suspended and never touches the state of the exchange that replaced it.

Sign-out ordering is security-sensitive:

```text
suspend DeviceAuthSync -> native revoke (server revoke, then native clear) -> Clerk sign-out
```

If revocation or Clerk sign-out fails, the app resumes provisioning and the rider can retry. A failed
revocation retains the credential. Never clear Clerk first: that would strand a live Device Token the
client can no longer revoke.

Account deletion ordering:

```text
(iOS Sign in with Apple only: requestAppleAuthorizationCode) -> suspend DeviceAuthSync -> native clear -> DELETE /api/account (Clerk token + optional appleAuthorizationCode) -> reset Rider Profile -> Clerk sign-out
```

When an iOS rider has a connected Apple account, the app prompts native Sign in with Apple once before clearing credentials to obtain a fresh single-use `authorizationCode` (cancelling aborts deletion cleanly). `vescape-server` exchanges and revokes it against Apple's `/auth/token` and `/auth/revoke` endpoints (App Store Guideline 5.1.1(v)) before fencing and deleting the Account.

The local clear uses `clearDeviceCredential`, not revoke: the server revokes every Device Token as
part of the deletion. If the local clear fails, the request is never sent; provisioning resumes and
the rider can retry. `200` (deleted) and `202` (queued for background Clerk deletion) both count as
accepted; anything else resumes provisioning, so `DeviceAuthSync` exchanges a fresh Device Token,
and lets the rider retry. If Clerk sign-out fails after acceptance, the screen keeps provisioning
suspended and offers **Finish signing out**, which retries only the local clean-up, never the server
request. Provisioning resumes when Clerk reports signed out. A failed Device Token exchange still
routes the account pill to the account screen, so Online-Blocked builds keep Sign out and Delete
account reachable.
`DELETE /api/account` is exempt from Online Block so outdated builds can still delete accounts.
Deleting a Vescape Account never touches local phone data.

Do not fix Clerk integration in generated `android/` or `ios/` folders. Plugin or dependency changes
require a fresh native sync/build through `bun run android`.

## Native theme

Clerk's native views are themed by the checked-in `clerk-theme.json` at the repo root, wired through
the `@clerk/expo` config plugin's `theme` option in `app.config.ts`. The file mirrors the Vescape
palette from `src/constants/theme.ts` (slate surfaces, cyan brand accent, semantic status colors,
12dp corners) and sets `colors` and `darkColors` to the same values so the views are always dark.

- The plugin consumes the JSON during prebuild — Android gets `assets/clerk_theme.json`, iOS gets a
  `ClerkTheme` Info.plist entry. Theme changes require a regenerated native build via
  `bun run android`; Metro reload alone is not enough.
- Clerk's native views use the system font. Do not patch generated native code to force Raleway.
- Both Clerk routes hide the Expo header (`src/app/_layout.tsx`); the Clerk views render their own
  single back/dismiss control (`isDismissible`) and route dismissal back into Expo Router.

## Hosted Account Portal branding

Clerk's production Account Portal owns the browser page that completes an email-link verification
and offers **Return to app**. Its dashboard configuration should stay aligned with the native theme:

- Application name: `Vescape`
- Logo: `assets/images/splashIcon.png`
- Appearance: `Dark`
- Dark primary color: `#06B6D4`
- Dark background color: `#111827`

The Account Portal dashboard currently exposes only appearance plus primary and background colors
for each color mode. It does not expose completion-page-specific copy, typography, or layout. The
application name and logo are shared across Clerk-hosted components. Removing **Secured by Clerk**
is a Pro-plan setting and is not required for the mobile callback flow.

## Production domains and DNS

The production application domain is `vescape.app`. Clerk uses public subdomains for its account,
frontend API, DKIM, and mail records. Treat the Clerk dashboard's DNS page as the source of truth for
the complete current targets; instance-specific target values must not be copied into this document.

Expected record names include:

- `accounts.vescape.app`
- `clerk.vescape.app`
- `clk._domainkey.vescape.app`
- `clk2._domainkey.vescape.app`
- `clkmail.vescape.app`

All are CNAME records. Targets must match the Clerk dashboard exactly. If the DNS provider supports
proxying, keep Clerk CNAMEs DNS-only. After any change, save the records and run Clerk verification
again.

Useful read-only checks:

```sh
dig +short NS vescape.app
dig +short CNAME accounts.vescape.app
dig +short CNAME clerk.vescape.app
dig +short CNAME clk._domainkey.vescape.app
dig +short CNAME clk2._domainkey.vescape.app
dig +short CNAME clkmail.vescape.app
```

DNS answers and Clerk service hostnames are public, but do not paste dashboard credentials or
authenticated dashboard responses into debugging notes.

## Android email-link flow

1. `AuthView` asks Clerk to send a sign-in or sign-up email.
2. The user opens the newest email link on the same Android device.
3. Clerk verifies the one-time link in the browser.
4. The browser's **Return to app** action opens Clerk's Android callback activity.
5. Clerk activates the native session and synchronizes it to `ClerkProvider`.
6. `ClerkAuthScreen` handles the native completion callback or observes an active session, then
   leaves the authentication screen.

Email links expire and are single-use. Always request a fresh link for another attempt, and do not
diagnose a reused link as a new failure.

The native callback scheme and activity are generated by Clerk. Do not replace them with a web route
or add a `.web.tsx` screen: the mobile app is React Native only, while web behavior belongs in the
server repository.

## Debugging

First separate the browser, native callback, session synchronization, and development runtime. They
can fail independently.

### Browser reports an error

- Confirm the email is fresh and the link has not already been consumed.
- Check Clerk Application Logs at the matching time without copying personal identifiers.
- If an `origin_invalid` response appears, note whether Clerk produced an application event. No
  matching event means the request was rejected before the app callback.
- Retry once with a fresh link in the system browser to distinguish a browser context problem.
- Recheck production DNS from the command line and in the Clerk dashboard.

### Browser succeeds but app stays on “Check your email”

- Confirm Android received the Clerk callback activity.
- Confirm `AuthView` still has its completion handler and `ClerkAuthScreen` observes an active
  session.
- Check that `ClerkProvider` uses Clerk's SecureStore-backed `tokenCache`.
- In a development build, verify Metro is still reachable after the app returns from the browser.
  Losing Metro can remount the JavaScript app and look like a crash even when Android recorded no
  fatal exception.

Useful sanitized checks:

```sh
adb shell pidof app.vescape
adb logcat -d -v threadtime | rg -i 'clerk|callback|session|fatal exception|ReactNativeJS'
adb reverse --list
lsof -nP -iTCP:8081 -sTCP:LISTEN
```

Before sharing output, remove verification URLs, tokens, emails, IPs, IDs, and query strings.

### App appears to restart

Look for `FATAL EXCEPTION` scoped to `app.vescape`. If none exists, check Metro connectivity and
process lifecycle before calling it a crash. Production builds do not depend on Metro, so reproduce
the problem in a release build before treating a development-server disconnect as a production bug.

## Production verification

- Inject the production `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` through the deployment environment.
- Confirm no Clerk secret key is present in Expo configuration or the generated mobile bundle.
- Build Android from durable config with `bun run android` or the release workflow.
- Install the release build on a clean device or clean app-data state.
- Request one fresh email link, open it once, return to the app, and confirm the account screen shows
  the signed-in user.
- Kill and reopen the app to confirm the session persists.
- Sign out and confirm protected account UI is no longer available.

## Map contribution identity

Map Points are server-owned. The app never sends a Clerk id with them: native attaches the Device
Token provisioned above, and the server resolves the Account from it. Reading Map Points needs no
credential; adding, editing, deleting and reacting reject with `MAP_POINT_SIGN_IN_REQUIRED` when no
Device Token is stored.
