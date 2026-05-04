/**
 * Tests vitest pour graph.ts (fetch et auth mockés).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
  SCOPES: ["Tasks.ReadWrite", "offline_access"],
}));

import { getAccessToken } from "./auth.js";
import {
  batchCompleteTasks,
  batchCreateTasks,
  batchDeleteTasks,
  bulkUpdateCategories,
  createTask,
  deleteTask,
  exportTasksIcs,
  listOverdueTasks,
  listTaskLists,
  listTasks,
  listTasksByCategory,
  moveTask,
  searchTasks,
  setTaskExtension,
  summarizeToday,
  updateTask,
} from "./graph.js";

type MockFetchResponse = {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function makeFetch(responses: MockFetchResponse[]) {
  let i = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: r.ok ?? (r.status ? r.status < 400 : true),
      status: r.status ?? 200,
      statusText: r.statusText ?? "OK",
      headers: { get: (h: string) => r.headers?.[h.toLowerCase()] ?? null },
      json: async () => r.body,
      text: async () =>
        typeof r.body === "string" ? r.body : JSON.stringify(r.body),
    } as unknown as Response;
  });
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  vi.mocked(getAccessToken).mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("listTaskLists", () => {
  it("appelle /me/todo/lists avec $select et retourne value", async () => {
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "A", isOwner: true, isShared: false }] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const lists = await listTaskLists();
    expect(lists).toHaveLength(1);
    expect(lists[0].id).toBe("L1");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/me/todo/lists");
    // No $select: Graph rejects it on this endpoint for personal accounts.
    expect(url).not.toContain("$select=");
  });
});

describe("listTasks", () => {
  it("encode filter, top, orderby dans l'URL (sans $select)", async () => {
    const fetchMock = makeFetch([{ body: { value: [] } }]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await listTasks("LID", {
      filter: "status ne 'completed'",
      top: 10,
      orderby: "dueDateTime/dateTime asc",
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/me/todo/lists/LID/tasks?");
    // Literal $ (not %24) — Graph requires literal prefix on these params
    expect(url).toContain("$filter=");
    expect(url).toContain("$top=10");
    expect(url).toContain("$orderby=");
    // OData chars (`/`, `'`, `,`, `(`, `)`, `:`) preserved literal in $orderby/$filter
    expect(url).toContain("$orderby=dueDateTime/dateTime");
    // No $select: Graph rejects it on this endpoint for personal accounts.
    expect(url).not.toContain("$select=");
  });
});

describe("createTask", () => {
  it("POST avec title + importance par défaut + recurrence + reminder", async () => {
    const fetchMock = makeFetch([{ body: { id: "T1", title: "Test" } }]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await createTask("LID", {
      title: "Test",
      body: "Détails",
      recurrence: {
        pattern: { type: "daily", interval: 1 },
        range: { type: "noEnd", startDate: "2026-05-04" },
      },
      isReminderOn: true,
      reminderDateTime: "2026-05-04T08:00:00",
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("Test");
    expect(body.importance).toBe("normal"); // default
    expect(body.body).toEqual({ content: "Détails", contentType: "text" });
    expect(body.recurrence.pattern.type).toBe("daily");
    expect(body.isReminderOn).toBe(true);
    expect(body.reminderDateTime.dateTime).toBe("2026-05-04T08:00:00");
    expect(body.reminderDateTime.timeZone).toBe("Europe/Paris");
  });
});

describe("updateTask", () => {
  it("PATCH avec uniquement les champs fournis", async () => {
    const fetchMock = makeFetch([{ body: { id: "T1" } }]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await updateTask("LID", "T1", { status: "completed" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ status: "completed" });
  });
});

describe("deleteTask", () => {
  it("DELETE 204 sans body", async () => {
    const fetchMock = makeFetch([{ status: 204 }]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await deleteTask("LID", "T1");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });
});

describe("moveTask", () => {
  it("get source, recreate target, delete source (et complete si completed)", async () => {
    const original = {
      id: "T1",
      title: "Task",
      status: "completed",
      importance: "high",
      isReminderOn: false,
      categories: ["work"],
    };
    const fetchMock = makeFetch([
      { body: original }, // getTask
      { body: { id: "T2", title: "Task" } }, // createTask
      { body: { id: "T2", status: "completed" } }, // completeTask (PATCH)
      { status: 204 }, // deleteTask
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const moved = await moveTask("L1", "T1", "L2");
    expect(moved.id).toBe("T2");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/lists/L1/tasks/T1");
    expect(urls[1]).toContain("/lists/L2/tasks");
    expect(urls[3]).toContain("/lists/L1/tasks/T1");
    expect((fetchMock.mock.calls[3][1] as RequestInit).method).toBe("DELETE");
  });
});

describe("searchTasks", () => {
  it("filter contains + status ne completed, agrège par liste", async () => {
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }, { id: "L2", displayName: "L2", isOwner: true, isShared: false }] } },
      { body: { value: [{ id: "T1", title: "foo bar", status: "notStarted", importance: "normal", isReminderOn: false }] } },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await searchTasks("bar");
    expect(results).toHaveLength(1);
    expect(results[0].task.id).toBe("T1");
    expect(results[0].list.id).toBe("L1");
    const filterUrl = decodeURIComponent(
      String(fetchMock.mock.calls[1][0]).replace(/\+/g, " ")
    );
    expect(filterUrl).toContain("contains(title,'bar')");
    expect(filterUrl).toContain("status ne 'completed'");
  });

  it("échappe les apostrophes du query", async () => {
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }] } },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await searchTasks("d'accord");
    const filterUrl = decodeURIComponent(
      String(fetchMock.mock.calls[1][0]).replace(/\+/g, " ")
    );
    expect(filterUrl).toContain("contains(title,'d''accord')");
  });
});

describe("summarizeToday", () => {
  it("classifie dueToday vs overdue", async () => {
    const now = new Date();
    const todayIso = now.toISOString();
    const yesterday = new Date(now);
    yesterday.setUTCDate(now.getUTCDate() - 1);
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }] } },
      {
        body: {
          value: [
            {
              id: "T_TODAY",
              title: "today",
              status: "notStarted",
              importance: "normal",
              isReminderOn: false,
              dueDateTime: { dateTime: todayIso, timeZone: "UTC" },
            },
            {
              id: "T_LATE",
              title: "late",
              status: "notStarted",
              importance: "normal",
              isReminderOn: false,
              dueDateTime: { dateTime: yesterday.toISOString(), timeZone: "UTC" },
            },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const s = await summarizeToday();
    expect(s.totalDueToday).toBe(1);
    expect(s.totalOverdue).toBe(1);
    expect(s.byList[0].dueToday[0].id).toBe("T_TODAY");
    expect(s.byList[0].overdue[0].id).toBe("T_LATE");
  });
});

describe("pagination", () => {
  it("paginate=true suit @odata.nextLink et accumule", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=ABC",
        },
      },
      {
        body: {
          value: [{ id: "L2", displayName: "L2", isOwner: true, isShared: false }],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const lists = await listTaskLists({ paginate: true });
    expect(lists).toHaveLength(2);
    expect(lists.map((l) => l.id)).toEqual(["L1", "L2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain("$skiptoken=ABC");
  });

  it("paginate=false (default) ne fait qu'un seul appel même avec nextLink", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=ABC",
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const lists = await listTaskLists();
    expect(lists).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("batch operations", () => {
  it("batchCreateTasks envoie /$batch avec items POST et préserve l'ordre", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          responses: [
            { id: "1", status: 201, body: { id: "TB", title: "B" } },
            { id: "0", status: 201, body: { id: "TA", title: "A" } },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await batchCreateTasks([
      { listId: "L1", task: { title: "A" } },
      { listId: "L2", task: { title: "B" } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[0].result?.id).toBe("TA");
    expect(results[1].result?.id).toBe("TB");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/$batch");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0].method).toBe("POST");
    expect(body.requests[0].url).toBe("/me/todo/lists/L1/tasks");
    expect(body.requests[0].body.title).toBe("A");
  });

  it("batchCompleteTasks envoie PATCH avec status:completed", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          responses: [
            { id: "0", status: 200, body: { id: "T1", status: "completed" } },
            { id: "1", status: 200, body: { id: "T2", status: "completed" } },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await batchCompleteTasks([
      { listId: "L1", taskId: "T1" },
      { listId: "L1", taskId: "T2" },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.requests[0].method).toBe("PATCH");
    expect(body.requests[0].body).toEqual({ status: "completed" });
  });

  it("batchDeleteTasks expose erreurs sans throw global", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          responses: [
            { id: "0", status: 204 },
            {
              id: "1",
              status: 404,
              body: { error: { code: "NotFound", message: "Task gone" } },
            },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await batchDeleteTasks([
      { listId: "L1", taskId: "T1" },
      { listId: "L1", taskId: "T2" },
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toContain("NotFound");
    expect(results[1].error).toContain("Task gone");
  });

  it("retry les sub-responses 429 du batch individuellement", async () => {
    const fetchMock = makeFetch([
      // Batch call: first sub-request OK, second throttled
      {
        body: {
          responses: [
            { id: "0", status: 201, body: { id: "TA", title: "A" } },
            {
              id: "1",
              status: 429,
              body: { error: { code: "activityLimitReached", message: "throttled" } },
            },
          ],
        },
      },
      // Individual retry of the throttled sub-request succeeds
      { status: 201, body: { id: "TB", title: "B" } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await batchCreateTasks([
      { listId: "L1", task: { title: "A" } },
      { listId: "L2", task: { title: "B" } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(true);
    expect(results[1].result?.id).toBe("TB");
    // 1 batch call + 1 individual retry = 2 fetches
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry was issued against the original URL (not /$batch)
    const retryUrl = String(fetchMock.mock.calls[1][0]);
    expect(retryUrl).toContain("/me/todo/lists/L2/tasks");
    expect(retryUrl).not.toContain("/$batch");
  });

  it("batch chunké quand > 20 items", async () => {
    const responses1 = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      status: 201,
      body: { id: `T${i}`, title: `t${i}` },
    }));
    const responses2 = [
      { id: "20", status: 201, body: { id: "T20", title: "t20" } },
    ];
    const fetchMock = makeFetch([
      { body: { responses: responses1 } },
      { body: { responses: responses2 } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const items = Array.from({ length: 21 }, (_, i) => ({
      listId: "L1",
      task: { title: `t${i}` },
    }));
    const results = await batchCreateTasks(items);
    expect(results).toHaveLength(21);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("setTaskExtension (upsert)", () => {
  it("PATCH si existe (200)", async () => {
    const fetchMock = makeFetch([
      { body: { id: "ext1", extensionName: "com.test", foo: "bar" } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const ext = await setTaskExtension("L1", "T1", "com.test", { foo: "bar" });
    expect(ext.extensionName).toBe("com.test");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
  });

  it("POST si 404 sur PATCH", async () => {
    const fetchMock = makeFetch([
      { status: 404, body: { error: { code: "ItemNotFound", message: "no ext" } } },
      { body: { id: "ext1", extensionName: "com.test", foo: "bar" } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const ext = await setTaskExtension("L1", "T1", "com.test", { foo: "bar" });
    expect(ext.id).toBe("ext1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST");
    const postBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string
    );
    expect(postBody["@odata.type"]).toBe("microsoft.graph.openTypeExtension");
    expect(postBody.extensionName).toBe("com.test");
    expect(postBody.foo).toBe("bar");
  });
});

describe("listOverdueTasks", () => {
  it("filter status ne completed et dueDateTime < today", async () => {
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }] } },
      { body: { value: [{ id: "T1", title: "Late", status: "notStarted", importance: "normal", isReminderOn: false }] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await listOverdueTasks();
    expect(results).toHaveLength(1);
    const filterUrl = decodeURIComponent(
      String(fetchMock.mock.calls[1][0]).replace(/\+/g, " ")
    );
    expect(filterUrl).toContain("status ne 'completed'");
    expect(filterUrl).toContain("dueDateTime/dateTime lt");
  });
});

describe("listTasksByCategory", () => {
  it("filter categories/any() et échappe apostrophes", async () => {
    const fetchMock = makeFetch([
      { body: { value: [{ id: "L1", displayName: "L1", isOwner: true, isShared: false }] } },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await listTasksByCategory("d'urgence");
    const filterUrl = decodeURIComponent(
      String(fetchMock.mock.calls[1][0]).replace(/\+/g, " ")
    );
    expect(filterUrl).toContain("categories/any(c: c eq 'd''urgence')");
    expect(filterUrl).toContain("status ne 'completed'");
  });
});

describe("bulkUpdateCategories", () => {
  it("phase 1 GET pour catégories courantes, phase 2 PATCH avec union", async () => {
    const fetchMock = makeFetch([
      // Phase 1 GET batch
      {
        body: {
          responses: [
            { id: "0", status: 200, body: { id: "T1", categories: ["work"] } },
            { id: "1", status: 200, body: { id: "T2", categories: [] } },
          ],
        },
      },
      // Phase 2 PATCH batch
      {
        body: {
          responses: [
            { id: "0", status: 200, body: { id: "T1", categories: ["work", "urgent"] } },
            { id: "1", status: 200, body: { id: "T2", categories: ["urgent"] } },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await bulkUpdateCategories(
      [
        { listId: "L1", taskId: "T1" },
        { listId: "L1", taskId: "T2" },
      ],
      { add: ["urgent"] }
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    const patchBody = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string
    );
    expect(patchBody.requests[0].body.categories).toEqual(["work", "urgent"]);
    expect(patchBody.requests[1].body.categories).toEqual(["urgent"]);
  });

  it("propage erreurs phase 1 sans casser le batch", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          responses: [
            {
              id: "0",
              status: 404,
              body: { error: { code: "NotFound", message: "missing" } },
            },
            { id: "1", status: 200, body: { id: "T2", categories: [] } },
          ],
        },
      },
      {
        body: {
          responses: [
            { id: "1", status: 200, body: { id: "T2", categories: ["x"] } },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await bulkUpdateCategories(
      [
        { listId: "L1", taskId: "T_BAD" },
        { listId: "L1", taskId: "T2" },
      ],
      { add: ["x"] }
    );
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toContain("GET failed");
    expect(results[1].ok).toBe(true);
  });
});

describe("exportTasksIcs", () => {
  it("génère un VCALENDAR avec VTODO + RRULE + VALARM", async () => {
    const fetchMock = makeFetch([
      {
        body: {
          value: [{ id: "L1", displayName: "Boulot", isOwner: true, isShared: false }],
        },
      },
      {
        body: {
          value: [
            {
              id: "T1",
              title: "Sport",
              status: "notStarted",
              importance: "high",
              isReminderOn: true,
              dueDateTime: { dateTime: "2026-05-04T18:00:00", timeZone: "UTC" },
              reminderDateTime: {
                dateTime: "2026-05-04T17:00:00",
                timeZone: "UTC",
              },
              recurrence: {
                pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "wednesday"] },
                range: { type: "noEnd", startDate: "2026-05-04" },
              },
              categories: ["health"],
            },
          ],
        },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    const ics = await exportTasksIcs();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("UID:T1@mcp-microsoft-todo");
    expect(ics).toContain("SUMMARY:[Boulot] Sport");
    expect(ics).toContain("DUE:20260504T180000Z");
    expect(ics).toContain("STATUS:NEEDS-ACTION");
    expect(ics).toContain("PRIORITY:1");
    expect(ics).toContain("CATEGORIES:health");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER;VALUE=DATE-TIME:20260504T170000Z");
  });
});

describe("retry & error handling", () => {
  it("retry sur 429 avec respect de Retry-After", async () => {
    const fetchMock = makeFetch([
      { status: 429, headers: { "retry-after": "0" }, body: "rate limited" },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await listTaskLists();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retry sur 5xx avec backoff", async () => {
    const fetchMock = makeFetch([
      { status: 503, body: "transient" },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await listTaskLists();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-acquire token sur 401 puis retry", async () => {
    const fetchMock = makeFetch([
      { status: 401, body: { error: { code: "InvalidAuthenticationToken" } } },
      { body: { value: [] } },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await listTaskLists();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenCalledWith(true);
  });

  it("parse l'erreur Graph et expose code + message", async () => {
    const fetchMock = makeFetch([
      {
        status: 400,
        body: { error: { code: "InvalidRequest", message: "Bad filter" } },
      },
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(listTaskLists()).rejects.toThrow(/InvalidRequest.*Bad filter/);
  });
});
