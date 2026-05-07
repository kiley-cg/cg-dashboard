CREATE TABLE "job_verification_clears" (
	"job_id" text PRIMARY KEY NOT NULL,
	"cleared_at" timestamp DEFAULT now() NOT NULL,
	"cleared_by_user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_verification_clears" ADD CONSTRAINT "job_verification_clears_cleared_by_user_id_user_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
