/**
 * Wrapper Microsoft Graph API pour To Do.
 * Endpoints : https://learn.microsoft.com/en-us/graph/api/resources/todo-overview
 */
import { getAccessToken } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ─── Types Graph ───────────────────────────────────────────────────────────

export interface TodoTaskList {
  id: string;
  displayName: string;
  isOwner: boolean;
  isShared: boolean;
  wellknownListName?:
    | "none"
    | "defaultList"
    | "flaggedEmails"
    | "unknownFutureValue";
}

export type RecurrencePatternType =
  | "daily"
  | "weekly"
  | "absoluteMonthly"
  | "relativeMonthly"
  | "absoluteYearly"
  | "relativeYearly";

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface PatternedRecurrence {
  pattern: {
    type: RecurrencePatternType;
    interval: number;
    daysOfWeek?: DayOfWeek[];
    firstDayOfWeek?: DayOfWeek;
    dayOfMonth?: number;
    weekIndex?: "first" | "second" | "third" | "fourth" | "last";
    month?: number;
    index?: "first" | "second" | "third" | "fourth" | "last";
  };
  range: {
    type: "endDate" | "noEnd" | "numbered";
    startDate: string; // YYYY-MM-DD
    endDate?: string;
    numberOfOccurrences?: number;
    recurrenceTimeZone?: string;
  };
}

export interface TodoTask {
  id: string;
  title: string;
  body?: { content: string; contentType: "text" | "html" };
  status:
    | "notStarted"
    | "inProgress"
    | "completed"
    | "waitingOnOthers"
    | "deferred";
  importance: "low" | "normal" | "high";
  isReminderOn: boolean;
  reminderDateTime?: { dateTime: string; timeZone: string };
  dueDateTime?: { dateTime: string; timeZone: string };
  recurrence?: PatternedRecurrence;
  createdDateTime: string;
  lastModifiedDateTime: string;
  categories?: string[];
}

export interface ChecklistItem {
  id: string;
  displayName: string;
  isChecked: boolean;
  createdDateTime: string;
  checkedDateTime?: string;
}

export interface LinkedResource {
  id: string;
  webUrl?: string;
  applicationName?: string;
  displayName?: string;
  externalId?: string;
}

interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

interface GraphErrorBody {
  error?: {
    code?: string;
    message?: string;
    innerError?: Record<string, unknown>;
  };
}

// ─── HTTP helpers (retry, error parsing) ───────────────────────────────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function graphFetch<T>(
  path: string,
  init: RequestInit = {},
  attempt = 0
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

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // 401 : tente une fois de re-acquérir un token (cache potentiellement périmé)
  if (res.status === 401 && attempt === 0) {
    await getAccessToken(true);
    return graphFetch<T>(path, init, attempt + 1);
  }

  // 429 / 5xx : retry exponentiel borné
  const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
  if (retryable && attempt < MAX_RETRIES) {
    const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    const backoff = retryAfter ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
    await sleep(backoff);
    return graphFetch<T>(path, init, attempt + 1);
  }

  // Erreur définitive : parse le body Graph pour message lisible
  const rawBody = await res.text();
  let detail = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as GraphErrorBody;
    if (parsed.error) {
      detail = parsed.error.code
        ? `${parsed.error.code}: ${parsed.error.message ?? "(no message)"}`
        : (parsed.error.message ?? rawBody);
    }
  } catch {
    // body non-JSON, on garde le raw
  }
  throw new Error(`Graph ${res.status} on ${path} — ${detail}`);
}

// ─── Lists ─────────────────────────────────────────────────────────────────

// Champs minimums utiles renvoyés par défaut (économie tokens + bande passante)
const DEFAULT_LIST_SELECT = "id,displayName,isOwner,isShared,wellknownListName";
const DEFAULT_TASK_SELECT =
  "id,title,status,importance,dueDateTime,reminderDateTime,isReminderOn,categories,recurrence,body";
const DEFAULT_CHECKLIST_SELECT = "id,displayName,isChecked";
const DEFAULT_LINKED_SELECT = "id,webUrl,applicationName,displayName,externalId";

export async function listTaskLists(opts: { select?: string } = {}): Promise<
  TodoTaskList[]
> {
  const select = opts.select ?? DEFAULT_LIST_SELECT;
  const data = await graphFetch<GraphCollection<TodoTaskList>>(
    `/me/todo/lists?$select=${encodeURIComponent(select)}`
  );
  return data.value;
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  body?: string;
  importance?: TodoTask["importance"];
  dueDateTime?: string; // ISO
  timeZone?: string;
  categories?: string[];
  recurrence?: PatternedRecurrence;
  isReminderOn?: boolean;
  reminderDateTime?: string; // ISO
  reminderTimeZone?: string;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TodoTask["status"];
  importance?: TodoTask["importance"];
  body?: string;
  dueDateTime?: string;
  timeZone?: string;
  categories?: string[];
  recurrence?: PatternedRecurrence | null; // null = clear recurrence
  isReminderOn?: boolean;
  reminderDateTime?: string;
  reminderTimeZone?: string;
}

