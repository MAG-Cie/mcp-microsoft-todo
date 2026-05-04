/**
 * Snapshot/unit tests for compact formatters.
 * Lock the exact compact strings — any change is intentional and visible in PR diff.
 */
import { describe, expect, it } from "vitest";
import {
  formatBatchCompact,
  formatChecklistCompact,
  formatExtensionCompact,
  formatGraphDate,
  formatLinkedCompact,
  formatListCompact,
  formatSearchCompact,
  formatSummaryCompact,
  formatTaskCompact,
} from "./formatters.js";
import type {
  BatchResultItem,
  ChecklistItem,
  DailySummary,
  LinkedResource,
  OpenExtension,
  SearchResult,
  TodoTask,
  TodoTaskList,
} from "./graph.js";

describe("formatGraphDate", () => {
  it("strips microseconds and seconds", () => {
    expect(formatGraphDate("2026-05-04T18:00:00.0000000")).toBe(
      "2026-05-04T18:00"
    );
  });
  it("returns date only when time is midnight", () => {
    expect(formatGraphDate("2026-05-04T00:00:00.0000000")).toBe("2026-05-04");
  });
});

describe("formatTaskCompact", () => {
  const baseTask: TodoTask = {
    id: "T1",
    title: "Buy bread",
    status: "notStarted",
    importance: "normal",
    isReminderOn: false,
    createdDateTime: "2026-05-04T10:00:00Z",
    lastModifiedDateTime: "2026-05-04T10:00:00Z",
  };

  it("minimal task: id + title only", () => {
    expect(formatTaskCompact(baseTask)).toMatchInlineSnapshot(
      `"T1 "Buy bread""`
    );
  });

  it("high importance + completed status", () => {
    expect(
      formatTaskCompact({ ...baseTask, importance: "high", status: "completed" })
    ).toMatchInlineSnapshot(`"T1 [!] [v] "Buy bread""`);
  });

  it("low importance + inProgress + due + reminder + recurrence + categories", () => {
    expect(
      formatTaskCompact({
        ...baseTask,
        importance: "low",
        status: "inProgress",
        dueDateTime: { dateTime: "2026-05-04T18:00:00", timeZone: "UTC" },
        isReminderOn: true,
        reminderDateTime: { dateTime: "2026-05-04T17:00:00", timeZone: "UTC" },
        recurrence: {
          pattern: { type: "daily", interval: 1 },
          range: { type: "noEnd", startDate: "2026-05-04" },
        },
        categories: ["work", "urgent"],
      })
    ).toMatchInlineSnapshot(
      `"T1 [?] [>] "Buy bread" due:2026-05-04T18:00 rem:2026-05-04T17:00 rec:daily cat:work,urgent"`
    );
  });

  it("body truncated at 100 chars + whitespace collapsed", () => {
    const longBody =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua";
    const result = formatTaskCompact({
      ...baseTask,
      body: { content: longBody + "\n\n more text", contentType: "text" },
    });
    expect(result).toMatch(/body:".*…"$/);
    expect(result.length).toBeLessThan(180);
  });

  it("empty body content is omitted", () => {
    expect(
      formatTaskCompact({
        ...baseTask,
        body: { content: "   ", contentType: "text" },
      })
    ).toMatchInlineSnapshot(`"T1 "Buy bread""`);
  });
});

describe("formatListCompact", () => {
  it("owned non-shared list with wellknown name", () => {
    const list: TodoTaskList = {
      id: "L1",
      displayName: "Tasks",
      isOwner: true,
      isShared: false,
      wellknownListName: "defaultList",
    };
    expect(formatListCompact(list)).toMatchInlineSnapshot(
      `"L1 "Tasks" wk:defaultList"`
    );
  });

  it("shared list, not owner", () => {
    const list: TodoTaskList = {
      id: "L2",
      displayName: "Family",
      isOwner: false,
      isShared: true,
    };
    expect(formatListCompact(list)).toMatchInlineSnapshot(
      `"L2 "Family" shared not-owner"`
    );
  });

  it("wellknownListName 'none' is omitted", () => {
    const list: TodoTaskList = {
      id: "L3",
      displayName: "Custom",
      isOwner: true,
      isShared: false,
      wellknownListName: "none",
    };
    expect(formatListCompact(list)).toMatchInlineSnapshot(`"L3 "Custom""`);
  });
});

describe("formatChecklistCompact", () => {
  it("checked", () => {
    const item: ChecklistItem = {
      id: "C1",
      displayName: "Eggs",
      isChecked: true,
      createdDateTime: "2026-05-04T10:00:00Z",
    };
    expect(formatChecklistCompact(item)).toMatchInlineSnapshot(
      `"C1 [v] "Eggs""`
    );
  });

  it("unchecked", () => {
    const item: ChecklistItem = {
      id: "C2",
      displayName: "Milk",
      isChecked: false,
      createdDateTime: "2026-05-04T10:00:00Z",
    };
    expect(formatChecklistCompact(item)).toMatchInlineSnapshot(
      `"C2 [ ] "Milk""`
    );
  });
});

describe("formatLinkedCompact", () => {
  it("full linked resource", () => {
    const r: LinkedResource = {
      id: "R1",
      applicationName: "Outlook",
      displayName: "Email about Q4",
      webUrl: "https://outlook.com/mail/abc",
      externalId: "msg-123",
    };
    expect(formatLinkedCompact(r)).toMatchInlineSnapshot(
      `"R1 app:Outlook name:"Email about Q4" url:https://outlook.com/mail/abc ext:msg-123"`
    );
  });

  it("only id", () => {
    expect(formatLinkedCompact({ id: "R0" })).toMatchInlineSnapshot(`"R0"`);
  });
});

