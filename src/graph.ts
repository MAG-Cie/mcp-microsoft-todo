/**
 * Microsoft Graph API wrapper for To Do.
 * Endpoints: https://learn.microsoft.com/en-us/graph/api/resources/todo-overview
 */
import { getAccessToken } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Defense in depth: encode any user-provided ID before interpolating into URLs.
const enc = encodeURIComponent;

// ─── Graph types ───────────────────────────────────────────────────────────

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

  // 401: try once to re-acquire a token (cache may be stale)
  if (res.status === 401 && attempt === 0) {
    await getAccessToken(true);
    return graphFetch<T>(path, init, attempt + 1);
  }

  // 429 / 5xx: bounded exponential retry
  const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
  if (retryable && attempt < MAX_RETRIES) {
    const retryAfter = parseRetryAfterMs(res.headers.get("retry-after"));
    const backoff = retryAfter ?? BASE_BACKOFF_MS * Math.pow(2, attempt);
    await sleep(backoff);
    return graphFetch<T>(path, init, attempt + 1);
  }

  // Definitive error: parse the Graph body for a readable message
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
    // non-JSON body, keep the raw
  }
  throw new Error(`Graph ${res.status} on ${path} — ${detail}`);
}

// ─── Pagination + batch helpers ────────────────────────────────────────────

// Minimum useful fields returned by default (token + bandwidth savings)
const DEFAULT_LIST_SELECT = "id,displayName,isOwner,isShared,wellknownListName";
const DEFAULT_TASK_SELECT =
  "id,title,status,importance,dueDateTime,reminderDateTime,isReminderOn,categories,recurrence,body";
const DEFAULT_CHECKLIST_SELECT = "id,displayName,isChecked";
const DEFAULT_LINKED_SELECT = "id,webUrl,applicationName,displayName,externalId";

const MAX_PAGES = 20; // safety cap (20 × default 100 items = 2000 max); LLM token-conscious
const BATCH_LIMIT = 20;

async function paginateAll<T>(firstPath: string): Promise<T[]> {
  const items: T[] = [];
  let path: string | null = firstPath;
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const data: GraphCollection<T> = await graphFetch<GraphCollection<T>>(path);
    items.push(...data.value);
    const next = data["@odata.nextLink"];
    if (next) {
      const u = new URL(next);
      path = u.pathname.replace(/^\/v1\.0/, "") + u.search;
    } else {
      path = null;
    }
    pages++;
  }
  return items;
}

