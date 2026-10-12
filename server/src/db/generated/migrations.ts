export const migrations: { tag: string; when: number; statements: string[] }[] = [
	{
		"tag": "0000_baseline",
		"when": 1791797247086,
		"statements": [
			"CREATE TABLE IF NOT EXISTS `devices` (\n\t`user_id` text NOT NULL,\n\t`id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`token_hash` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`last_seen_at` integer NOT NULL,\n\t`revoked_at` integer,\n\tPRIMARY KEY(`user_id`, `id`)\n);",
			"CREATE UNIQUE INDEX IF NOT EXISTS `devices_token_hash_unique` ON `devices` (`token_hash`);",
			"CREATE TABLE IF NOT EXISTS `entities` (\n\t`user_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`id` text NOT NULL,\n\t`data` text NOT NULL,\n\t`clocks` text NOT NULL,\n\tPRIMARY KEY(`user_id`, `kind`, `id`)\n);",
			"CREATE TABLE IF NOT EXISTS `log` (\n\t`user_id` text NOT NULL,\n\t`seq` integer NOT NULL,\n\t`op_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`id` text NOT NULL,\n\t`fields` text NOT NULL,\n\tPRIMARY KEY(`user_id`, `seq`)\n);",
			"CREATE INDEX IF NOT EXISTS `log_op_id` ON `log` (`user_id`,`op_id`);",
			"CREATE TABLE IF NOT EXISTS `meta` (\n\t`user_id` text NOT NULL,\n\t`key` text NOT NULL,\n\t`value` text NOT NULL,\n\tPRIMARY KEY(`user_id`, `key`)\n);",
			"CREATE TABLE IF NOT EXISTS `push` (\n\t`user_id` text NOT NULL,\n\t`device_id` text NOT NULL,\n\t`subscription` text NOT NULL,\n\t`notifications` text NOT NULL,\n\t`delivered_through` integer NOT NULL,\n\tPRIMARY KEY(`user_id`, `device_id`)\n);",
			"CREATE TABLE IF NOT EXISTS `ramble_budget` (\n\t`day` text PRIMARY KEY NOT NULL,\n\t`seconds` real NOT NULL\n);",
			"CREATE TABLE IF NOT EXISTS `ramble_usage` (\n\t`user_id` text NOT NULL,\n\t`day` text NOT NULL,\n\t`seconds` real NOT NULL,\n\tPRIMARY KEY(`user_id`, `day`)\n);"
		]
	}
];
