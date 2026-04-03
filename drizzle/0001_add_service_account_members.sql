-- Migration 0001: ensure service_account_members exists
-- Safe to run on machines where the table was already created manually.
CREATE TABLE IF NOT EXISTS "service_account_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service_account_id" bigint NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_account_members" ADD CONSTRAINT "service_account_members_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sa_members_sa_id_idx" ON "service_account_members" USING btree ("service_account_id");
