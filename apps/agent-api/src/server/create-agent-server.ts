import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import type { SqlClientLike } from "../modules/persistence/postgres-client.js";
import type { UserRepository } from "../modules/persistence/user-repository.js";
import { CloudAgentSession } from "./cloud-agent-session.js";
import type { CloudClientEvent, CloudServerEvent } from "./protocol.js";
import {
  issueJudgeSessionToken,
  verifyJudgeSessionToken
} from "./judge-auth.js";

export interface AgentSessionLike {
  start(): Promise<void>;
  handleClientEvent(event: CloudClientEvent): Promise<void>;
  close(reason?: "user_hangup" | "client_disconnect" | "startup_failed"): Promise<void>;
}

export interface JudgeUserConfig {
  passcode: string;
  email: string;
  displayName: string;
}

export interface CreateAgentServerOptions {
  port: number;
  sql?: SqlClientLike;
  userRepository: Pick<UserRepository, "getByEmail" | "create">;
  judgePasscode?: string;
  judgeTokenSecret: string;
  judgeUserEmail?: string;
  judgeUserDisplayName?: string;
  judgeUsers?: JudgeUserConfig[];
  judgeSessionTtlSeconds: number;
  createSession?: (input: {
    brainSessionId: string;
    userId: string;
    sql?: SqlClientLike;
    send: (event: CloudServerEvent) => void;
    onClose?: () => void;
  }) => AgentSessionLike;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}

function getBaseUrl(req: IncomingMessage, port: number): URL {
  const protoHeader =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ||
    "http";
  const host = req.headers.host || `127.0.0.1:${port}`;
  return new URL(`${protoHeader}://${host}`);
}

export function createAgentServer(options: CreateAgentServerOptions) {
  const sessions = new Map<string, AgentSessionLike>();
  const createSession =
    options.createSession ??
    ((input: {
      brainSessionId: string;
      userId: string;
      sql?: SqlClientLike;
      send: (event: CloudServerEvent) => void;
      onClose?: () => void;
    }) => new CloudAgentSession(input));

  function resolveJudgeUser(passcode: string): JudgeUserConfig | null {
    const configuredUsers =
      options.judgeUsers?.filter(
        (user) => user.passcode.trim() && user.email.trim() && user.displayName.trim()
      ) ?? [];
    if (configuredUsers.length > 0) {
      return (
        configuredUsers.find((user) => user.passcode.trim() === passcode.trim()) ?? null
      );
    }

    if (
      options.judgePasscode?.trim() &&
      options.judgeUserEmail?.trim() &&
      options.judgeUserDisplayName?.trim() &&
      options.judgePasscode.trim() === passcode.trim()
    ) {
      return {
        passcode: options.judgePasscode.trim(),
        email: options.judgeUserEmail.trim(),
        displayName: options.judgeUserDisplayName.trim()
      };
    }

    return null;
  }

  async function ensureJudgeUser(
    judgeUserConfig: JudgeUserConfig
  ): Promise<{ id: string; email: string }> {
    const existing = await options.userRepository.getByEmail(judgeUserConfig.email);
    if (existing) {
      return {
        id: existing.id,
        email: existing.email
      };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    await options.userRepository.create({
      id,
      email: judgeUserConfig.email,
      displayName: judgeUserConfig.displayName,
      createdAt: now,
      updatedAt: now
    });

    return {
      id,
      email: judgeUserConfig.email
    };
  }

  const server = createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type,authorization");
      res.end();
      return;
    }

    const url = new URL(req.url, getBaseUrl(req, options.port));

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/judge/session") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      let body: { passcode?: string } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          passcode?: string;
        };
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const judgeUserConfig = resolveJudgeUser(body.passcode?.trim() ?? "");
      if (!judgeUserConfig) {
        sendJson(res, 401, { error: "Invalid passcode" });
        return;
      }

      const judgeUser = await ensureJudgeUser(judgeUserConfig);
      const brainSessionId = `judge-session-${Date.now()}`;
      const exp = Math.floor(Date.now() / 1000) + options.judgeSessionTtlSeconds;
      const token = issueJudgeSessionToken(
        {
          brainSessionId,
          userId: judgeUser.id,
          exp
        },
        options.judgeTokenSecret
      );
      const baseUrl = getBaseUrl(req, options.port);
      const wsProtocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";

      sendJson(res, 200, {
        token,
        brainSessionId,
        expiresAt: new Date(exp * 1000).toISOString(),
        wsUrl: `${wsProtocol}//${baseUrl.host}/ws`
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  const webSocketServer = new WebSocketServer({
    noServer: true
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ? new URL(req.url, getBaseUrl(req, options.port)) : null;
    if (!url || url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(req, socket, head, (ws: any) => {
      webSocketServer.emit("connection", ws, req);
    });
  });

  webSocketServer.on("connection", (ws: any) => {
    let session: AgentSessionLike | null = null;
    let authenticated = false;

    const send = (event: CloudServerEvent) => {
      if (ws.readyState !== ws.OPEN) {
        return;
      }
      ws.send(JSON.stringify(event));
    };

    ws.on("message", async (raw: Buffer) => {
      let message: CloudClientEvent;
      try {
        message = JSON.parse(String(raw)) as CloudClientEvent;
      } catch {
        send({
          type: "error",
          message: "Invalid WebSocket payload"
        });
        return;
      }

      if (!authenticated) {
        if (message.type !== "auth") {
          send({
            type: "error",
            code: "unauthenticated",
            message: "Authenticate first"
          });
          return;
        }

        const payload = verifyJudgeSessionToken(
          message.token,
          options.judgeTokenSecret
        );
        if (!payload) {
          send({
            type: "error",
            code: "unauthorized",
            message: "Invalid or expired judge session token"
          });
          ws.close(4001, "unauthorized");
          return;
        }

        authenticated = true;
        session = createSession({
          brainSessionId: payload.brainSessionId,
          userId: payload.userId,
          sql: options.sql,
          send,
          onClose: () => {
            sessions.delete(payload.brainSessionId);
          }
        });
        sessions.set(payload.brainSessionId, session);

        try {
          await session.start();
        } catch (error) {
          await session.close("startup_failed");
          send({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Failed to start cloud session"
          });
          ws.close(1011, "startup_failed");
        }
        return;
      }

      if (message?.type === "end_session") {
        await session?.close(message.reason ?? "user_hangup");
        ws.close(1000, "session_ended");
        return;
      }

      try {
        await session?.handleClientEvent(message);
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Session event failed"
        });
      }
    });

    ws.on("close", () => {
      void session?.close("client_disconnect");
    });
  });

  return {
    server,
    webSocketServer
  };
}
