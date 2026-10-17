// swift-tools-version: 6.1
import PackageDescription

let package = Package(
	name: "PocSync",
	platforms: [.iOS(.v17), .macOS(.v14), .watchOS(.v10)],
	products: [.library(name: "PocSync", targets: ["PocSync"])],
	dependencies: [.package(url: "https://github.com/powersync-ja/powersync-swift", from: "1.16.4")],
	targets: [
		.target(name: "PocSync", dependencies: [
			.product(name: "PowerSync", package: "powersync-swift"),
			.product(name: "PowerSyncGRDB", package: "powersync-swift"),
		]),
		.testTarget(name: "PocSyncTests", dependencies: ["PocSync"]),
	]
)
