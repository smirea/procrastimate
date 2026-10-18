import Core
import Foundation
import Observation

extension API.AuthMethods {
    /// Until the server answers, no sign-in button shows.
    static let none = Self(email: false, google: false, apple: false, googleIosClientId: nil, appleNative: false)
}

/// The signed-in user. A Keychain token means the app opens offline; a rejected token returns to sign-in.
@MainActor @Observable
final class Session {
    static let ownerKey = "procrastimate-owner"
    /// The owner's email and name, kept beside the id so an offline launch names them in Sentry.
    static let ownerEmailKey = "procrastimate-owner-email"
    static let ownerNameKey = "procrastimate-owner-name"

    private let sync: SyncClient
    var signedIn: Bool
    var error: ErrorReport?
    var methods = API.AuthMethods.none

    init(sync: SyncClient) {
        self.sync = sync
        let token = SessionToken.read()
        signedIn = token != nil || Launch.signedIn
        // The session check that confirms the user needs the network, so an offline launch names them from the last one.
        let defaults = UserDefaults.standard
        if token != nil, let owner = defaults.string(forKey: Self.ownerKey) {
            Telemetry.signedIn(
                owner, email: defaults.string(forKey: Self.ownerEmailKey), name: defaults.string(forKey: Self.ownerNameKey)
            )
        }
    }

    func start() async {
        // At launch too, so the shared item names the server this build talks to.
        if let token = SessionToken.read() { SharedSession.write(token: token) }
        await refresh()
        await loadMethods()
    }

    /// Only the server's own verdict ends the session: a `401`, or a session with no user. A network failure, a 5xx,
    /// or a captive portal's page keeps it, so an outage never shows sign-in.
    func refresh() async {
        guard let token = SessionToken.read() else {
            signedIn = Launch.signedIn
            return
        }
        // A background relaunch while the phone was locked could not read the token; now it can.
        signedIn = true
        var request = URLRequest(url: AppEnvironment.apiURL.appending(path: "api/auth/get-session"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await APIClient.session.data(for: request)
        } catch {
            return
        }
        guard let http = response as? HTTPURLResponse else { return }
        if http.statusCode == 401 {
            end()
            return
        }
        guard http.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        guard let user = object["user"] as? [String: Any], let id = user["id"] as? String else {
            end()
            return
        }
        await adopt(id, email: user["email"] as? String, name: user["name"] as? String)
    }

    /// Every way out of the account: the token goes, the sync stream stops, and sign-in shows.
    func end() {
        SessionToken.clear()
        sync.disconnect()
        signedIn = Launch.signedIn
    }

    /// Remembers who the local database belongs to. Anyone else starts from an empty one that sync fills, so nothing
    /// of the previous user's uploads into the new account.
    func adopt(_ id: String, email: String?, name: String?) async {
        await sync.adopt(id)
        SessionToken.remember(user: id)
        UserDefaults.standard.set(id, forKey: Self.ownerKey)
        UserDefaults.standard.set(email, forKey: Self.ownerEmailKey)
        UserDefaults.standard.set(name, forKey: Self.ownerNameKey)
        Telemetry.signedIn(id, email: email, name: name)
        signedIn = true
        error = nil
    }

    func loadMethods() async {
        do {
            methods = try await APIClient.send(API.Endpoints.AuthMethods.self, NoInput(), token: nil)
        } catch {
            let report = ErrorReport("Could not reach the server", error: error)
            if !signedIn { self.error = report }
        }
    }

    func signIn(email: String, password: String) async {
        await submit(path: "api/auth/sign-in/email", body: ["email": email, "password": password])
    }

    func signUp(email: String, password: String) async {
        let name = email.split(separator: "@").first.map(String.init) ?? "ProcrastiMate"
        await submit(path: "api/auth/sign-up/email", body: ["email": email, "password": password, "name": name])
    }

    func signIn(provider: String, idToken: String) async {
        await submit(path: "api/auth/sign-in/social", body: [
            "provider": provider,
            "idToken": ["token": idToken],
        ])
    }

    private func submit(path: String, body: [String: Any]) async {
        error = nil
        var request = URLRequest(url: AppEnvironment.apiURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await APIClient.session.data(for: request)
        } catch {
            self.error = ErrorReport("Could not sign in", detail: "POST \(path): \(String(reflecting: error))")
            return
        }
        let body = String(decoding: data, as: UTF8.self)
        guard let http = response as? HTTPURLResponse else {
            self.error = ErrorReport("Could not sign in", detail: "POST \(path): not an HTTP response")
            return
        }
        guard http.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            self.error = ErrorReport(
                http.statusCode == 401 ? "Wrong email or password" : "Could not sign in",
                detail: "POST \(path) → \(http.statusCode): \(body)"
            )
            return
        }
        let header = http.value(forHTTPHeaderField: "set-auth-token")
        let token = header ?? object["token"] as? String
        guard let token, !token.isEmpty else {
            self.error = ErrorReport("Could not sign in", detail: "POST \(path): no set-auth-token header or token in \(body)")
            return
        }
        SessionToken.write(token)
        if let user = object["user"] as? [String: Any], let id = user["id"] as? String {
            await adopt(id, email: user["email"] as? String, name: user["name"] as? String)
        } else {
            signedIn = true
            await refresh()
        }
    }
}
