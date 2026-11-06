import Foundation

enum TripTabConfiguration {
    static let origin = URL(string: "https://trip-tap.kuanlin.online")!
    static let startURL = URL(string: "https://trip-tap.kuanlin.online/app")!

    static var lineChannelID: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "TripTabLineChannelID") as? String,
              !value.isEmpty,
              value.allSatisfy({ "0123456789".contains($0) }) else { return nil }
        return value
    }

    static func isSameOrigin(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" &&
        url.host?.lowercased() == origin.host &&
        url.port == nil && url.user == nil && url.password == nil
    }

    static func returnPath(_ value: String?) -> String {
        guard let value else { return "/app" }
        if value == "/app" { return value }
        return isInvitePath(value) ? value : "/app"
    }

    static func isInvitePath(_ path: String) -> Bool {
        path.range(
            of: #"^/invite/[A-Za-z0-9_-]{16,128}/?$"#,
            options: .regularExpression
        ) != nil
    }

    static func inviteURL(_ url: URL) -> URL? {
        guard isSameOrigin(url), isInvitePath(url.path),
              url.query == nil, url.fragment == nil else { return nil }
        return url
    }

    static func destination(for path: String) -> URL {
        URL(string: returnPath(path), relativeTo: origin)!.absoluteURL
    }
}
