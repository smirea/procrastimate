CREATE TABLE "access" (
	"id" text PRIMARY KEY NOT NULL,
	"grantee" text NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"role" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"ai_user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	CONSTRAINT "api_tokens_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"created_at" bigint NOT NULL,
	"edited_at" bigint
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "images" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"size" text NOT NULL,
	"type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" bigint NOT NULL,
	"orphaned_at" bigint,
	CONSTRAINT "images_user_id_id_size_pk" PRIMARY KEY("user_id","id","size")
);
--> statement-breakpoint
ALTER TABLE "images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"place" jsonb,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"op_id" text,
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"op" text NOT NULL,
	"fields" jsonb NOT NULL,
	"actor" text DEFAULT 'server' NOT NULL,
	"client" jsonb,
	"at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"order" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"source_key" text
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push" (
	"user_id" text NOT NULL,
	"device_id" text NOT NULL,
	"subscription" jsonb NOT NULL,
	"notifications" jsonb NOT NULL,
	"delivered_through" bigint NOT NULL,
	"next_at" bigint,
	CONSTRAINT "push_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "push" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ramble_budget" (
	"day" text PRIMARY KEY NOT NULL,
	"seconds" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ramble_budget" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ramble_usage" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"seconds" double precision NOT NULL,
	CONSTRAINT "ramble_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "ramble_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reads" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"read_at" bigint NOT NULL,
	CONSTRAINT "reads_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"order" double precision DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"source_key" text
);
--> statement-breakpoint
ALTER TABLE "sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"time_zone" text,
	"dictation" text DEFAULT 'native' NOT NULL,
	"quick_add_buttons" jsonb DEFAULT '["date","priority","reminders","subtasks"]'::jsonb NOT NULL,
	CONSTRAINT "settings_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shares" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"grantee" text,
	"role" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "shares_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" text,
	"order" double precision DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"project_id" text,
	"section_id" text,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due" jsonb,
	"recurrence" jsonb,
	"priority" integer DEFAULT 4 NOT NULL,
	"reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" jsonb,
	"event" jsonb,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"completed_at" bigint,
	"created_by" text,
	"completed_by" text,
	"last_completed_at" bigint,
	"source_key" text
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL,
	CONSTRAINT "rateLimit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "rateLimit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"owner_id" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grantee" ON "access" USING btree ("grantee");--> statement-breakpoint
CREATE INDEX "access_owner" ON "access" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "comments_user_id" ON "comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "comments_task_id" ON "comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "labels_user_id" ON "labels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "log_entity" ON "log" USING btree ("kind","id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "log_op" ON "log" USING btree ("user_id","op_id");--> statement-breakpoint
CREATE INDEX "log_source_key" ON "log" USING btree ("user_id",("fields"->>'sourceKey')) WHERE "log"."kind" = 'task' and "log"."fields" ? 'sourceKey';--> statement-breakpoint
CREATE INDEX "log_comment_task" ON "log" USING btree ("user_id",("fields"->>'taskId')) WHERE "log"."kind" = 'comment' and "log"."op" = 'put';--> statement-breakpoint
CREATE INDEX "projects_user_id" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_next_at" ON "push" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "sections_user_id" ON "sections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shares_grantee" ON "shares" USING btree ("grantee");--> statement-breakpoint
CREATE INDEX "tasks_user_created" ON "tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_images" ON "tasks" USING gin ("images" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "tasks_source_key" ON "tasks" USING btree ("user_id","source_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
-- PowerSync replicates exactly these tables. A new synced table needs its own `ALTER PUBLICATION powersync ADD TABLE`.
CREATE PUBLICATION powersync FOR TABLE "tasks", "projects", "sections", "labels", "comments", "reads", "settings", "access";