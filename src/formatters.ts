/**
 * Compact formatters for token economy.
 * verbose=true on the handler side → JSON.stringify(value).
 * Otherwise → one-line-per-item text format via the functions below.
 *
 * Markers:
 *   [!] high    [?] low                          (importance, omitted if normal)
 *   [v] completed  [>] inProgress  [w] waitingOnOthers  [d] deferred  (omitted if notStarted)
 */
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

const STATUS_MARKER: Record<TodoTask["status"], string> = {
  notStarted: "",
  completed: "[v]",
  inProgress: "[>]",
  waitingOnOthers: "[w]",
  deferred: "[d]",
};

export function formatGraphDate(dt: string): string {
  // "2026-05-04T18:00:00.0000000" → "2026-05-04T18:00" (drop µs + T00:00:00 if just date)
  const trimmed = dt.replace(/\.\d+$/, "").replace(/:\d{2}$/, "");
  return trimmed.endsWith("T00:00") ? trimmed.slice(0, 10) : trimmed;
}

export function formatTaskCompact(t: TodoTask): string {
  const parts: string[] = [t.id];
  if (t.importance === "high") parts.push("[!]");
  else if (t.importance === "low") parts.push("[?]");
  const sm = STATUS_MARKER[t.status];
  if (sm) parts.push(sm);
  parts.push(JSON.stringify(t.title));
  if (t.dueDateTime) parts.push(`due:${formatGraphDate(t.dueDateTime.dateTime)}`);
  if (t.isReminderOn && t.reminderDateTime)
    parts.push(`rem:${formatGraphDate(t.reminderDateTime.dateTime)}`);
  if (t.recurrence) parts.push(`rec:${t.recurrence.pattern.type}`);
  if (t.categories?.length) parts.push(`cat:${t.categories.join(",")}`);
  const bodyContent = t.body?.content?.trim();
  if (bodyContent) {
    const truncated =
      bodyContent.length > 100 ? bodyContent.slice(0, 100) + "…" : bodyContent;
    parts.push(`body:${JSON.stringify(truncated.replace(/\s+/g, " "))}`);
  }
  return parts.join(" ");
}

export function formatListCompact(l: TodoTaskList): string {
  const parts = [l.id, JSON.stringify(l.displayName)];
  if (l.wellknownListName && l.wellknownListName !== "none")
    parts.push(`wk:${l.wellknownListName}`);
  if (l.isShared) parts.push("shared");
  if (!l.isOwner) parts.push("not-owner");
  return parts.join(" ");
}

export function formatChecklistCompact(c: ChecklistItem): string {
  return `${c.id} ${c.isChecked ? "[v]" : "[ ]"} ${JSON.stringify(c.displayName)}`;
}

export function formatLinkedCompact(r: LinkedResource): string {
  const parts = [r.id];
  if (r.applicationName) parts.push(`app:${r.applicationName}`);
  if (r.displayName) parts.push(`name:${JSON.stringify(r.displayName)}`);
  if (r.webUrl) parts.push(`url:${r.webUrl}`);
  if (r.externalId) parts.push(`ext:${r.externalId}`);
  return parts.join(" ");
}

export function formatExtensionCompact(e: OpenExtension): string {
  const customProps = Object.entries(e)
    .filter(
      ([k]) =>
        !k.startsWith("@odata") && k !== "id" && k !== "extensionName"
    )
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `${e.id} name:${e.extensionName}${customProps.length ? " " + customProps.join(" ") : ""}`;
}

export function formatSearchCompact(results: SearchResult[]): string {
  if (results.length === 0) return "No results.";
  const byList = new Map<string, { name: string; tasks: TodoTask[] }>();
  for (const r of results) {
    const e = byList.get(r.list.id) ?? { name: r.list.displayName, tasks: [] };
    e.tasks.push(r.task);
    byList.set(r.list.id, e);
  }
  const lines: string[] = [`${results.length} result(s):`];
  for (const [listId, { name, tasks }] of byList) {
    lines.push(`\n${JSON.stringify(name)} (${listId}) — ${tasks.length}:`);
    for (const t of tasks) lines.push(`  ${formatTaskCompact(t)}`);
  }
  return lines.join("\n");
}

export function formatSummaryCompact(s: DailySummary): string {
  const lines: string[] = [
    `${s.date} — ${s.totalDueToday} due today, ${s.totalOverdue} overdue`,
  ];
  const dueLists = s.byList.filter((l) => l.dueToday.length > 0);
  if (dueLists.length > 0) {
    lines.push("\nDue today:");
    for (const l of dueLists) {
      lines.push(`  ${JSON.stringify(l.list.displayName)} (${l.list.id}):`);
      for (const t of l.dueToday) lines.push(`    ${formatTaskCompact(t)}`);
    }
  }
  const lateLists = s.byList.filter((l) => l.overdue.length > 0);
  if (lateLists.length > 0) {
    lines.push("\nOverdue:");
    for (const l of lateLists) {
      lines.push(`  ${JSON.stringify(l.list.displayName)} (${l.list.id}):`);
      for (const t of l.overdue) lines.push(`    ${formatTaskCompact(t)}`);
    }
  }
  return lines.join("\n");
}

export function formatBatchCompact<T>(
  results: BatchResultItem<T>[],
  formatItem?: (item: T) => string
): string {
  const ok = results.filter((r) => r.ok);
  const err = results.filter((r) => !r.ok);
  const lines: string[] = [`${ok.length} ok / ${err.length} err`];
  if (ok.length > 0 && formatItem) {
    lines.push("OK:");
    for (const r of ok) {
      if (r.result) lines.push(`  [${r.index}] ${formatItem(r.result)}`);
    }
  }
  if (err.length > 0) {
    lines.push("Errors:");
    for (const r of err) {
      lines.push(`  [${r.index}] HTTP ${r.status} — ${r.error ?? "(no detail)"}`);
    }
  }
  return lines.join("\n");
}
