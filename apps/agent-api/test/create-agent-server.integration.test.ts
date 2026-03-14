import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createAgentServer } from "../src/server/create-agent-server.js";
import type { CloudServerEvent } from "../src/server/protocol.js";

function createConversationState() {
  return {
    connected: true,
    connecting: false,
    status: "listening",
    muted: false,
    error: null,
    routing: {
      mode: "idle",
      summary: "ready",
      detail: ""
    },
    conversationTimeline: [],
    conversationTurns: [],
    activeTurnId: null,
    inputPartial: "",
    lastUserTranscript: "",
    outputTranscript: ""
  };
}

function createTaskState() {
  return {
    tasks: [],
    recentTasks: [],
    taskTimelines: [],
    intake: {
      active: false,
      missingSlots: [],
      lastQuestion: null,
      workingText: ""
    },
    notifications: {
      delivered: [],
      pending: []
    },
    pendingBriefingCount: 0,
    avatar: {
      mainState: "idle" as const,
      taskRunners: []
    }
  };
}

async function listen(server: ReturnType<typeof createAgentServer>["server"]): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createAgentServer>["server"]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    (socket as any).once("message", (raw: any) => {
      resolve(JSON.parse(String(raw)));
    });
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    (socket as any).once("close", (code: number, reason: Buffer) => {
      resolve({
        code,
        reason: reason.toString()
      });
    });
  });
}