export interface BatchRequest {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface BatchResponse {
  id: string;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function graphBatch(
  requests: BatchRequest[]
): Promise<BatchResponse[]> {
  const all: BatchResponse[] = [];
  for (let i = 0; i < requests.length; i += BATCH_LIMIT) {
    const chunk = requests.slice(i, i + BATCH_LIMIT);
    const data = await graphFetch<{ responses: BatchResponse[] }>("/$batch", {
      method: "POST",
      body: JSON.stringify({
        requests: chunk.map((r) => ({
          id: r.id,
          method: r.method,
          url: r.url,
          headers: r.headers ?? { "Content-Type": "application/json" },
          ...(r.body !== undefined ? { body: r.body } : {}),
        })),
      }),
    });

    // Per-sub-response retry: Graph $batch returns HTTP 200 with throttled
    // sub-requests reported as status 429 (or 503) inside the body. The outer
    // graphFetch retry only sees the 200 wrapper, so we re-issue throttled
    // sub-requests individually here. graphFetch itself honors Retry-After
    // and applies bounded exponential backoff on the retry.
    const responses = data.responses;
    for (let j = 0; j < responses.length; j++) {
      const r = responses[j];
      const retryable = r.status === 429 || (r.status >= 500 && r.status < 600);
      if (!retryable) continue;
      const original = chunk.find((req) => req.id === r.id);
      if (!original) continue;
      try {
        const init: RequestInit = { method: original.method };
        if (original.headers) init.headers = original.headers;
        if (original.body !== undefined) {
          init.body = typeof original.body === "string"
            ? original.body
            : JSON.stringify(original.body);
        }
        const retryBody = await graphFetch<unknown>(original.url, init);
        responses[j] = {
          id: r.id,
          status: original.method === "POST" ? 201 : original.method === "DELETE" ? 204 : 200,
          body: retryBody,
        };
      } catch (err: any) {
        // Retries exhausted; surface a recognizable error in the sub-response body
        responses[j] = {
          id: r.id,
          status: r.status,
          body: {
            error: {
              code: "throttled",
              message: err?.message ?? "Throttled after retries",
            },
          },
        };
      }
    }
    all.push(...responses);
  }
  return all;
}

// ─── Lists ─────────────────────────────────────────────────────────────────

export async function listTaskLists(
  opts: { paginate?: boolean } = {}
): Promise<TodoTaskList[]> {
  // Note: Microsoft Graph rejects $select on /me/todo/lists for personal accounts
  // (RequestBroker--ParseUri 400). Payload is small (~few lists) so full projection is fine.
  const path = `/me/todo/lists`;
  if (opts.paginate) return paginateAll<TodoTaskList>(path);
  const data = await graphFetch<GraphCollection<TodoTaskList>>(path);
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

// Build a raw OData query string with literal $ prefix (Graph requires literal $,
// URLSearchParams encodes $ as %24 which some Graph endpoints reject).
// Encode a value for an OData query parameter. encodeURIComponent encodes characters
// (`,` `/` `(` `)` `'` `:`) that Microsoft Graph requires literal inside $select / $orderby / $filter.
// Restore those while keeping everything else (notably spaces, &, =) properly percent-encoded.
function encodeODataValue(v: string): string {
  return encodeURIComponent(v)
    .replace(/%2C/gi, ",")
    .replace(/%2F/gi, "/")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%27/gi, "'")
    .replace(/%3A/gi, ":");
}

function buildOData(opts: {
  filter?: string;
  top?: number;
  orderby?: string;
  select?: string;
}): string {
  const parts: string[] = [];
  if (opts.filter) parts.push(`$filter=${encodeODataValue(opts.filter)}`);
  if (opts.top) parts.push(`$top=${opts.top}`);
  if (opts.orderby) parts.push(`$orderby=${encodeODataValue(opts.orderby)}`);
  if (opts.select) parts.push(`$select=${encodeODataValue(opts.select)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export async function listTasks(
  listId: string,
  opts: {
    filter?: string;
    top?: number;
    orderby?: string;
    paginate?: boolean;
  } = {}
): Promise<TodoTask[]> {
  // Note: Microsoft Graph rejects $select on /me/todo/lists/{id}/tasks for personal
  // accounts (RequestBroker--ParseUri 400). $filter / $top / $orderby work fine.
  const qs = buildOData({
    filter: opts.filter,
    top: opts.top,
    orderby: opts.orderby,
  });
  const path = `/me/todo/lists/${enc(listId)}/tasks${qs}`;
  if (opts.paginate) return paginateAll<TodoTask>(path);
  const data = await graphFetch<GraphCollection<TodoTask>>(path);
  return data.value;
}

export async function getTask(
  listId: string,
  taskId: string
): Promise<TodoTask> {
  // Note: Microsoft Graph rejects $select on this endpoint for personal accounts.
  return graphFetch<TodoTask>(
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`
  );
}

export async function createTask(
  listId: string,
  task: CreateTaskInput
): Promise<TodoTask> {
  const payload = buildTaskPayload(task);
  if (!payload.importance) payload.importance = "normal";
  return graphFetch<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  listId: string,
  taskId: string,
  patch: UpdateTaskInput
): Promise<TodoTask> {
  return graphFetch<TodoTask>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "PATCH",
    body: JSON.stringify(buildTaskPayload(patch)),
  });
}

