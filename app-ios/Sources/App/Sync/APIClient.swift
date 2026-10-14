import Core
import Foundation

enum APIFailure: Error {
    case status(Int, APIError?)
    case unreachable
}

enum APIClient {
    static func send<E: APIEndpoint>(
        _: E.Type,
        _ input: E.Input,
        token: String? = SessionToken.read(),
        device: (id: String, name: String)? = nil
    ) async throws -> E.Output {
        var request = URLRequest(url: AppEnvironment.apiURL.appending(path: String(E.path.dropFirst())))
        request.httpMethod = E.method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
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
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIFailure.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw APIFailure.unreachable }
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
}
