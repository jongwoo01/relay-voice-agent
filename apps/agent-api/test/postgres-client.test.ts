import { describe, expect, it } from "vitest";
import {
  hasPostgresConnectionConfig,
  resolvePostgresPoolConfig
} from "../src/modules/persistence/postgres-client.js";

describe("postgres-client", () => {
  it("accepts DATABASE_URL configuration", () => {
    expect(
      hasPostgresConnectionConfig({
        DATABASE_URL: "postgres://user:password@127.0.0.1:5432/app"
      })
    ).toBe(true);

    expect(
      resolvePostgresPoolConfig(
        {},
        {
          DATABASE_URL: "postgres://user:password@127.0.0.1:5432/app"
        }
      )
    ).toEqual({
      connectionString: "postgres://user:password@127.0.0.1:5432/app",
      ssl: undefined
    });
  });

  it("accepts discrete PG* environment variables", () => {
    expect(
      hasPostgresConnectionConfig({
        PGHOST: "/cloudsql/project:region:instance",
        PGUSER: "agent_user",
        PGDATABASE: "gemini_live_agent"
      })
    ).toBe(true);

    expect(
      resolvePostgresPoolConfig(
        {},
        {
          PGHOST: "/cloudsql/project:region:instance",
          PGPORT: "5432",
          PGUSER: "agent_user",
          PGPASSWORD: "secret",
          PGDATABASE: "gemini_live_agent"
        }
      )
    ).toEqual({
      host: "/cloudsql/project:region:instance",
      port: 5432,
      user: "agent_user",
      password: "secret",
      database: "gemini_live_agent",
      ssl: undefined
    });
  });

  it("rejects incomplete discrete PG* configuration", () => {
    expect(
      hasPostgresConnectionConfig({
        PGHOST: "/cloudsql/project:region:instance",
        PGUSER: "agent_user"
      })
    ).toBe(false);

    expect(() =>
      resolvePostgresPoolConfig(
        {},
        {
          PGHOST: "/cloudsql/project:region:instance",
          PGUSER: "agent_user"
        }
      )
    ).toThrow("DATABASE_URL or PGHOST/PGUSER/PGDATABASE is required");
  });
});
