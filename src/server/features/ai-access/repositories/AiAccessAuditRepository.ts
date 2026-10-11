import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiAccessAudits } from "@/db/schema";
import type { AiAccessResults } from "@/server/lib/ai-access/types";

export const AiAccessAuditRepository = {
  async create(data: {
    id: string;
    projectId: string;
    startedByUserId: string;
    startUrl: string;
    workflowInstanceId: string;
  }) {
    await db
      .insert(aiAccessAudits)
      .values({ ...data, createdAt: new Date().toISOString() });
  },
  async getForProject(projectId: string, auditId: string) {
    return (
      (
        await db
          .select()
          .from(aiAccessAudits)
          .where(
            and(
              eq(aiAccessAudits.projectId, projectId),
              eq(aiAccessAudits.id, auditId),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  },
  async getLatestForProject(projectId: string) {
    return (
      (
        await db
          .select()
          .from(aiAccessAudits)
          .where(eq(aiAccessAudits.projectId, projectId))
          .orderBy(desc(aiAccessAudits.createdAt))
          .limit(1)
      )[0] ?? null
    );
  },
  async markCompleted(
    auditId: string,
    projectId: string,
    data: {
      overallScore: number;
      jsScore: number;
      llmTxtScore: number;
      robotsScore: number;
      schemaScore: number;
      results: AiAccessResults;
    },
  ) {
    await db
      .update(aiAccessAudits)
      .set({
        ...data,
        results: JSON.stringify(data.results),
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(aiAccessAudits.id, auditId),
          eq(aiAccessAudits.projectId, projectId),
        ),
      );
  },
  async markFailed(
    auditId: string,
    projectId: string,
    errorCode: "FETCH_FAILED" | "INTERNAL_ERROR",
    errorDetail: string,
  ) {
    await db
      .update(aiAccessAudits)
      .set({
        status: "failed",
        errorCode,
        errorDetail,
        completedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(aiAccessAudits.id, auditId),
          eq(aiAccessAudits.projectId, projectId),
        ),
      );
  },
};
