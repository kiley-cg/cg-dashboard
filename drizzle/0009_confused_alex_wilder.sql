CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cron_path" text NOT NULL,
	"triggered_at" timestamp DEFAULT now() NOT NULL,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"duration_ms" integer,
	"status" text NOT NULL,
	"summary" jsonb,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "cron_runs_path_idx" ON "cron_runs" USING btree ("cron_path","triggered_at");