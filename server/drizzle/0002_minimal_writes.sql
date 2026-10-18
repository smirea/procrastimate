ALTER TABLE "log" ADD COLUMN "client" jsonb;--> statement-breakpoint
-- The apps behind each task move from `task_clients` onto the log, where the agent API now reads them: `created` onto
-- the task's first log row and `edited` onto its latest, each without its `at`, which the row's own `at` gives. A
-- task with a single row keeps `edited`, the newer stamp.
UPDATE "log" SET "client" = "task_clients"."created" - 'at'
FROM "task_clients"
WHERE "task_clients"."created" IS NOT NULL
	AND "log"."seq" = (
		SELECT min("first"."seq") FROM "log" AS "first"
		WHERE "first"."user_id" = "task_clients"."user_id" AND "first"."kind" = 'task' AND "first"."id" = "task_clients"."id"
	);--> statement-breakpoint
UPDATE "log" SET "client" = "task_clients"."edited" - 'at'
FROM "task_clients"
WHERE "log"."seq" = (
	SELECT max("latest"."seq") FROM "log" AS "latest"
	WHERE "latest"."user_id" = "task_clients"."user_id" AND "latest"."kind" = 'task' AND "latest"."id" = "task_clients"."id"
);--> statement-breakpoint
DROP TABLE "people" CASCADE;--> statement-breakpoint
DROP TABLE "task_clients" CASCADE;--> statement-breakpoint
DROP INDEX "tasks_user_id";--> statement-breakpoint
DROP INDEX "log_entity";--> statement-breakpoint
CREATE UNIQUE INDEX "log_op" ON "log" USING btree ("user_id","op_id");--> statement-breakpoint
CREATE INDEX "log_source_key" ON "log" USING btree ("user_id",("fields"->>'sourceKey')) WHERE "log"."kind" = 'task' and "log"."fields" ? 'sourceKey';--> statement-breakpoint
CREATE INDEX "log_comment_task" ON "log" USING btree ("user_id",("fields"->>'taskId')) WHERE "log"."kind" = 'comment' and "log"."op" = 'put';--> statement-breakpoint
CREATE INDEX "tasks_user_created" ON "tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_images" ON "tasks" USING gin ("images" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "tasks_source_key" ON "tasks" USING btree ("user_id","source_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "log_entity" ON "log" USING btree ("kind","id","seq");