export async function deleteTask(listId: string, taskId: string): Promise<void> {
  await graphFetch<void>(`/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: "DELETE",
  });
}

export async function completeTask(
  listId: string,
  taskId: string
): Promise<TodoTask> {
  return updateTask(listId, taskId, { status: "completed" });
}

// ─── Move task across lists (delete + recreate, Graph has no native move) ────

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

// ─── Cross-list helper (uses $batch when many lists to reduce HTTP overhead) ─

const PARALLEL_THRESHOLD = 5;

async function fetchTasksAcrossLists(
  lists: TodoTaskList[],
  opts: { filter?: string; top?: number } = {}
): Promise<Array<{ list: TodoTaskList; tasks: TodoTask[]; error?: string }>> {
  const top = opts.top ?? 25;

  // Few lists: just parallelize direct calls (low HTTP overhead, MSAL refresh once)
  if (lists.length <= PARALLEL_THRESHOLD) {
    return Promise.all(
      lists.map(async (list) => {
        try {
          const tasks = await listTasks(list.id, { filter: opts.filter, top });
          return { list, tasks };
        } catch (err: any) {
          return { list, tasks: [] as TodoTask[], error: err.message ?? String(err) };
        }
      })
    );
  }

  // Many lists: 1 HTTP call via $batch (still chunked by 20 internally)
  // No $select: rejected by Graph on tasks collection for personal accounts.
  const qs = buildOData({
    filter: opts.filter,
    top,
  });
  const requests: BatchRequest[] = lists.map((list, idx) => ({
    id: String(idx),
    method: "GET",
    url: `/me/todo/lists/${enc(list.id)}/tasks${qs}`,
  }));
  const responses = await graphBatch(requests);
  const results: Array<{ list: TodoTaskList; tasks: TodoTask[]; error?: string }> = new Array(
    lists.length
  );
  for (const r of responses) {
    const idx = Number(r.id);
    if (r.status >= 200 && r.status < 300) {
      const body = r.body as GraphCollection<TodoTask>;
      results[idx] = { list: lists[idx], tasks: body.value ?? [] };
    } else {
      const body = r.body as GraphErrorBody | undefined;
      const err = body?.error
        ? `${body.error.code ?? r.status}: ${body.error.message ?? "(no message)"}`
        : `HTTP ${r.status}`;
      results[idx] = { list: lists[idx], tasks: [], error: err };
    }
  }
  return results;
}

// ─── Cross-list search ────────────────────────────────────────────────────

export interface SearchResult {
  list: { id: string; displayName: string };
  task: TodoTask;
}

/**
 * Searches a term in the titles of non-completed tasks across all lists.
 * Uses $filter contains() — case-sensitive on Graph side. Includes completed if includeCompleted.
 */
export async function searchTasks(
  query: string,
  opts: { topPerList?: number; includeCompleted?: boolean } = {}
): Promise<SearchResult[]> {
  const lists = await listTaskLists();
  const escaped = query.replace(/'/g, "''");
  const filterParts = [`contains(title,'${escaped}')`];
  if (!opts.includeCompleted) filterParts.push("status ne 'completed'");
  const filter = filterParts.join(" and ");

  const perList = await fetchTasksAcrossLists(lists, {
    filter,
    top: opts.topPerList ?? 25,
  });
  return perList.flatMap(({ list, tasks }) =>
    tasks.map((task) => ({
      list: { id: list.id, displayName: list.displayName },
      task,
    }))
  );
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
  const perList = await fetchTasksAcrossLists(lists, {
    filter: `status ne 'completed' and dueDateTime/dateTime lt '${startOfTomorrow.toISOString()}'`,
    top: 100,
  });
  const byList = perList.map(({ list, tasks }) => {
    const dueToday: TodoTask[] = [];
    const overdue: TodoTask[] = [];
    for (const t of tasks) {
      if (!t.dueDateTime) continue;
      const due = new Date(t.dueDateTime.dateTime);
      if (due >= startOfToday && due < startOfTomorrow) dueToday.push(t);
      else if (due < startOfToday) overdue.push(t);
    }
    return { list: { id: list.id, displayName: list.displayName }, dueToday, overdue };
  });
  const totalDueToday = byList.reduce((s, l) => s + l.dueToday.length, 0);
  const totalOverdue = byList.reduce((s, l) => s + l.overdue.length, 0);
  void timeZone; // accepted for API consistency; "today" derived from now in UTC
  return { date: today, totalDueToday, totalOverdue, byList };
}

// ─── List all tasks across every list ──────────────────────────────────────

export interface ListWithTasks {
  list: { id: string; displayName: string };
  tasks: TodoTask[];
  error?: string;
}

// Fetch every task from every list in a single MCP round-trip.
// Internally uses $batch on Graph when there are >5 lists, parallel fetch otherwise.
// Saves ~N round-trips for the LLM compared to listTaskLists + N × listTasks.
export async function listAllTasks(
  opts: {
    filter?: string;
    topPerList?: number;
    includeCompleted?: boolean;
  } = {}
): Promise<ListWithTasks[]> {
  const lists = await listTaskLists();
  const filterParts: string[] = [];
  if (opts.filter) filterParts.push(opts.filter);
  if (!opts.includeCompleted) filterParts.push("status ne 'completed'");
  const filter = filterParts.length > 0 ? filterParts.join(" and ") : undefined;
  const perList = await fetchTasksAcrossLists(lists, {
    filter,
    top: opts.topPerList ?? 50,
  });
  return perList.map((r) => ({
    list: { id: r.list.id, displayName: r.list.displayName },
    tasks: r.tasks,
    error: r.error,
  }));
}

// ─── Checklists (sub-tasks) ────────────────────────────────────────────────

export async function listChecklistItems(
  listId: string,
  taskId: string,
  opts: { select?: string; paginate?: boolean } = {}
): Promise<ChecklistItem[]> {
  const select = opts.select ?? DEFAULT_CHECKLIST_SELECT;
  const path = `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems?$select=${encodeODataValue(select)}`;
  if (opts.paginate) return paginateAll<ChecklistItem>(path);
  const data = await graphFetch<GraphCollection<ChecklistItem>>(path);
  return data.value;
}

export async function createChecklistItem(
  listId: string,
  taskId: string,
  displayName: string,
  isChecked = false
): Promise<ChecklistItem> {
  return graphFetch<ChecklistItem>(
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems`,
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
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems/${enc(itemId)}`,
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
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/checklistItems/${enc(itemId)}`,
    { method: "DELETE" }
  );
}

