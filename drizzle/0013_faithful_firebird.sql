CREATE TABLE "proof_backfill_state" (
	"range_name" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"total_count" integer,
	"processed_offset" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
