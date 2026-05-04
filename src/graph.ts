/**
 * Wrapper minimal Microsoft Graph API pour To Do.
 * Endpoints : https://learn.microsoft.com/en-us/graph/api/resources/todo-overview
 */
import { getAccessToken } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status} ${res.statusText} on ${path}: ${body}`);
  }
  // DELETE renvoie 204 sans body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─── Types Graph (simplifiés) ──────────────────────────────────────────────

export interface TodoTaskList {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName?: "none" | "defaultList" | "flaggedEmails" | "unknownFutureValue";
}

export interface TodoTask {
  id: string;
  title: string;
  body?: { content: string; contentType: "text" | "html" };
  status: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred";
  importance: "low" | "normal" | "high";
  isReminderOn: boolean;
  reminderDateTime?: { dateTime: string; timeZone: string };
  dueDateTime?: { dateTime: string; timeZone: string };
  createdDateTime: string;
  lastModifiedDateTime: string;
  categories?: string[];
}

interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

// ─── API ───────────────────────────────────────────────────────────────────

export async function listTaskLists(): Promise<TodoTaskList[]> {
  const data = await graphFetch<GraphCollection<TodoTaskList>>("/me/todo/lists");
  return data.value;
}

export async function listTasks(
  listId: string,
  opts: { filter?: string; top?: number } = {}
): Promise<TodoTask[]> {
  const params = new URLSearchParams();
  if (opts.filter) params.set("$filter", opts.filter);
  if (opts.top) params.set("$top", String(opts.top));
  const qs = params.toString() ? `?${params}` : "";
  const data = await graphFetch<GraphCollection<TodoTask>>(
    `/me/todo/lists/${listId}/tasks${qs}`
  );
  return data.value;
}

export async function createTask(
  listId: string,
  task: {
    title: string;
    body?: string;
    importance?: TodoTask["importance"];
    dueDateTime?: string; // ISO
    timeZone?: string;
    categories?: string[];
  }
): Promise<TodoTask> {
  const payload: any = {
    title: task.title,
    importance: task.importance ?? "normal",
  };
  if (task.body) payload.body = { content: task.body, contentType: "text" };
  if (task.dueDateTime) {
    payload.dueDateTime = {
      dateTime: task.dueDateTime,
      timeZone: task.timeZone ?? "Europe/Paris",
    };
  }
  if (task.categories) payload.categories = task.categories;

  return graphFetch<TodoTask>(`/me/todo/lists/${listId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  listId: string,
  taskId: string,
  patch: Partial<{
    title: string;
    status: TodoTask["status"];
    importance: TodoTask["importance"];
    body: string;
    dueDateTime: string;
    timeZone: string;
  }>
): Promise<TodoTask> {
  const payload: any = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.importance !== undefined) payload.importance = patch.importance;
  if (patch.body !== undefined)
    payload.body = { content: patch.body, contentType: "text" };
  if (patch.dueDateTime !== undefined) {
    payload.dueDateTime = {
      dateTime: patch.dueDateTime,
      timeZone: patch.timeZone ?? "Europe/Paris",
    };
  }
  return graphFetch<TodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteTask(listId: string, taskId: string): Promise<void> {
  await graphFetch<void>(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function completeTask(
  listId: string,
  taskId: string
): Promise<TodoTask> {
  return updateTask(listId, taskId, { status: "completed" });
}