function buildTaskPayload(input: CreateTaskInput | UpdateTaskInput): Record<string, unknown> {
  const tz = input.timeZone ?? "Europe/Paris";
  const reminderTz = input.reminderTimeZone ?? tz;
  const payload: Record<string, unknown> = {};
  if ("title" in input && input.title !== undefined) payload.title = input.title;
  if ("status" in input && input.status !== undefined) payload.status = input.status;
  if (input.importance !== undefined) payload.importance = input.importance;
  if (input.body !== undefined) {
    payload.body = { content: input.body, contentType: "text" };
  }
  if (input.dueDateTime !== undefined) {
    payload.dueDateTime = { dateTime: input.dueDateTime, timeZone: tz };
  }
  if (input.categories !== undefined) payload.categories = input.categories;
  if (input.isReminderOn !== undefined) payload.isReminderOn = input.isReminderOn;
  if (input.reminderDateTime !== undefined) {
    payload.reminderDateTime = {
      dateTime: input.reminderDateTime,
      timeZone: reminderTz,
    };
  }
  if ("recurrence" in input && input.recurrence !== undefined) {
    payload.recurrence = input.recurrence;
  }
  return payload;
}

export async function listTasks(
  listId: string,
  opts: { filter?: string; top?: number; orderby?: string; select?: string } = {}
): Promise<TodoTask[]> {
  const params = new URLSearchParams();
  if (opts.filter) params.set("$filter", opts.filter);
  if (opts.top) params.set("$top", String(opts.top));
  if (opts.orderby) params.set("$orderby", opts.orderby);
  params.set("$select", opts.select ?? DEFAULT_TASK_SELECT);
  const data = await graphFetch<GraphCollection<TodoTask>>(
    `/me/todo/lists/${listId}/tasks?${params}`
  );
  return data.value;
}

export async function getTask(
  listId: string,
  taskId: string,
  opts: { select?: string } = {}
): Promise<TodoTask> {
  const select = opts.select ?? DEFAULT_TASK_SELECT;
  return graphFetch<TodoTask>(
    `/me/todo/lists/${listId}/tasks/${taskId}?$select=${encodeURIComponent(select)}`
  );
}

