import AuthenticationServices
import CryptoKit
import SwiftUI

struct SignInView: View {
    @Environment(Session.self) private var session
    @Environment(AccountSync.self) private var accountSync

    @State private var email = ""
    @State private var password = ""
    @State private var creating = false
    @State private var busy = false

    var body: some View {
        VStack(spacing: 20) {
            Image("Logo")
                .resizable()
                .frame(width: 160, height: 160)
                .padding(.bottom, -12)
                .accessibilityHidden(true)
            form
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task { await session.loadMethods() }
    }

    private var form: some View {
        VStack(spacing: 16) {
            Text("ProcrastiMate")
                .font(.title2.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)
            if session.methods.email {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(.ink.opacity(0.05), in: .rect(cornerRadius: 16))
                SecureField("Password", text: $password)
                    .textContentType(creating ? .newPassword : .password)
                    .padding(12)
                    .background(.ink.opacity(0.05), in: .rect(cornerRadius: 16))
                Button(creating ? "Create account" : "Sign in") { Task { await submit() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(busy || email.isEmpty || password.count < 8)
                Button(creating ? "Already have an account" : "Create an account") { creating.toggle() }
                    .font(.footnote)
                    .foregroundStyle(.muted)
            }
            if let clientId = session.methods.googleIosClientId {
                Button("Sign in with Google") { Task { await google(clientId) } }
                    .buttonStyle(.bordered)
            }
            if session.methods.appleNative {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    switch result {
                    case let .success(authorization):
                        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                              let tokenData = credential.identityToken,
                              let token = String(data: tokenData, encoding: .utf8) else { return }
                        Task { await finish { await session.signIn(provider: "apple", idToken: token) } }
                    case let .failure(error):
                        if (error as? ASAuthorizationError)?.code == .canceled { return }
                        session.error = ErrorReport("Could not sign in with Apple", error: error)
                    }
                }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 44)
            }
            if let error = session.error {
                ErrorText(report: error).font(.footnote)
            }
        }
        .padding(24)
        .frame(maxWidth: 420)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
    }

    private func submit() async {
        await finish {
            if creating { await session.signUp(email: email, password: password) }
            else { await session.signIn(email: email, password: password) }
        }
    }

    private func google(_ clientId: String) async {
        await finish {
            do {
                let token = try await GoogleNativeSignIn.signIn(clientId: clientId)
                await session.signIn(provider: "google", idToken: token)
            } catch is CancellationError {
                return
            } catch {
                session.error = ErrorReport("Could not sign in with Google", error: error)
            }
        }
    }

    private func finish(_ work: () async -> Void) async {
        busy = true
        await work()
        if session.signedIn { accountSync.start() }
        busy = false
    }
}

/// Google's installed-app flow: an auth code with PKCE, exchanged for an ID token, with no client secret.
enum GoogleNativeSignIn {
    static func signIn(clientId: String) async throws -> String {
        let verifier = random(32)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
        let scheme = reversedScheme(clientId)
        let redirect = "\(scheme):/oauth2redirect"
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirect),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        guard let url = components.url else { throw URLError(.badURL) }
        let callback = try await WebAuthenticator.authenticate(url: url, scheme: scheme)
        guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value else { throw URLError(.badServerResponse) }
        return try await exchange(code: code, verifier: verifier, clientId: clientId, redirect: redirect)
    }

    /// `123-abc.apps.googleusercontent.com` becomes `com.googleusercontent.apps.123-abc`.
    static func reversedScheme(_ clientId: String) -> String {
        let suffix = ".apps.googleusercontent.com"
        guard clientId.hasSuffix(suffix) else { return "com.stefan.procrastimate" }
        return "com.googleusercontent.apps.\(clientId.dropLast(suffix.count))"
    }

    private static func exchange(code: String, verifier: String, clientId: String, redirect: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let fields = [
            "code": code,
            "client_id": clientId,
            "redirect_uri": redirect,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        ]
        request.httpBody = fields.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["id_token"] as? String else { throw URLError(.badServerResponse) }
        return token
    }

    private static func random(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

@MainActor
private enum WebAuthenticator {
    private static var session: ASWebAuthenticationSession?
    private static let presenter = Presenter()

    static func authenticate(url: URL, scheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                self.session = nil
                if let callback {
                    continuation.resume(returning: callback)
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    continuation.resume(throwing: CancellationError())
                } else {
                    continuation.resume(throwing: error ?? URLError(.cancelled))
                }
            }
            session.presentationContextProvider = presenter
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() { continuation.resume(throwing: URLError(.unknown)) }
        }
    }
}

private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
    }
}
