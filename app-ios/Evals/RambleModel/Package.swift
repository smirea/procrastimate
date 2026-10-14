// swift-tools-version: 6.2
import PackageDescription
let package = Package(
    name: "eval",
    platforms: [.macOS(.v26)],
    dependencies: [.package(path: "../..")],
    targets: [.executableTarget(name: "eval", dependencies: [.product(name: "Core", package: "app-ios")])]
)
