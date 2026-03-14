import type { TaskExecutionArtifact } from "@agent/shared-types";
import type { SqlClientLike } from "./postgres-client.js";
import { normalizePostgresTimestamp } from "./postgres-value-normalizer.js";

export interface TaskExecutionArtifactRepository {
  listByTaskId(taskId: string): Promise<TaskExecutionArtifact[]>;
  saveMany(taskId: string, artifacts: TaskExecutionArtifact[]): Promise<void>;
}

export class InMemoryTaskExecutionArtifactRepository
  implements TaskExecutionArtifactRepository
{
  private readonly artifacts = new Map<string, TaskExecutionArtifact[]>();

  async listByTaskId(taskId: string): Promise<TaskExecutionArtifact[]> {
    return this.artifacts.get(taskId) ?? [];
  }

  async saveMany(
    taskId: string,
    artifacts: TaskExecutionArtifact[]
  ): Promise<void> {
    const current = this.artifacts.get(taskId) ?? [];
    const next = artifacts.map((artifact, index) => ({
      ...artifact,
      seq: current.length + index
    }));
    this.artifacts.set(taskId, [...current, ...next]);
  }
}

export class PostgresTaskExecutionArtifactRepository
  implements TaskExecutionArtifactRepository
{
  constructor(private readonly sql: SqlClientLike) {}

  async listByTaskId(taskId: string): Promise<TaskExecutionArtifact[]> {
    const result = await this.sql.query<{
      task_id: string;
      seq: number;
      kind: TaskExecutionArtifact["kind"];
      created_at: string | Date;
      title: string;
      body: string | null;
      detail: string | null;
      tool_name: string | null;
      status: string | null;
      role: string | null;
      payload_json: Record<string, unknown> | null;
    }>(
      `
        select
          task_id,
          seq,
          kind,
          created_at,
          title,
          body,
          detail,
          tool_name,
          status,
          role,
          payload_json
        from task_execution_artifacts
        where task_id = $1
        order by seq asc, created_at asc
      `,
      [taskId]
    );

    return result.rows.map((row) => ({
      taskId: row.task_id,
      seq: row.seq,
      kind: row.kind,
      createdAt: normalizePostgresTimestamp(row.created_at)!,
      title: row.title,
      body: row.body ?? undefined,
      detail: row.detail ?? undefined,
      toolName: row.tool_name ?? undefined,
      status: row.status ?? undefined,
      role: row.role ?? undefined,
      payloadJson: row.payload_json ?? undefined
    }));
  }

  async saveMany(
    taskId: string,
    artifacts: TaskExecutionArtifact[]
  ): Promise<void> {
    const latestSeqResult = await this.sql.query<{ seq: number | null }>(
      `
        select max(seq) as seq
        from task_execution_artifacts
        where task_id = $1
      `,
      [taskId]
    );
    const seqOffset = (latestSeqResult.rows[0]?.seq ?? -1) + 1;

    for (const artifact of artifacts) {
      const storedSeq = seqOffset + artifact.seq;
      await this.sql.query(
        `
          insert into task_execution_artifacts (
            task_id,
            user_id,
            seq,
            kind,
            title,
            body,
            detail,
            tool_name,
            status,
            role,
            payload_json,
            created_at
          )
          select
            $1,
            t.user_id,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::jsonb,
            $11::timestamptz
          from tasks t
          where t.id = $1
          on conflict (task_id, seq) do update
          set
            kind = excluded.kind,
            title = excluded.title,
            body = excluded.body,
            detail = excluded.detail,
            tool_name = excluded.tool_name,
            status = excluded.status,
            role = excluded.role,
            payload_json = excluded.payload_json,
            created_at = excluded.created_at
        `,
        [
          taskId,
          storedSeq,
          artifact.kind,
          artifact.title,
          artifact.body ?? null,
          artifact.detail ?? null,
          artifact.toolName ?? null,
          artifact.status ?? null,
          artifact.role ?? null,
          artifact.payloadJson ? JSON.stringify(artifact.payloadJson) : "{}",
          artifact.createdAt
        ]
      );
    }
  }
}
