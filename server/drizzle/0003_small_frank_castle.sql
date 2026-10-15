CREATE TABLE `api_tokens` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`ai_user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`user_id` text NOT NULL,
	`space_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `space_id`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`grantee` text,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `log` ADD `actor` text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE `log` ADD `at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_by` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_completed_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `kind` text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `owner_id` text;