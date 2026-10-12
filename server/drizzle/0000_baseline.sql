CREATE TABLE IF NOT EXISTS `devices` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `entities` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `log` (
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`op_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`fields` text NOT NULL,
	PRIMARY KEY(`user_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `log_op_id` ON `log` (`user_id`,`op_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meta` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `push` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`subscription` text NOT NULL,
	`notifications` text NOT NULL,
	`delivered_through` integer NOT NULL,
	PRIMARY KEY(`user_id`, `device_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ramble_budget` (
	`day` text PRIMARY KEY NOT NULL,
	`seconds` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ramble_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`seconds` real NOT NULL,
	PRIMARY KEY(`user_id`, `day`)
);
