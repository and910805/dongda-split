# TripTab Android app

This directory is a Bubblewrap 1.27.0 Trusted Web Activity (TWA) project. It opens the existing TripTab site at `https://trip-tap.kuanlin.online/app`; incoming links for the same host, including `/invite/:token`, are handled by the launcher activity. The Android package ID is currently `pro.kuanlin.triptab`. Confirm it before the first Play release because a published package ID cannot be changed in place.

TWA renders the site in the device's supported browser. This preserves the browser's same-origin cookie for the existing LINE Login callback and ledger API. The fallback is a Custom Tab, **not** a separate WebView session. No production database, DNS, OAuth secret, or session code is copied into the APK.

## Debug build

The [Android app debug build workflow](../../.github/workflows/android-app.yml) runs on pull requests that touch this project and can also be started manually. Its `triptab-android-debug` artifact contains an installable debug APK. The runner creates its own debug signing key, so that APK is for testing only. On a machine with JDK 17 and Android SDK API 36 / Build Tools 36.0.0:

```sh
cd mobile/android
./gradlew :app:assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. This Windows workspace has no Android SDK or connected device, so the checked-in source has not yet been compiled or tested on a phone.

## Site association and release

1. Deploy the web manifest and icons from `public/` at the **same** HTTPS origin, then confirm `https://trip-tap.kuanlin.online/manifest.webmanifest` is publicly served. Keep the server's `APP_URL`, LINE Login registered callback, and Android host on that origin.
2. Choose the final package ID and create a release signing key outside the repository. Never commit the keystore or passwords. Use Bubblewrap's signed build or your release signing setup.
3. Obtain the SHA-256 certificate fingerprint of the **Play App Signing certificate** if Play will re-sign the app. Otherwise use the certificate that actually signs the installed APK. Publish this JSON at `https://trip-tap.kuanlin.online/.well-known/assetlinks.json`, replacing the fingerprint:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "pro.kuanlin.triptab",
       "sha256_cert_fingerprints": ["AA:BB:CC:...:FF"]
     }
   }]
   ```

   Replace the example with the full colon-separated certificate fingerprint; the JSON value must not include a `SHA-256:` prefix.
4. On an Android device, verify the app opens without a browser toolbar. If Digital Asset Links verification fails, Android opens a Custom Tab with a toolbar. Do not treat that as a verified TWA release.
5. Test a fresh LINE sign-in, sign-out and sign-in again, a shared `/invite/:token` link from LINE, closing and reopening the app, and the three-step expense entry with the keyboard open. These require a real device and a valid LINE Login configuration.

The current source deliberately has no `assetlinks.json` under `public/`: a placeholder fingerprint would advertise a broken association. The release signer or Play signing certificate must be known first.

Sources: [Android TWA overview](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities), [Android TWA quick start](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2), [Bubblewrap CLI](https://github.com/GoogleChromeLabs/bubblewrap/tree/main/packages/cli).