// ─── Linked resources (external references attached to a task) ────────────

export async function listLinkedResources(
  listId: string,
  taskId: string,
  opts: { select?: string; paginate?: boolean } = {}
): Promise<LinkedResource[]> {
  const select = opts.select ?? DEFAULT_LINKED_SELECT;
  const path = `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/linkedResources?$select=${encodeODataValue(select)}`;
  if (opts.paginate) return paginateAll<LinkedResource>(path);
  const data = await graphFetch<GraphCollection<LinkedResource>>(path);
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
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/linkedResources`,
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
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/linkedResources/${enc(resourceId)}`,
    { method: "DELETE" }
  );
}

// ─── Batch operations on tasks ────────────────────────────────────────────
// Microsoft Graph $batch: up to 20 requests per HTTP call. Auto-chunked.

export interface BatchResultItem<T> {
  index: number;
  status: number;
  ok: boolean;
  result?: T;
  error?: string;
}

export async function batchCreateTasks(
  items: Array<{ listId: string; task: CreateTaskInput }>
): Promise<Array<BatchResultItem<TodoTask>>> {
  const requests: BatchRequest[] = items.map((item, idx) => {
    const payload = buildTaskPayload(item.task);
    if (!payload.importance) payload.importance = "normal";
    return {
      id: String(idx),
      method: "POST",
      url: `/me/todo/lists/${enc(item.listId)}/tasks`,
      body: payload,
    };
  });
  const responses = await graphBatch(requests);
  return parseBatchResponses<TodoTask>(responses, items.length);
}

