DROP TABLE "people" CASCADE;--> statement-breakpoint
DROP TABLE "task_clients" CASCADE;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "client" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "log_op" ON "log" USING btree ("user_id","op_id");--> statement-breakpoint
CREATE INDEX "log_source_key" ON "log" USING btree ("user_id",("fields"->>'sourceKey')) WHERE "log"."kind" = 'task' and "log"."fields" ? 'sourceKey';--> statement-breakpoint
CREATE INDEX "log_comment_task" ON "log" USING btree ("user_id",("fields"->>'taskId')) WHERE "log"."kind" = 'comment' and "log"."op" = 'put';--> statement-breakpoint
CREATE INDEX "tasks_source_key" ON "tasks" USING btree ("user_id","source_key" text_pattern_ops);