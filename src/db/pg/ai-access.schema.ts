import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

export const aiAccessAudits = pgTable(
  "ai_access_audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedByUserId: text("started_by_user_id").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    workflowInstanceId: text("workflow_instance_id"),
    overallScore: integer("overall_score"),
    jsScore: integer("js_score"),
    llmTxtScore: integer("llm_txt_score"),
    robotsScore: integer("robots_score"),
    schemaScore: integer("schema_score"),
    results: text("results").notNull().default("{}"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("ai_access_audits_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);
