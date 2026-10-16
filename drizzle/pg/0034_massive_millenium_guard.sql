CREATE TABLE "tracked_backlink_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_url" text NOT NULL,
	"target_url" text NOT NULL,
	"trigger" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"task_id" text,
	"billing_lock_id" text,
	"billing_feature_id" text,
	"billing_estimated_credits" integer,
	"billing_estimated_cost_usd" double precision,
	"billing_actual_cost_usd" double precision,
	"billing_settled_at" text,
	"anchor" text,
	"rel" text,
	"error" text,
	"created_at" text NOT NULL,
	"completed_at" text,
	"next_poll_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_backlink_configs" (
	"project_id" text PRIMARY KEY NOT NULL,
	"schedule_interval" text DEFAULT 'off' NOT NULL,
	"max_cost_usd_per_check" double precision DEFAULT 0 NOT NULL,
	"last_processed_at" text,
	"monthly_check_limit" integer DEFAULT 100 NOT NULL,
	"usage_month" text NOT NULL,
	"checks_used" integer DEFAULT 0 NOT NULL,
	"next_check_at" text,
	"last_skip_reason" text
);
--> statement-breakpoint
CREATE TABLE "tracked_backlinks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_url" text NOT NULL,
	"target_url" text NOT NULL,
	"acquired_on" text,
	"notes" text DEFAULT '' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unchecked' NOT NULL,
	"anchor" text,
	"rel" text,
	"last_checked_at" text,
	"error" text,
	"checking" boolean DEFAULT false NOT NULL,
	"check_started_at" text,
	"last_scheduled_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_backlink_checks" ADD CONSTRAINT "tracked_backlink_checks_link_id_tracked_backlinks_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracked_backlinks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_backlink_checks" ADD CONSTRAINT "tracked_backlink_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_backlink_configs" ADD CONSTRAINT "tracked_backlink_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_backlinks" ADD CONSTRAINT "tracked_backlinks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracked_backlink_checks_project_idx" ON "tracked_backlink_checks" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "tracked_backlink_checks_due_idx" ON "tracked_backlink_checks" USING btree ("state","next_poll_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_backlink_checks_one_active_idx" ON "tracked_backlink_checks" USING btree ("link_id") WHERE "tracked_backlink_checks"."state" IN ('queued', 'submitting', 'pending');--> statement-breakpoint
CREATE INDEX "tracked_backlink_configs_due_idx" ON "tracked_backlink_configs" USING btree ("schedule_interval","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_backlinks_project_urls_idx" ON "tracked_backlinks" USING btree ("project_id","source_url","target_url");--> statement-breakpoint
CREATE INDEX "tracked_backlinks_project_idx" ON "tracked_backlinks" USING btree ("project_id");