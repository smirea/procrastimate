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

    private let store: Store
    var signedIn: Bool
    var error: ErrorReport?
    var methods = API.AuthMethods.none

    init(store: Store) {
        self.store = store
        signedIn = SessionToken.read() != nil || Launch.signedIn
    }

    func start() async {
        // At launch too, so the shared item names the server this build talks to.
        if let token = SessionToken.read() { SharedSession.write(token: token) }
        await refresh()
        await loadMethods()
    }

    func refresh() async {
        guard let token = SessionToken.read() else {
            signedIn = Launch.signedIn
            return
        }
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
        if http.statusCode == 401 || http.statusCode == 503 {
            SessionToken.clear()
            signedIn = Launch.signedIn
            return
        }
        guard http.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let user = object["user"] as? [String: Any],
              let id = user["id"] as? String else {
            SessionToken.clear()
            signedIn = Launch.signedIn
            return
        }
        adopt(id)
    }

    /// Remembers who the local document belongs to. A different user pulls a fresh snapshot instead of uploading.
    func adopt(_ id: String) {
        let owner = UserDefaults.standard.string(forKey: Self.ownerKey)
        if let owner, owner != id { store.switchUser() }
        UserDefaults.standard.set(id, forKey: Self.ownerKey)
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
            adopt(id)
        } else {
            signedIn = true
            await refresh()
        }
    }
}