describe("createAgentServer", () => {
  const servers = new Set<ReturnType<typeof createAgentServer>["server"]>();

  afterEach(async () => {
    await Promise.all(
      [...servers].map(async (server) => {
        servers.delete(server);
        if (server.listening) {
          await closeServer(server);
        }
      })
    );
  });

  it("rejects an invalid judge passcode", async () => {
    const serverBundle = createAgentServer({
      port: 8080,
      userRepository: {
        getByEmail: vi.fn(async () => null),
        create: vi.fn(async () => undefined)
      },
      judgePasscode: "correct-passcode",
      judgeTokenSecret: "secret",
      judgeUserEmail: "judge@example.com",
      judgeUserDisplayName: "Judge",
      judgeSessionTtlSeconds: 3600
    });
    servers.add(serverBundle.server);
    const baseUrl = await listen(serverBundle.server);

    const response = await fetch(`${baseUrl}/judge/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        passcode: "wrong-passcode"
      })
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid passcode"
    });
  });

  it("maps different judge passcodes to different users", async () => {
    const createdUsers: Array<{ email: string; displayName: string }> = [];
    const create = vi.fn(
      async (user: { email: string; displayName?: string }) => {
        createdUsers.push({
          email: user.email,
          displayName: user.displayName ?? ""
        });
      }
    );
    const getByEmail = vi.fn(async (email: string) => {
      if (email === "judge-one@example.com") {
        return null;
      }

      if (email === "judge-two@example.com") {
        return null;
      }

      return null;
    });
    const seenUsers: string[] = [];
    const serverBundle = createAgentServer({
      port: 8080,
      userRepository: {
        getByEmail,
        create
      },
      judgeTokenSecret: "secret",
      judgeSessionTtlSeconds: 3600,
      judgeUsers: [
        {
          passcode: "judge-one-passcode",
          email: "judge-one@example.com",
          displayName: "Judge One"
        },
        {
          passcode: "judge-two-passcode",
          email: "judge-two@example.com",
          displayName: "Judge Two"
        }
      ],
      createSession: ({ userId, send }) => ({
        start: async () => {
          seenUsers.push(userId);
          send({
            type: "session_ready",
            brainSessionId: "brain-test",
            conversation: createConversationState(),
            tasks: createTaskState()
          });
        },
        handleClientEvent: async () => undefined,
        close: async () => undefined
      })
    });
    servers.add(serverBundle.server);
    const baseUrl = await listen(serverBundle.server);

    for (const passcode of ["judge-one-passcode", "judge-two-passcode"]) {
      const response = await fetch(`${baseUrl}/judge/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ passcode })
      });
      const payload = (await response.json()) as {
        token: string;
        wsUrl: string;
      };

      const socket = new WebSocket(payload.wsUrl);
      await new Promise<void>((resolve) => {
        socket.once("open", () => resolve());
      });
      socket.send(
        JSON.stringify({
          type: "auth",
          token: payload.token
        })
      );
      await waitForMessage(socket);
      socket.close();
      await waitForClose(socket);
    }

    expect(create).toHaveBeenCalledTimes(2);
    expect(createdUsers.at(0)).toMatchObject({
      email: "judge-one@example.com",
      displayName: "Judge One"
    });
    expect(createdUsers.at(1)).toMatchObject({
      email: "judge-two@example.com",
      displayName: "Judge Two"
    });
    expect(seenUsers).toHaveLength(2);
    expect(seenUsers[0]).not.toBe(seenUsers[1]);
  });

  it("authenticates a websocket session and sends session_ready", async () => {
    const sessionStart = vi.fn(async (send: (event: CloudServerEvent) => void) => {
      send({
        type: "session_ready",
        brainSessionId: "brain-test",
        conversation: createConversationState(),
        tasks: createTaskState()
      });
    });
    const sessionHandle = vi.fn(async () => undefined);
    const sessionClose = vi.fn(async () => undefined);
    const serverBundle = createAgentServer({
      port: 8080,
      userRepository: {
        getByEmail: vi.fn(async () => null),
        create: vi.fn(async () => undefined)
      },
      judgePasscode: "correct-passcode",
      judgeTokenSecret: "secret",
      judgeUserEmail: "judge@example.com",
      judgeUserDisplayName: "Judge",
      judgeSessionTtlSeconds: 3600,
      createSession: ({ send }) => ({
        start: async () => sessionStart(send),
        handleClientEvent: sessionHandle,
        close: sessionClose
      })
    });
    servers.add(serverBundle.server);
    const baseUrl = await listen(serverBundle.server);

    const response = await fetch(`${baseUrl}/judge/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        passcode: "correct-passcode"
      })
    });
    const payload = (await response.json()) as {
      token: string;
      wsUrl: string;
    };

    const socket = new WebSocket(payload.wsUrl);
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });

    socket.send(
      JSON.stringify({
        type: "auth",
        token: payload.token
      })
    );

    await expect(waitForMessage(socket)).resolves.toEqual({
      type: "session_ready",
      brainSessionId: "brain-test",
      conversation: createConversationState(),
      tasks: createTaskState()
    });
    expect(sessionStart).toHaveBeenCalledTimes(1);

    socket.close();
    await waitForClose(socket);
  });

  it("treats end_session as an explicit user hangup", async () => {
    const sessionClose = vi.fn(async () => undefined);
    const serverBundle = createAgentServer({
      port: 8080,
      userRepository: {
        getByEmail: vi.fn(async () => null),
        create: vi.fn(async () => undefined)
      },
      judgePasscode: "correct-passcode",
      judgeTokenSecret: "secret",
      judgeUserEmail: "judge@example.com",
      judgeUserDisplayName: "Judge",
      judgeSessionTtlSeconds: 3600,
      createSession: ({ send }) => ({
        start: async () => {
          send({
            type: "session_ready",
            brainSessionId: "brain-test",
            conversation: createConversationState(),
            tasks: createTaskState()
          });
        },
        handleClientEvent: vi.fn(async () => undefined),
        close: sessionClose
      })
    });
    servers.add(serverBundle.server);
    const baseUrl = await listen(serverBundle.server);

    const response = await fetch(`${baseUrl}/judge/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        passcode: "correct-passcode"
      })
    });
    const payload = (await response.json()) as {
      token: string;
      wsUrl: string;
    };

    const socket = new WebSocket(payload.wsUrl);
    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });

    socket.send(
      JSON.stringify({
        type: "auth",
        token: payload.token
      })
    );
    await waitForMessage(socket);

    socket.send(
      JSON.stringify({
        type: "end_session",
        reason: "user_hangup"
      })
    );

    await expect(waitForClose(socket)).resolves.toEqual({
      code: 1000,
      reason: "session_ended"
    });
    expect(sessionClose).toHaveBeenCalledWith("user_hangup");
  });

  it("rejects websocket auth when the token is invalid", async () => {
    const serverBundle = createAgentServer({
      port: 8080,
      userRepository: {
        getByEmail: vi.fn(async () => null),
        create: vi.fn(async () => undefined)
      },
      judgePasscode: "correct-passcode",
      judgeTokenSecret: "secret",
      judgeUserEmail: "judge@example.com",
      judgeUserDisplayName: "Judge",
      judgeSessionTtlSeconds: 3600
    });
    servers.add(serverBundle.server);
    const baseUrl = await listen(serverBundle.server);
    const wsUrl = baseUrl.replace("http://", "ws://") + "/ws";
    const socket = new WebSocket(wsUrl);

    await new Promise<void>((resolve) => {
      socket.once("open", () => resolve());
    });

    const messagePromise = waitForMessage(socket);
    const closePromise = waitForClose(socket);
    socket.send(
      JSON.stringify({
        type: "auth",
        token: "invalid-token"
      })
    );

    await expect(messagePromise).resolves.toEqual({
      type: "error",
      code: "unauthorized",
      message: "Invalid or expired judge session token"
    });
    await expect(closePromise).resolves.toEqual({
      code: 4001,
      reason: "unauthorized"
    });
  });
});
