import Core
import SwiftUI
import UIKit

/// Each link's icon, from the server's favicon route, which `Links.text` draws before the link. Observable, so text
/// drawn before an icon arrives redraws with it. The route's `Cache-Control` keeps the bytes in `URLCache` for a week,
/// so a link is fetched once per launch at most. See `docs/decisions/link-previews.md`.
@MainActor
@Observable
final class Favicons {
    static let shared = Favicons()

    /// By link href. Nil inside once the page turned out to have no icon, or none that decodes.
    private var icons: [String: UIImage?] = [:]
    @ObservationIgnored private var requested: Set<String> = []
    @ObservationIgnored private var sized: [String: CGImage] = [:]

    /// The icon drawn `side` points square, or nil until it arrives and for a page without one. Asking starts the fetch.
    func icon(_ href: String, side: CGFloat) -> CGImage? {
        guard let loaded = icons[href] else {
            load(href)
            return nil
        }
        guard let loaded else { return nil }
        let key = "\(side) \(href)"
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

    /// Unreserved characters only, so the link's own `&`, `=`, and `?` stay inside the one `url` value.
    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// One request per link per launch: a link that failed offline is asked again on the next launch.
    private func load(_ href: String) {
        guard !requested.contains(href), let token = SessionToken.read(),
              let value = href.addingPercentEncoding(withAllowedCharacters: Self.unreserved),
              var components = URLComponents(
                  url: AppEnvironment.apiURL.appending(path: String(Links.faviconPath.dropFirst())),
                  resolvingAgainstBaseURL: false
              ) else { return }
        requested.insert(href)
        components.percentEncodedQuery = "url=\(value)"
        guard let url = components.url else { return }
        Task {
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            guard let (data, response) = try? await APIClient.session.data(for: request) else { return }
            let image = (response as? HTTPURLResponse)?.statusCode == 200 ? UIImage(data: data) : nil
            icons[href] = .some(image)
        }
    }
}