export async function batchCompleteTasks(
  items: Array<{ listId: string; taskId: string }>
): Promise<Array<BatchResultItem<TodoTask>>> {
  const requests: BatchRequest[] = items.map((item, idx) => ({
    id: String(idx),
    method: "PATCH",
    url: `/me/todo/lists/${enc(item.listId)}/tasks/${enc(item.taskId)}`,
    body: { status: "completed" },
  }));
  const responses = await graphBatch(requests);
  return parseBatchResponses<TodoTask>(responses, items.length);
}

export async function batchDeleteTasks(
  items: Array<{ listId: string; taskId: string }>
): Promise<Array<BatchResultItem<null>>> {
  const requests: BatchRequest[] = items.map((item, idx) => ({
    id: String(idx),
    method: "DELETE",
    url: `/me/todo/lists/${enc(item.listId)}/tasks/${enc(item.taskId)}`,
  }));
  const responses = await graphBatch(requests);
  return parseBatchResponses<null>(responses, items.length);
}

// ─── Open extensions (custom JSON metadata on tasks) ─────────────────────

export interface OpenExtension {
  id: string;
  extensionName: string;
  [key: string]: unknown;
}

export async function listTaskExtensions(
  listId: string,
  taskId: string,
  opts: { paginate?: boolean } = {}
): Promise<OpenExtension[]> {
  const path = `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/extensions`;
  if (opts.paginate) return paginateAll<OpenExtension>(path);
  const data = await graphFetch<GraphCollection<OpenExtension>>(path);
  return data.value;
}

