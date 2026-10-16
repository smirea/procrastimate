CREATE TABLE `sections` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`order` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`source_key` text,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `section_id` text;