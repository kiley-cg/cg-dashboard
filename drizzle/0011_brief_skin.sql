CREATE TABLE "tracker_entries_cache" (
	"syncore_entry_id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_by_name" text NOT NULL,
	"description" text NOT NULL,
	"entry_type" integer NOT NULL,
	"color_id" integer NOT NULL,
	"recipient_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_inbox_state" (
	"syncore_entry_id" text NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"handled_at" timestamp,
	"handled_by_user_id" text,
	"notes" text,
	CONSTRAINT "tracker_inbox_state_syncore_entry_id_recipient_user_id_pk" PRIMARY KEY("syncore_entry_id","recipient_user_id")
);
--> statement-breakpoint
ALTER TABLE "tracker_inbox_state" ADD CONSTRAINT "tracker_inbox_state_handled_by_user_id_user_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracker_entries_cache_job_idx" ON "tracker_entries_cache" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tracker_entries_cache_created_idx" ON "tracker_entries_cache" USING btree ("created_at");