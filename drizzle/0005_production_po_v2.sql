DROP TABLE "production_schedule_state";--> statement-breakpoint
CREATE TABLE "production_po_mirror" (
	"po_id" text PRIMARY KEY NOT NULL,
	"syncore_job_id" text NOT NULL,
	"po_number" integer,
	"status" text NOT NULL,
	"supplier_id" integer,
	"supplier_name" text,
	"supplier_class" text,
	"in_hand_date" text,
	"decoration_instructions" text,
	"stitch_count" integer,
	"total_quantity" integer,
	"raw" jsonb NOT NULL,
	"mirrored_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_schedule_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" text NOT NULL,
	"scheduled_date" text,
	"floor_status" text DEFAULT 'stopped' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"carried_from_date" text,
	"done_at" timestamp,
	"done_by_user_id" text,
	"syncore_closed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "po_schedule_state_po_id_unique" UNIQUE("po_id")
);
--> statement-breakpoint
ALTER TABLE "po_schedule_state" ADD CONSTRAINT "po_schedule_state_done_by_user_id_user_id_fk" FOREIGN KEY ("done_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_po_mirror_job_idx" ON "production_po_mirror" USING btree ("syncore_job_id");--> statement-breakpoint
CREATE INDEX "production_po_mirror_class_idx" ON "production_po_mirror" USING btree ("supplier_class","status");--> statement-breakpoint
CREATE INDEX "po_schedule_state_date_idx" ON "po_schedule_state" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "po_schedule_state_status_idx" ON "po_schedule_state" USING btree ("floor_status");
