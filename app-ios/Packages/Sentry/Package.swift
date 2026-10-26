// swift-tools-version:6.0

import PackageDescription

// sentry-cocoa's own manifest declares seven binary xcframeworks, and SwiftPM downloads and unzips every one on resolve
// though the app links only Sentry-Dynamic. This package declares that one, copied from sentry-cocoa's Package.swift at
// the same release. To upgrade, copy the new release's Sentry-Dynamic url and checksum from that file.
let package = Package(
    name: "Sentry",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "Sentry-Dynamic", targets: ["Sentry-Dynamic"])
    ],
    targets: [
        .binaryTarget(
            name: "Sentry-Dynamic",
            url: "https://github.com/getsentry/sentry-cocoa/releases/download/9.30.2/Sentry-Dynamic.xcframework.zip",
            checksum: "95b6859ed838b78953d1351feb4dc0df3e7809aa497376487553bc36f1365ed5"
        )
    ]
)
