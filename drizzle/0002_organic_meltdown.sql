CREATE TABLE "followup_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_at" timestamp NOT NULL,
	"csr_id" integer NOT NULL,
	"csr_name" text NOT NULL,
	"follow_up_status" text NOT NULL,
	"job_id" integer NOT NULL,
	"fu_date" text,
	"contact" text,
	"job_status" text,
	"supplier" text,
	"job_description" text,
	"primary_rep" text,
	"priority" text,
	"est_delivery" text,
	"issue" text,
	"raw" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"csr_id" integer NOT NULL,
	"csr_name" text NOT NULL,
	"follow_up_status" text NOT NULL,
	"follow_up_date" text NOT NULL,
	"total_records" integer NOT NULL,
	"total_issues" integer NOT NULL,
	"issue_counts" jsonb NOT NULL,
	"raw_statistics" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "followup_rows" ADD CONSTRAINT "followup_rows_snapshot_id_followup_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."followup_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followup_rows_time_csr_idx" ON "followup_rows" USING btree ("snapshot_at","csr_id");--> statement-breakpoint
CREATE INDEX "followup_rows_job_time_idx" ON "followup_rows" USING btree ("job_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "followup_rows_issue_idx" ON "followup_rows" USING btree ("snapshot_at","issue");--> statement-breakpoint
CREATE INDEX "followup_snapshots_csr_time_idx" ON "followup_snapshots" USING btree ("csr_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "followup_snapshots_time_idx" ON "followup_snapshots" USING btree ("snapshot_at");