export async function setTaskExtension(
  listId: string,
  taskId: string,
  extensionName: string,
  data: Record<string, unknown>
): Promise<OpenExtension> {
  // Upsert : PATCH si existe, POST sinon (404)
  const patchPath = `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/extensions/${enc(extensionName)}`;
  try {
    return await graphFetch<OpenExtension>(patchPath, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  } catch (err) {
    if (err instanceof Error && /Graph 404/.test(err.message)) {
      return graphFetch<OpenExtension>(
        `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/extensions`,
        {
          method: "POST",
          body: JSON.stringify({
            "@odata.type": "microsoft.graph.openTypeExtension",
            extensionName,
            ...data,
          }),
        }
      );
    }
    throw err;
  }
}

export async function deleteTaskExtension(
  listId: string,
  taskId: string,
  extensionName: string
): Promise<void> {
  await graphFetch<void>(
    `/me/todo/lists/${enc(listId)}/tasks/${enc(taskId)}/extensions/${enc(extensionName)}`,
    { method: "DELETE" }
  );
}

// ─── Cross-list helpers ────────────────────────────────────────────────────

export async function listOverdueTasks(
  topPerList = 50
): Promise<SearchResult[]> {
  const lists = await listTaskLists();
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  const filter = `status ne 'completed' and dueDateTime/dateTime lt '${cutoff.toISOString()}'`;
  const perList = await fetchTasksAcrossLists(lists, { filter, top: topPerList });
  return perList.flatMap(({ list, tasks }) =>
    tasks.map((task) => ({
      list: { id: list.id, displayName: list.displayName },
      task,
    }))
  );
}

export async function listTasksByCategory(
  category: string,
  opts: { topPerList?: number; includeCompleted?: boolean } = {}
): Promise<SearchResult[]> {
  const lists = await listTaskLists();
  const escaped = category.replace(/'/g, "''");
  const filterParts = [`categories/any(c: c eq '${escaped}')`];
  if (!opts.includeCompleted) filterParts.push("status ne 'completed'");
  const filter = filterParts.join(" and ");
  const perList = await fetchTasksAcrossLists(lists, {
    filter,
    top: opts.topPerList ?? 50,
  });
  return perList.flatMap(({ list, tasks }) =>
    tasks.map((task) => ({
      list: { id: list.id, displayName: list.displayName },
      task,
    }))
  );
}

export async function bulkUpdateCategories(
  refs: Array<{ listId: string; taskId: string }>,
  changes: { add?: string[]; remove?: string[] }
): Promise<Array<BatchResultItem<TodoTask>>> {
  // Phase 1: GET (batch) to fetch current categories
  const getRequests: BatchRequest[] = refs.map((ref, idx) => ({
    id: String(idx),
    method: "GET",
    // No $select: rejected by Graph on this endpoint for personal accounts.
    url: `/me/todo/lists/${enc(ref.listId)}/tasks/${enc(ref.taskId)}`,
  }));
  const getResponses = await graphBatch(getRequests);
  const final: Array<BatchResultItem<TodoTask>> = new Array(refs.length);

  // Phase 2: build PATCH requests for successful GETs
  const patchRequests: BatchRequest[] = [];
  for (const r of getResponses) {
    const idx = Number(r.id);
    if (r.status < 200 || r.status >= 300) {
      final[idx] = {
        index: idx,
        status: r.status,
        ok: false,
        error: `GET failed: HTTP ${r.status}`,
      };
      continue;
    }
    const task = r.body as { categories?: string[] };
    const current = new Set(task.categories ?? []);
    for (const c of changes.add ?? []) current.add(c);
    for (const c of changes.remove ?? []) current.delete(c);
    patchRequests.push({
      id: String(idx),
      method: "PATCH",
      url: `/me/todo/lists/${enc(refs[idx].listId)}/tasks/${enc(refs[idx].taskId)}`,
      body: { categories: Array.from(current) },
    });
  }

  if (patchRequests.length > 0) {
    const patchResponses = await graphBatch(patchRequests);
    for (const r of patchResponses) {
      const idx = Number(r.id);
      const ok = r.status >= 200 && r.status < 300;
      let error: string | undefined;
      if (!ok) {
        const body = r.body as GraphErrorBody | string | undefined;
        if (typeof body === "object" && body && "error" in body && body.error) {
          error = body.error.code
            ? `${body.error.code}: ${body.error.message ?? "(no message)"}`
            : body.error.message ?? `HTTP ${r.status}`;
        } else if (typeof body === "string") {
          error = body;
        } else {
          error = `HTTP ${r.status}`;
        }
      }
      final[idx] = {
        index: idx,
        status: r.status,
        ok,
        result: ok ? (r.body as TodoTask) : undefined,
        error,
      };
    }
  }
  return final;
}

// ─── Export iCalendar (text/calendar) ──────────────────────────────────────

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/[,;]/g, "\\$&")
    .replace(/\r?\n/g, "\\n");
}

