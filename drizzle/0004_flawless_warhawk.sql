CREATE TABLE "huddle_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"scheduled_date" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp,
	"done_by_user_id" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"carried_from_date" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_verification_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"syncore_job_id" text NOT NULL,
	"imprint_location" text,
	"qty_garments" integer,
	"approved_by" text,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "production_schedule_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"syncore_job_id" text NOT NULL,
	"scheduled_date" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp,
	"done_by_user_id" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"carried_from_date" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "huddle_tasks" ADD CONSTRAINT "huddle_tasks_done_by_user_id_user_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "huddle_tasks" ADD CONSTRAINT "huddle_tasks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_schedule_state" ADD CONSTRAINT "production_schedule_state_done_by_user_id_user_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "huddle_tasks_date_idx" ON "huddle_tasks" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "job_verification_record_job_idx" ON "job_verification_record" USING btree ("syncore_job_id");--> statement-breakpoint
CREATE INDEX "job_verification_record_captured_idx" ON "job_verification_record" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "production_schedule_state_job_date_uq" ON "production_schedule_state" USING btree ("syncore_job_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "production_schedule_state_date_idx" ON "production_schedule_state" USING btree ("scheduled_date");