export async function createTask(
  listId: string,
  task: CreateTaskInput
): Promise<TodoTask> {
  const payload = buildTaskPayload(task);
  if (!payload.importance) payload.importance = "normal";
  return graphFetch<TodoTask>(`/me/todo/lists/${listId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  listId: string,
  taskId: string,
  patch: UpdateTaskInput
): Promise<TodoTask> {
  return graphFetch<TodoTask>(`/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(buildTaskPayload(patch)),
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

// ─── Move task entre listes (delete + recreate, Graph n'a pas de move natif) ──

export async function moveTask(
  sourceListId: string,
  taskId: string,
  targetListId: string
): Promise<TodoTask> {
  const original = await getTask(sourceListId, taskId);
  const recreated = await createTask(targetListId, {
    title: original.title,
    body: original.body?.content,
    importance: original.importance,
    dueDateTime: original.dueDateTime?.dateTime,
    timeZone: original.dueDateTime?.timeZone,
    categories: original.categories,
    recurrence: original.recurrence,
    isReminderOn: original.isReminderOn,
    reminderDateTime: original.reminderDateTime?.dateTime,
    reminderTimeZone: original.reminderDateTime?.timeZone,
  });
  if (original.status === "completed") {
    await completeTask(targetListId, recreated.id);
  }
  await deleteTask(sourceListId, taskId);
  return recreated;
}

// ─── Search cross-listes ───────────────────────────────────────────────────

export interface SearchResult {
  list: { id: string; displayName: string };
  task: TodoTask;
}

/**
 * Recherche un terme dans les titres des tâches non-complétées de toutes les listes.
 * Utilise $filter contains() — case-sensitive côté Graph. Inclus complétées si includeCompleted.
 */
export async function searchTasks(
  query: string,
  opts: { topPerList?: number; includeCompleted?: boolean } = {}
): Promise<SearchResult[]> {
  const lists = await listTaskLists();
  const top = opts.topPerList ?? 25;
  const escaped = query.replace(/'/g, "''");
  const filterParts = [`contains(title,'${escaped}')`];
  if (!opts.includeCompleted) filterParts.push("status ne 'completed'");
  const filter = filterParts.join(" and ");

  const results = await Promise.all(
    lists.map(async (list) => {
      try {
        const tasks = await listTasks(list.id, { filter, top });
        return tasks.map((task) => ({
          list: { id: list.id, displayName: list.displayName },
          task,
        }));
      } catch {
        // Une liste qui échoue (ex : permissions) ne casse pas la recherche globale
        return [];
      }
    })
  );
  return results.flat();
}

// ─── Summarize today ───────────────────────────────────────────────────────

export interface DailySummary {
  date: string; // YYYY-MM-DD
  totalDueToday: number;
  totalOverdue: number;
  byList: Array<{
    list: { id: string; displayName: string };
    dueToday: TodoTask[];
    overdue: TodoTask[];
  }>;
}

export async function summarizeToday(timeZone = "Europe/Paris"): Promise<DailySummary> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const startOfTomorrow = new Date(now);
  startOfTomorrow.setUTCHours(24, 0, 0, 0);
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  const lists = await listTaskLists();
  const byList = await Promise.all(
    lists.map(async (list) => {
      const tasks = await listTasks(list.id, {
        filter: `status ne 'completed' and dueDateTime/dateTime lt '${startOfTomorrow.toISOString()}'`,
        top: 100,
      });
      const dueToday: TodoTask[] = [];
      const overdue: TodoTask[] = [];
      for (const t of tasks) {
        if (!t.dueDateTime) continue;
        const due = new Date(t.dueDateTime.dateTime);
        if (due >= startOfToday && due < startOfTomorrow) dueToday.push(t);
        else if (due < startOfToday) overdue.push(t);
      }
      return { list: { id: list.id, displayName: list.displayName }, dueToday, overdue };
    })
  );
  const totalDueToday = byList.reduce((s, l) => s + l.dueToday.length, 0);
  const totalOverdue = byList.reduce((s, l) => s + l.overdue.length, 0);
  void timeZone; // accepté pour cohérence d'API ; date "today" déduite de now en UTC
  return { date: today, totalDueToday, totalOverdue, byList };
}

// ─── Checklists (sub-tasks) ────────────────────────────────────────────────

export async function listChecklistItems(
  listId: string,
  taskId: string,
  opts: { select?: string } = {}
): Promise<ChecklistItem[]> {
  const select = opts.select ?? DEFAULT_CHECKLIST_SELECT;
  const data = await graphFetch<GraphCollection<ChecklistItem>>(
    `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems?$select=${encodeURIComponent(select)}`
  );
  return data.value;
}

export async function createChecklistItem(
  listId: string,
  taskId: string,
  displayName: string,
  isChecked = false
): Promise<ChecklistItem> {
  return graphFetch<ChecklistItem>(
    `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems`,
    {
      method: "POST",
      body: JSON.stringify({ displayName, isChecked }),
    }
  );
}

export async function updateChecklistItem(
  listId: string,
  taskId: string,
  itemId: string,
  patch: { displayName?: string; isChecked?: boolean }
): Promise<ChecklistItem> {
  return graphFetch<ChecklistItem>(
    `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteChecklistItem(
  listId: string,
  taskId: string,
  itemId: string
): Promise<void> {
  await graphFetch<void>(
    `/me/todo/lists/${listId}/tasks/${taskId}/checklistItems/${itemId}`,
    { method: "DELETE" }
  );
}

// ─── Linked resources (références externes attachées à une tâche) ──────────

export async function listLinkedResources(
  listId: string,
  taskId: string,
  opts: { select?: string } = {}
): Promise<LinkedResource[]> {
  const select = opts.select ?? DEFAULT_LINKED_SELECT;
  const data = await graphFetch<GraphCollection<LinkedResource>>(
    `/me/todo/lists/${listId}/tasks/${taskId}/linkedResources?$select=${encodeURIComponent(select)}`
  );
  return data.value;
}

export async function createLinkedResource(
  listId: string,
  taskId: string,
  resource: {
    webUrl?: string;
    applicationName?: string;
    displayName?: string;
    externalId?: string;
  }
): Promise<LinkedResource> {
  return graphFetch<LinkedResource>(
    `/me/todo/lists/${listId}/tasks/${taskId}/linkedResources`,
    {
      method: "POST",
      body: JSON.stringify(resource),
    }
  );
}

export async function deleteLinkedResource(
  listId: string,
  taskId: string,
  resourceId: string
): Promise<void> {
  await graphFetch<void>(
    `/me/todo/lists/${listId}/tasks/${taskId}/linkedResources/${resourceId}`,
    { method: "DELETE" }
  );
}
