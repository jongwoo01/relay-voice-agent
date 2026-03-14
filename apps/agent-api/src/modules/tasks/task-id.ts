export type TaskIdGenerator = () => string;

export function createTaskId(): string {
  return `task-${crypto.randomUUID()}`;
}
