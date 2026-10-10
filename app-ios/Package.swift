// swift-tools-version: 6.2
import PackageDescription

// The SwiftUI app builds from App.xcodeproj. This package covers `Core`, so `swift test` runs on macOS and Linux.
let package = Package(
    name: "procrastimate",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "Core", targets: ["Core"])],
    targets: [
        .target(name: "Core"),
        .testTarget(name: "CoreTests", dependencies: ["Core"]),
    ]
)
