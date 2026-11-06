import LineSDK
import SwiftUI
import UIKit

@main
struct TripTabApp: App {
    @UIApplicationDelegateAdaptor(TripTabAppDelegate.self) private var appDelegate
    @StateObject private var browser = TripTabBrowser()

    var body: some Scene {
        WindowGroup {
            TripTabBrowserScreen(browser: browser)
                .onOpenURL { url in
                    if TripTabConfiguration.inviteURL(url) != nil {
                        browser.openInviteLink(url)
                    } else if url.scheme == "line3rdp.\(Bundle.main.bundleIdentifier ?? "")" {
                        // LINE's custom-scheme callback returns here after native authorization.
                        _ = LoginManager.shared.application(UIApplication.shared, open: url)
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    browser.openInviteLink(url)
                }
        }
    }
}

final class TripTabAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        if let channelID = TripTabConfiguration.lineChannelID {
            LoginManager.shared.setup(channelID: channelID, universalLinkURL: nil)
        }
        return true
    }
}
