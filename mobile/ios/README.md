# 旅帳 TripTab iOS

SwiftUI iOS app for the existing site at **https://trip-tap.kuanlin.online**. The main screen is a persistent `WKWebView` so its `dongda_session` cookie stays with the existing web app. This is an iOS native project source, not a built or signed IPA.

## Prepare and build on a Mac

1. Install Xcode 16 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen). From this directory, run `xcodegen generate`; open the generated `TripTab.xcodeproj` in Xcode. Xcode resolves the [LINE SDK for iOS Swift](https://developers.line.biz/en/docs/line-login-sdks/ios-sdk/swift/setting-up-project/) package.
2. Confirm the final iOS bundle ID `pro.kuanlin.triptab` before first distribution. Configure that exact ID in the LINE Developers Console and in Apple Developer. In Xcode Build Settings, set `TRIPTAB_LINE_CHANNEL_ID` to the LINE Login channel ID for both Debug and Release. The channel ID must match the server's `LINE_IOS_CHANNEL_ID` (or `LINE_CHANNEL_ID` fallback). Never put a LINE channel secret in the app.
3. Set the Apple Development Team and enable Associated Domains for this target. The entitlement already names `applinks:trip-tap.kuanlin.online`. Build and run on an iPhone for LINE app switching and incoming link tests.

The native LINE callback scheme is generated as `line3rdp.$(PRODUCT_BUNDLE_IDENTIFIER)`; for this bundle ID it is `line3rdp.pro.kuanlin.triptab`. The app uses the SDK's custom scheme callback. It does not claim the site's web OAuth callback URL. [LINE's setup guide](https://developers.line.biz/en/docs/line-login-sdks/ios-sdk/swift/setting-up-project/) requires this scheme and `lineauth2` in `LSApplicationQueriesSchemes`.

## Login and links

When the site navigates to `/api/auth/line?returnTo=...`, the app intercepts the main-frame navigation and requests a same-origin, one-time nonce via `POST /api/auth/line/native/challenge`. It passes that nonce to the LINE SDK with `.profile` and `.openID`. After LINE returns, the app sends the raw ID token via same-origin `POST /api/auth/line/native`. The server verifies the token and nonce, then sets the existing HttpOnly `dongda_session` cookie in the `WKWebView` store. Both calls send `x-triptab-native: 1`. The ID token is passed as a JavaScript argument to an isolated content world, with no URL parameter or app log. The server response provides the return path; the app only accepts `/app` or `/invite/:token`.

Invitations use Universal Links on the **same** site origin. The app only routes `https://trip-tap.kuanlin.online/invite/:token` into the WebView; the web app performs the actual group join. The server route `/.well-known/apple-app-site-association` returns 404 until `APPLE_TEAM_ID` is set to the real 10-character Apple Team ID. After configuration and deployment, confirm `https://trip-tap.kuanlin.online/.well-known/apple-app-site-association` responds directly over HTTPS with `application/json` content type and this shape:

```json
{
  "applinks": {
    "apps": [],
    "details": [{
      "appIDs": ["TEAM_ID.pro.kuanlin.triptab"],
      "components": [{"/": "/invite/*"}]
    }]
  }
}
```

The `TEAM_ID` above is illustrative; the route generates the actual `appIDs` value from `APPLE_TEAM_ID` and the configured bundle ID. The exact domain, bundle ID and Team ID must match the signed app. No placeholder association is served.

## Device checks

- Fresh install: `/app` opens; LINE login sets the web session and survives app restart.
- Tap an invitation in LINE on a signed-out device: native app opens, LINE login completes, and the invite is joined by the web flow.
- Tap an invitation while signed in: the same group join opens without another login.
- Cancel LINE login, then retry. Check logout and a second login.
- Open an external HTTPS link, lose connectivity, retry, and enter an expense with the keyboard shown.

This Windows workspace has no Xcode, macOS simulator, Apple signing identity, configured LINE iOS channel ID, or iPhone. Source and assets can be checked here; compilation, signed installation, LINE callback, cookie exchange and Universal Links require a Mac and real device. Apple's [Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains) and [Universal Links](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app) documentation cover the remaining domain setup.
