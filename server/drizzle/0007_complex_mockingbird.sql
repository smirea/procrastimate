CREATE TABLE `images` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`size` text NOT NULL,
	`type` text NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer NOT NULL,
	`orphaned_at` integer,
	PRIMARY KEY(`user_id`, `id`, `size`)
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `images` text DEFAULT '[]' NOT NULL;