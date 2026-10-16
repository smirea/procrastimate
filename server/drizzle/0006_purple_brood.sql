CREATE TABLE `comments` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`task_id` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `reads` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`read_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
