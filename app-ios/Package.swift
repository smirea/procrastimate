// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "procrastimate",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.executable(name: "procrastimate", targets: ["App"])],
    targets: [.executableTarget(name: "App")]
)
