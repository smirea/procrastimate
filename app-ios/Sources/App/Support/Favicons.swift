import Core
import SwiftUI
import UIKit

/// Each link host's icon, from the server's favicon route, which `Links.text` draws before the link. Observable, so text
/// drawn before an icon arrives redraws with it. The route's `Cache-Control` keeps the bytes in `URLCache` for a week,
/// so a host is fetched once per launch at most. See `docs/decisions/link-previews.md`.
@MainActor
@Observable
final class Favicons {
    static let shared = Favicons()

    /// Nil inside once the host turned out to have no icon, or none that decodes.
    private var icons: [String: UIImage?] = [:]
    @ObservationIgnored private var requested: Set<String> = []
    @ObservationIgnored private var sized: [String: CGImage] = [:]

    /// The icon drawn `side` points square, or nil until it arrives and for a host without one. Asking starts the fetch.
    func icon(_ host: String, side: CGFloat) -> CGImage? {
        guard let loaded = icons[host] else {
            load(host)
            return nil
        }
        guard let loaded else { return nil }
        let key = "\(host) \(side)"
        if let image = sized[key] { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = UITraitCollection.current.displayScale
        let rect = CGRect(origin: .zero, size: CGSize(width: side, height: side))
        let image = UIGraphicsImageRenderer(size: rect.size, format: format).image { _ in
            UIBezierPath(roundedRect: rect, cornerRadius: side * 0.2).addClip()
            loaded.draw(in: rect)
        }.cgImage
        sized[key] = image
        return image
    }

    /// One request per host per launch: a host that failed offline is asked again on the next launch.
    private func load(_ host: String) {
        guard !requested.contains(host), let token = SessionToken.read() else { return }
        requested.insert(host)
        Task {
            var url = AppEnvironment.apiURL.appending(path: String(Links.faviconPath.dropFirst()))
            url.append(queryItems: [URLQueryItem(name: "host", value: host)])
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            guard let (data, response) = try? await APIClient.session.data(for: request) else { return }
            let image = (response as? HTTPURLResponse)?.statusCode == 200 ? UIImage(data: data) : nil
            icons[host] = .some(image)
        }
    }
}
