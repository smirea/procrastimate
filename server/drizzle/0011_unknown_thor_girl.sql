CREATE TABLE `task_clients` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`created` text,
	`edited` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `log` DROP COLUMN `client`;