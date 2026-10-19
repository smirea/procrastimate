// swift-tools-version: 6.4
import PackageDescription
let package = Package(
    name: "eval",
    platforms: [.macOS(.v27)],
    targets: [.executableTarget(name: "eval")]
)
