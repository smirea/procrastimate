import Foundation
import GRDB
import PowerSync
import PowerSyncGRDB

public struct LocalDatabase: Sendable {
	public let pool: DatabasePool
	public let powerSync: PowerSyncDatabaseProtocol

	/// PowerSync creates its views lazily on the first PowerSync call, so GRDB sees "no such table" until
	/// something like `getPowerSyncVersion()` has run.
	public static func open(path: String, logger: any LoggerProtocol = DefaultLogger(minSeverity: .warning)) async throws -> LocalDatabase {
		var config = Configuration()
		try config.configurePowerSync(schema: pocSchema)
		let pool = try DatabasePool(path: path, configuration: config)
		let powerSync = openPowerSyncWithGRDB(pool: pool, schema: pocSchema, identifier: URL(fileURLWithPath: path).lastPathComponent, logger: logger)
		_ = try await powerSync.getPowerSyncVersion()
		return LocalDatabase(pool: pool, powerSync: powerSync)
	}
}
