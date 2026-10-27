ALTER TABLE "push" ADD COLUMN "subscribed_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push" ALTER COLUMN "subscribed_at" DROP DEFAULT;