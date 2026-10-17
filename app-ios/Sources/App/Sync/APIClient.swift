import Core
import Foundation
import Synchronization

enum APIFailure: Error {
    case status(Int, APIError?)
    case unreachable(any Error)
}

enum APIClient {
    /// Every request to the API goes through this session. The app authenticates with the bearer token, so it keeps
    /// no cookies: a stored Better Auth cookie on a request without an `Origin` makes sign-in and sign-out fail with
    /// `403 MISSING_OR_NULL_ORIGIN`.
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        return URLSession(configuration: configuration)
    }()

    /// This install's device, which the owner's routes (spaces, shares, tokens) authenticate along with the session.
    /// Sync sets it before its first request.
    static let device = Mutex<(id: String, name: String)?>(nil)

    /// `query` drops nil values, so an own-space request sends no `space`.
    static func send<E: APIEndpoint>(
        _: E.Type,
        _ input: E.Input,
        query: [String: String?] = [:],
        token: String? = SessionToken.read(),
        device: (id: String, name: String)? = nil
    ) async throws -> E.Output {
        let device = device ?? (token == nil ? nil : Self.device.withLock { $0 })
        var url = AppEnvironment.apiURL.appending(path: String(E.path.dropFirst()))
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { url.append(queryItems: items.sorted { $0.name < $1.name }) }
        var request = URLRequest(url: url)
        request.httpMethod = E.method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.setValue(AppClient.value, forHTTPHeaderField: AppClient.header)
        if let device {
            request.setValue(device.id, forHTTPHeaderField: "x-procrastimate-device")
            request.setValue(device.name, forHTTPHeaderField: "x-procrastimate-device-name")
        }
        if !(input is NoInput) {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(input)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIFailure.unreachable(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIFailure.unreachable(URLError(.badServerResponse)) }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw APIFailure.status(http.statusCode, try? JSONDecoder().decode(APIError.self, from: data))
        }
        return try JSONDecoder.validating().decode(E.Output.self, from: data)
    }
}

extension APIFailure {
    var isUnauthorized: Bool {
        if case .status(401, _) = self { true } else { false }
    }

    var isForbidden: Bool {
        if case .status(403, _) = self { true } else { false }
    }
}
