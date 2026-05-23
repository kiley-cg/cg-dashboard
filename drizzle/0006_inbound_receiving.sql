CREATE TABLE "po_inbound_state" (
	"po_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp,
	"received_by_user_id" text,
	"syncore_memo_updated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "po_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" text NOT NULL,
	"carrier" text NOT NULL,
	"tracking_number" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text,
	"eta" text,
	"last_polled_at" timestamp,
	"entered_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "po_inbound_state" ADD CONSTRAINT "po_inbound_state_received_by_user_id_user_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_tracking" ADD CONSTRAINT "po_tracking_entered_by_user_id_user_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_tracking_po_id_idx" ON "po_tracking" USING btree ("po_id");
