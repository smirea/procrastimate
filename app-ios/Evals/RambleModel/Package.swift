// swift-tools-version: 6.4
import PackageDescription
let package = Package(
    name: "eval",
    platforms: [.macOS(.v27)],
    dependencies: [.package(path: "../..")],
    targets: [.executableTarget(name: "eval", dependencies: [.product(name: "Core", package: "app-ios")])]
)
