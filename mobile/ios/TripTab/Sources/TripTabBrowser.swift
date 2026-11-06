import LineSDK
import SwiftUI
import UIKit
import WebKit

@MainActor
final class TripTabBrowser: NSObject, ObservableObject, WKNavigationDelegate {
    @Published var isLoggingIn = false
    @Published var hasLoadError = false
    @Published var loginError: String?

    let webView: WKWebView
    private var pendingInviteURL: URL?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // Persist the site's session cookie.
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.load(URLRequest(url: TripTabConfiguration.startURL))
    }

    func reload() {
        hasLoadError = false
        webView.load(URLRequest(url: webView.url ?? TripTabConfiguration.startURL))
    }

    func openInviteLink(_ url: URL) {
        guard let inviteURL = TripTabConfiguration.inviteURL(url) else { return }
        if isLoggingIn {
            pendingInviteURL = inviteURL
        } else {
            hasLoadError = false
            webView.load(URLRequest(url: inviteURL))
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if TripTabConfiguration.isSameOrigin(url) {
            if url.path == "/api/auth/line", navigationAction.targetFrame?.isMainFrame != false {
                decisionHandler(.cancel)
                let returnTo = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "returnTo" })?.value
                beginLineLogin(returnTo: TripTabConfiguration.returnPath(returnTo))
                return
            }
            decisionHandler(.allow)
            return
        }
        if url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if ["https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadError = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadErrorIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadErrorIfNeeded(error)
    }

    private func showLoadErrorIfNeeded(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        hasLoadError = true
    }

    private func beginLineLogin(returnTo: String) {
        guard !isLoggingIn else { return }
        guard TripTabConfiguration.lineChannelID != nil else {
            loginError = "此 App 尚未設定 LINE 登入頻道。"
            return
        }
        isLoggingIn = true
        Task {
            do {
                let nonce = try await requestNonce(returnTo: returnTo)
                var parameters = LoginManager.Parameters()
                parameters.IDTokenNonce = nonce
                let process = LoginManager.shared.login(
                    permissions: [.profile, .openID],
                    parameters: parameters
                ) { [weak self] result in
                    Task { @MainActor [weak self] in
                        self?.handleLineResult(result)
                    }
                }
                if process == nil {
                    finishLogin(error: "LINE 登入無法啟動，請重試。")
                }
            } catch {
                finishLogin(error: "無法開始 LINE 登入，請稍後再試。")
            }
        }
    }

    private func handleLineResult(_ result: Result<LoginResult, LineSDKError>) {
        switch result {
        case .success(let loginResult):
            guard let idToken = loginResult.accessToken.IDTokenRaw else {
                finishLogin(error: "LINE 未提供登入憑證，請重試。")
                return
            }
            Task {
                do {
                    let path = try await exchangeSession(idToken: idToken)
                    isLoggingIn = false
                    hasLoadError = false
                    let destination = pendingInviteURL ?? TripTabConfiguration.destination(for: path)
                    pendingInviteURL = nil
                    webView.load(URLRequest(url: destination))
                } catch {
                    finishLogin(error: "登入驗證失敗，請重試。")
                }
            }
        case .failure:
            finishLogin(error: "LINE 登入未完成，請重試。")
        }
    }

    private func finishLogin(error message: String) {
        isLoggingIn = false
        pendingInviteURL = nil
        loginError = message
    }

    private func requestNonce(returnTo: String) async throws -> String {
        let result = try await webView.callAsyncJavaScript(
            Self.challengeScript,
            arguments: ["returnTo": returnTo],
            in: nil,
            contentWorld: .defaultClient
        )
        guard let nonce = result as? String,
              nonce.range(of: #"^[A-Za-z0-9_-]{24,128}$"#, options: .regularExpression) != nil else {
            throw TripTabLoginError.invalidResponse
        }
        return nonce
    }

    private func exchangeSession(idToken: String) async throws -> String {
        let result = try await webView.callAsyncJavaScript(
            Self.sessionScript,
            arguments: ["idToken": idToken],
            in: nil,
            contentWorld: .defaultClient
        )
        guard let path = result as? String else { throw TripTabLoginError.invalidResponse }
        return TripTabConfiguration.returnPath(path)
    }

    private enum TripTabLoginError: Error { case invalidResponse }

    // Arguments are passed separately: the ID token never enters a URL or an interpolated script.
    private static let challengeScript = """
        const response = await fetch('/api/auth/line/native/challenge', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'content-type': 'application/json', 'x-triptab-native': '1'},
          body: JSON.stringify({returnTo})
        });
        if (!response.ok) throw new Error('native challenge failed');
        return (await response.json()).nonce;
        """

    private static let sessionScript = """
        const response = await fetch('/api/auth/line/native', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'content-type': 'application/json', 'x-triptab-native': '1'},
          body: JSON.stringify({idToken})
        });
        if (!response.ok) throw new Error('native login failed');
        return (await response.json()).returnTo;
        """
}