describe("formatExtensionCompact", () => {
  it("extension with custom props skips @odata fields", () => {
    const ext: OpenExtension = {
      id: "com.example.x",
      extensionName: "com.example.x",
      "@odata.type": "microsoft.graph.openTypeExtension",
      project_id: "P-42",
      priority_score: 0.85,
    };
    expect(formatExtensionCompact(ext)).toMatchInlineSnapshot(
      `"com.example.x name:com.example.x project_id="P-42" priority_score=0.85"`
    );
  });

  it("extension with no custom props", () => {
    const ext: OpenExtension = {
      id: "com.example.empty",
      extensionName: "com.example.empty",
    };
    expect(formatExtensionCompact(ext)).toMatchInlineSnapshot(
      `"com.example.empty name:com.example.empty"`
    );
  });
});

describe("formatSearchCompact", () => {
  it("empty results", () => {
    expect(formatSearchCompact([])).toMatchInlineSnapshot(`"No results."`);
  });

  it("groups results by list", () => {
    const baseTask: Omit<TodoTask, "id" | "title"> = {
      status: "notStarted",
      importance: "normal",
      isReminderOn: false,
      createdDateTime: "2026-05-04T10:00:00Z",
      lastModifiedDateTime: "2026-05-04T10:00:00Z",
    };
    const results: SearchResult[] = [
      {
        list: { id: "L1", displayName: "Work" },
        task: { ...baseTask, id: "T1", title: "Email" },
      },
      {
        list: { id: "L1", displayName: "Work" },
        task: { ...baseTask, id: "T2", title: "Meeting" },
      },
      {
        list: { id: "L2", displayName: "Personal" },
        task: { ...baseTask, id: "T3", title: "Groceries" },
      },
    ];
    expect(formatSearchCompact(results)).toMatchInlineSnapshot(`
      "3 result(s):

      "Work" (L1) — 2:
        T1 "Email"
        T2 "Meeting"

      "Personal" (L2) — 1:
        T3 "Groceries""
    `);
  });
});

describe("formatSummaryCompact", () => {
  const baseTask: Omit<TodoTask, "id" | "title"> = {
    status: "notStarted",
    importance: "normal",
    isReminderOn: false,
    createdDateTime: "2026-05-04T10:00:00Z",
    lastModifiedDateTime: "2026-05-04T10:00:00Z",
  };

  it("with both due-today and overdue tasks", () => {
    const summary: DailySummary = {
      date: "2026-05-04",
      totalDueToday: 1,
      totalOverdue: 1,
      byList: [
        {
          list: { id: "L1", displayName: "Work" },
          dueToday: [
            {
              ...baseTask,
              id: "T1",
              title: "Today",
              dueDateTime: { dateTime: "2026-05-04T18:00:00", timeZone: "UTC" },
            },
          ],
          overdue: [
            {
              ...baseTask,
              id: "T2",
              title: "Late",
              dueDateTime: { dateTime: "2026-04-30T10:00:00", timeZone: "UTC" },
            },
          ],
        },
      ],
    };
    expect(formatSummaryCompact(summary)).toMatchInlineSnapshot(`
      "2026-05-04 — 1 due today, 1 overdue

      Due today:
        "Work" (L1):
          T1 "Today" due:2026-05-04T18:00

      Overdue:
        "Work" (L1):
          T2 "Late" due:2026-04-30T10:00"
    `);
  });

  it("no tasks at all", () => {
    const summary: DailySummary = {
      date: "2026-05-04",
      totalDueToday: 0,
      totalOverdue: 0,
      byList: [],
    };
    expect(formatSummaryCompact(summary)).toMatchInlineSnapshot(
      `"2026-05-04 — 0 due today, 0 overdue"`
    );
  });
});

describe("formatBatchCompact", () => {
  it("all ok with formatter", () => {
    const results: BatchResultItem<{ id: string; name: string }>[] = [
      { index: 0, status: 201, ok: true, result: { id: "T1", name: "A" } },
      { index: 1, status: 201, ok: true, result: { id: "T2", name: "B" } },
    ];
    expect(
      formatBatchCompact(results, (x) => `${x.id} ${x.name}`)
    ).toMatchInlineSnapshot(`
      "2 ok / 0 err
      OK:
        [0] T1 A
        [1] T2 B"
    `);
  });

  it("mixed ok and err", () => {
    const results: BatchResultItem<{ id: string }>[] = [
      { index: 0, status: 201, ok: true, result: { id: "T1" } },
      { index: 1, status: 404, ok: false, error: "NotFound: gone" },
    ];
    expect(
      formatBatchCompact(results, (x) => x.id)
    ).toMatchInlineSnapshot(`
      "1 ok / 1 err
      OK:
        [0] T1
      Errors:
        [1] HTTP 404 — NotFound: gone"
    `);
  });

  it("no formatter omits OK details", () => {
    const results: BatchResultItem<null>[] = [
      { index: 0, status: 204, ok: true, result: null },
      { index: 1, status: 204, ok: true, result: null },
    ];
    expect(formatBatchCompact(results)).toMatchInlineSnapshot(
      `"2 ok / 0 err"`
    );
  });
});
