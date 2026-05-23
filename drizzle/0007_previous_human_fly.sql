ALTER TABLE "po_schedule_state" ADD COLUMN "production_notes" text;--> statement-breakpoint
ALTER TABLE "po_schedule_state" ADD COLUMN "notes_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "po_schedule_state" ADD COLUMN "notes_updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "po_schedule_state" ADD CONSTRAINT "po_schedule_state_notes_updated_by_user_id_user_id_fk" FOREIGN KEY ("notes_updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_schedule_state_notes_updated_idx" ON "po_schedule_state" USING btree ("notes_updated_at");