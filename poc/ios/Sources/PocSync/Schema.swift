import PowerSync

public let pocSchema = Schema(
	Table(name: "tasks", columns: [
		.text("user_id"),
		.text("title"),
		.text("notes"),
		.text("label_ids"),
		.text("due"),
		.integer("priority"),
		.real("order"),
		.integer("created_at"),
		.integer("completed_at"),
		.text("created_by"),
	], ignoreEmptyUpdates: true),
	Table(name: "access", columns: [
		.text("grantee"),
		.text("owner"),
		.text("kind"),
		.text("entity_id"),
		.text("role"),
	])
)
