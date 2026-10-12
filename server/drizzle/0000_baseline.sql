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
CREATE TABLE IF NOT EXISTS `labels` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
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
CREATE TABLE IF NOT EXISTS `projects` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`source_key` text,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`time_zone` text,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`parent_id` text,
	`order` real DEFAULT 0 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`project_id` text,
	`label_ids` text DEFAULT '[]' NOT NULL,
	`due` text,
	`recurrence` text,
	`priority` integer DEFAULT 4 NOT NULL,
	`reminders` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`source_key` text,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` date,
	`refreshTokenExpiresAt` date,
	`scope` text,
	`password` text,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rateLimit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`lastRequest` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rateLimit_key_unique` ON `rateLimit` (`key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` date NOT NULL,
	`token` text NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` date NOT NULL,
	`createdAt` date NOT NULL,
	`updatedAt` date NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`);