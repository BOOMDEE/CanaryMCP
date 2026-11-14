# Android app

The Android app is a user-controlled collector. Every category starts disabled; there is no background polling or scheduled upload. The app reads and uploads the currently enabled snapshot only after the owner taps **Sync enabled data**.

| Category | Data | Permission and boundary |
| --- | --- | --- |
| Battery | Level, charging state, capture time | No runtime permission. |
| Location | Last-known coordinates, precision, source time | Android location permission plus a separate category toggle. Approximate mode rounds coordinates; precise location is separate. Turning precise mode off or revoking fine permission requests deletion of the old snapshot; a coarse snapshot is uploaded only after a later manual sync. No background permission or route history. |
| App usage | Up to 15 active packages, foreground duration, last-used time during the previous 24 hours | Owner must grant Usage Access in Android settings. Package names can be sensitive. |
| Accessibility snapshot | One target window, at most 100 nodes; node type, bounds, limited text/description, package name | Experimental and highly sensitive. Requires Android accessibility settings, app opt-in, and one manual capture arm. Expires after two minutes; password node text is skipped and no gestures are performed. Other screen text may still be sensitive, and store policies may restrict this use. |
| Device summary | Manufacturer/model, Android and app versions, SDK, locale, time zone | No IMEI, Android ID, serial number, or advertising ID. |
| Network state | Active transport, Internet/validated and metered status | Uses `ConnectivityManager` for a snapshot; does not read SSID, IP, MAC, routes, or browsing history. See the [Android network-state guide](https://developer.android.com/develop/connectivity/network-ops/reading-network-state). |
| Storage | Internal total and available bytes rounded down to 64 MiB, plus a low-space flag | No paths, file names, or file contents. |

## Revocation and deletion

Turning off a category requests deletion of its cloud snapshot. Turning off precise location first requests deletion of the previous precise snapshot; the app uploads an approximate replacement only after a later manual sync. If Android permissions are revoked, the app disables the affected category on resume and requests cloud deletion; an offline deletion may not complete immediately. **Delete all snapshots** removes cloud context and the local pending accessibility snapshot. Revoking the device deletes its context, tokens, webhook configuration, delivery history, and rate-limit records, then clears local Keystore credentials.

Only one latest snapshot per category is stored. The API/MCP stops returning a snapshot after seven days; a daily Worker cron physically removes expired rows.

## Credentials and build

The paired app keeps separate device-write and MCP-read tokens in Android Keystore. Local webhook URL/signing settings are also encrypted there. In D1, device tokens are stored as SHA-256 hashes and webhook configuration is AES-GCM encrypted by a separate Worker secret.

Open `Android/` in Android Studio with JDK 17 and SDK 35; minimum API is 26:

```bash
cd Android
./gradlew assembleDebug
./gradlew assembleRelease
```

Debug builds allow the emulator loopback URL `http://10.0.2.2:8787`; Release requires HTTPS. `assembleRelease` alone does not provide a production signing key or a distributable APK. The accessibility feature must be reviewed against the target distribution policies before release.
