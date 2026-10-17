import Core
import Foundation

/// This app as the `x-procrastimate-client` header, which the server records on every op a request writes, so the
/// agent API can tell which app, version, device, and time zone made or last changed a task.
enum AppClient {
    static let header = "x-procrastimate-client"

    /// Read per request, since the time zone can change while the app runs.
    static var value: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String
        let build = info?["CFBundleVersion"] as? String
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let client = API.Client(
            kind: .ios,
            version: short.map { short in build.map { "\(short) (\($0))" } ?? short },
            device: model,
            os: "iOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            timeZone: TimeZone.current.identifier
        )
        guard let data = try? JSONEncoder().encode(client) else { preconditionFailure("A Client always encodes") }
        return String(decoding: data, as: UTF8.self)
    }

    /// The hardware identifier, such as `iPhone17,1`. A simulator reports the Mac's, so it names the one it simulates.
    private static let model: String = {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: system.machine) { bytes in
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()
}
