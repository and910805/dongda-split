import SwiftUI
import WebKit

struct TripTabBrowserScreen: View {
    @ObservedObject var browser: TripTabBrowser

    var body: some View {
        ZStack {
            Color(red: 0.984, green: 0.973, blue: 0.945).ignoresSafeArea()
            TripTabWebView(browser: browser)

            if browser.isLoggingIn {
                Color.black.opacity(0.25).ignoresSafeArea()
                VStack(spacing: 14) {
                    ProgressView()
                        .controlSize(.large)
                    Text("正在使用 LINE 登入")
                        .font(.headline)
                }
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
                .accessibilityElement(children: .combine)
            }

            if browser.hasLoadError {
                VStack(spacing: 18) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 42))
                        .foregroundStyle(.green)
                    Text("無法開啟旅帳")
                        .font(.title3.bold())
                    Text("請確認網路連線，然後再試一次。")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("重新載入") { browser.reload() }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.12, green: 0.62, blue: 0.41))
                }
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.984, green: 0.973, blue: 0.945))
            }
        }
        .alert("無法登入", isPresented: Binding(
            get: { browser.loginError != nil },
            set: { if !$0 { browser.loginError = nil } }
        )) {
            Button("關閉", role: .cancel) { browser.loginError = nil }
        } message: {
            Text(browser.loginError ?? "請稍後再試。")
        }
    }
}

private struct TripTabWebView: UIViewRepresentable {
    @ObservedObject var browser: TripTabBrowser

    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
