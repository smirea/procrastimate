-- Task data used to be one JSON row per entity. This copies it into the typed tables once. A fresh database gets
-- an empty `entities` so the copy has something to read. The old table stays until a later migration drops it.
CREATE TABLE IF NOT EXISTS `entities` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	`clocks` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `id`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO `tasks` (`user_id`, `id`, `parent_id`, `order`, `title`, `notes`, `project_id`, `label_ids`, `due`, `recurrence`, `priority`, `reminders`, `created_at`, `completed_at`, `source_key`, `deleted`, `clocks`)
SELECT `user_id`, `id`,
	json_extract(`data`, '$.parentId'),
	coalesce(json_extract(`data`, '$.order'), 0),
	coalesce(json_extract(`data`, '$.title'), ''),
	coalesce(json_extract(`data`, '$.notes'), ''),
	json_extract(`data`, '$.projectId'),
	coalesce(json_extract(`data`, '$.labelIds'), '[]'),
	json_extract(`data`, '$.due'),
	json_extract(`data`, '$.recurrence'),
	coalesce(json_extract(`data`, '$.priority'), 4),
	coalesce(json_extract(`data`, '$.reminders'), '[]'),
	coalesce(json_extract(`data`, '$.createdAt'), 0),
	json_extract(`data`, '$.completedAt'),
	json_extract(`data`, '$.sourceKey'),
	coalesce(json_extract(`data`, '$.deleted'), 0),
	`clocks`
FROM `entities` WHERE `kind` = 'task';
--> statement-breakpoint
INSERT OR IGNORE INTO `projects` (`user_id`, `id`, `name`, `created_at`, `source_key`, `deleted`, `clocks`)
SELECT `user_id`, `id`,
	coalesce(json_extract(`data`, '$.name'), ''),
	coalesce(json_extract(`data`, '$.createdAt'), 0),
	json_extract(`data`, '$.sourceKey'),
	coalesce(json_extract(`data`, '$.deleted'), 0),
	`clocks`
FROM `entities` WHERE `kind` = 'project';
--> statement-breakpoint
INSERT OR IGNORE INTO `labels` (`user_id`, `id`, `name`, `created_at`, `deleted`, `clocks`)
SELECT `user_id`, `id`,
	coalesce(json_extract(`data`, '$.name'), ''),
	coalesce(json_extract(`data`, '$.createdAt'), 0),
	coalesce(json_extract(`data`, '$.deleted'), 0),
	`clocks`
FROM `entities` WHERE `kind` = 'label';
--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`user_id`, `id`, `time_zone`, `clocks`)
SELECT `user_id`, `id`, json_extract(`data`, '$.timeZone'), `clocks`
FROM `entities` WHERE `kind` = 'settings';
