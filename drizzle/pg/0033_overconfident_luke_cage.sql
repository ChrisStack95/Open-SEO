CREATE TABLE "ai_access_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"started_by_user_id" text NOT NULL,
	"start_url" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"workflow_instance_id" text,
	"overall_score" integer,
	"js_score" integer,
	"llm_txt_score" integer,
	"robots_score" integer,
	"schema_score" integer,
	"results" text DEFAULT '{}' NOT NULL,
	"error_code" text,
	"error_detail" text,
	"created_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
ALTER TABLE "ai_access_audits" ADD CONSTRAINT "ai_access_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_access_audits_project_created_idx" ON "ai_access_audits" USING btree ("project_id","created_at");