function formatIcsDate(iso: string): string {
  // "2026-05-04T18:00:00" ou "...Z" → "20260504T180000Z"
  const cleaned = iso.replace(/\.\d+/, "").replace(/Z$/, "");
  // Parse "YYYY-MM-DDTHH:MM:SS"
  const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return cleaned.replace(/[-:]/g, "");
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

function recurrenceToRRule(r: PatternedRecurrence): string | null {
  const parts: string[] = [];
  switch (r.pattern.type) {
    case "daily":
      parts.push("FREQ=DAILY");
      break;
    case "weekly":
      parts.push("FREQ=WEEKLY");
      if (r.pattern.daysOfWeek?.length) {
        const map: Record<DayOfWeek, string> = {
          monday: "MO",
          tuesday: "TU",
          wednesday: "WE",
          thursday: "TH",
          friday: "FR",
          saturday: "SA",
          sunday: "SU",
        };
        parts.push(`BYDAY=${r.pattern.daysOfWeek.map((d) => map[d]).join(",")}`);
      }
      break;
    case "absoluteMonthly":
      parts.push("FREQ=MONTHLY");
      if (r.pattern.dayOfMonth) parts.push(`BYMONTHDAY=${r.pattern.dayOfMonth}`);
      break;
    case "absoluteYearly":
      parts.push("FREQ=YEARLY");
      break;
    default:
      return null; // relativeMonthly/Yearly trop complexes
  }
  if (r.pattern.interval > 1) parts.push(`INTERVAL=${r.pattern.interval}`);
  if (r.range.type === "endDate" && r.range.endDate) {
    parts.push(`UNTIL=${r.range.endDate.replace(/-/g, "")}T235959Z`);
  } else if (r.range.type === "numbered" && r.range.numberOfOccurrences) {
    parts.push(`COUNT=${r.range.numberOfOccurrences}`);
  }
  return parts.join(";");
}

export async function exportTasksIcs(
  opts: {
    listIds?: string[];
    includeCompleted?: boolean;
    topPerList?: number;
  } = {}
): Promise<string> {
  const allLists = await listTaskLists();
  const lists = opts.listIds
    ? allLists.filter((l) => opts.listIds!.includes(l.id))
    : allLists;

  const filterParts: string[] = [];
  if (!opts.includeCompleted) filterParts.push("status ne 'completed'");
  const filter = filterParts.length > 0 ? filterParts.join(" and ") : undefined;
  const top = opts.topPerList ?? 100;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mag-cie//mcp-microsoft-todo//FR",
    "CALSCALE:GREGORIAN",
  ];
  const now = formatIcsDate(new Date().toISOString());

  for (const list of lists) {
    let tasks: TodoTask[] = [];
    try {
      tasks = await listTasks(list.id, { filter, top });
    } catch {
      continue;
    }
    for (const task of tasks) {
      lines.push("BEGIN:VTODO");
      lines.push(`UID:${task.id}@mcp-microsoft-todo`);
      lines.push(`DTSTAMP:${now}`);
      lines.push(
        `SUMMARY:${escapeIcsText(`[${list.displayName}] ${task.title}`)}`
      );
      if (task.body?.content)
        lines.push(`DESCRIPTION:${escapeIcsText(task.body.content)}`);
      if (task.dueDateTime)
        lines.push(`DUE:${formatIcsDate(task.dueDateTime.dateTime)}`);
      if (task.status === "completed") lines.push("STATUS:COMPLETED");
      else if (task.status === "inProgress") lines.push("STATUS:IN-PROCESS");
      else lines.push("STATUS:NEEDS-ACTION");
      if (task.importance === "high") lines.push("PRIORITY:1");
      else if (task.importance === "low") lines.push("PRIORITY:9");
      if (task.categories?.length) {
        lines.push(
          `CATEGORIES:${task.categories.map(escapeIcsText).join(",")}`
        );
      }
      if (task.recurrence) {
        const rrule = recurrenceToRRule(task.recurrence);
        if (rrule) lines.push(`RRULE:${rrule}`);
      }
      if (task.isReminderOn && task.reminderDateTime) {
        lines.push("BEGIN:VALARM");
        lines.push("ACTION:DISPLAY");
        lines.push(
          `TRIGGER;VALUE=DATE-TIME:${formatIcsDate(task.reminderDateTime.dateTime)}`
        );
        lines.push("DESCRIPTION:Reminder");
        lines.push("END:VALARM");
      }
      lines.push("END:VTODO");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function parseBatchResponses<T>(
  responses: BatchResponse[],
  expectedCount: number
): Array<BatchResultItem<T>> {
  const out: Array<BatchResultItem<T>> = new Array(expectedCount);
  for (const r of responses) {
    const idx = Number(r.id);
    const ok = r.status >= 200 && r.status < 300;
    let error: string | undefined;
    if (!ok) {
      const body = r.body as GraphErrorBody | string | undefined;
      if (typeof body === "object" && body && "error" in body && body.error) {
        error = body.error.code
          ? `${body.error.code}: ${body.error.message ?? "(no message)"}`
          : body.error.message ?? `HTTP ${r.status}`;
      } else if (typeof body === "string") {
        error = body;
      } else {
        error = `HTTP ${r.status}`;
      }
    }
    out[idx] = {
      index: idx,
      status: r.status,
      ok,
      result: ok ? (r.body as T) : undefined,
      error,
    };
  }
  return out;
}
