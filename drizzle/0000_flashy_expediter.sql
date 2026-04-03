CREATE TABLE "check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service_account_id" bigint NOT NULL,
	"monthly_credits" text DEFAULT '' NOT NULL,
	"additional_credits" text DEFAULT '' NOT NULL,
	"additional_credits_expiry" text DEFAULT '' NOT NULL,
	"member_activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"screenshot" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_account_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"service_account_id" bigint NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"totp_secret" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"proxy" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_account_members" ADD CONSTRAINT "service_account_members_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_sa_id_idx" ON "check_results" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "check_results_created_at" ON "check_results" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sa_members_sa_id_idx" ON "service_account_members" USING btree ("service_account_id");