import GRDB

public struct Due: Codable, Hashable, Sendable {
	public var date: String
	public var time: String?

	public init(date: String, time: String? = nil) {
		self.date = date
		self.time = time
	}
}

public struct TaskRecord: Codable, Hashable, Sendable, Identifiable, FetchableRecord, PersistableRecord {
	public static let databaseTableName = "tasks"
	public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
	public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

	public var id: String
	public var userId: String
	public var title: String
	public var notes: String
	public var labelIds: [String]
	public var due: Due?
	public var priority: Int
	public var order: Double
	public var createdAt: Int64
	public var completedAt: Int64?
	public var createdBy: String?

	public init(id: String, userId: String, title: String, notes: String = "", labelIds: [String] = [], due: Due? = nil, priority: Int = 4, order: Double = 0, createdAt: Int64, completedAt: Int64? = nil, createdBy: String? = nil) {
		self.id = id
		self.userId = userId
		self.title = title
		self.notes = notes
		self.labelIds = labelIds
		self.due = due
		self.priority = priority
		self.order = order
		self.createdAt = createdAt
		self.completedAt = completedAt
		self.createdBy = createdBy
	}
}

public enum AccessRole: String, Codable, Sendable {
	case view, edit
}

public struct AccessRecord: Codable, Hashable, Sendable, Identifiable, FetchableRecord, PersistableRecord {
	public static let databaseTableName = "access"
	public static let databaseColumnDecodingStrategy = DatabaseColumnDecodingStrategy.convertFromSnakeCase
	public static let databaseColumnEncodingStrategy = DatabaseColumnEncodingStrategy.convertToSnakeCase

	public var id: String
	public var grantee: String
	public var owner: String
	public var kind: String
	public var entityId: String
	public var role: AccessRole
}
