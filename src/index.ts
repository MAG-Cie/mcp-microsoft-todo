#!/usr/bin/env node
/**
 * MCP server pour Microsoft To Do.
 * Transport : stdio (compatible Claude Code et Claude Desktop).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listTaskLists,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  moveTask,
  searchTasks,
  summarizeToday,
  listChecklistItems,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  listLinkedResources,
  createLinkedResource,
  deleteLinkedResource,
  batchCreateTasks,
  batchCompleteTasks,
  batchDeleteTasks,
  type PatternedRecurrence,
  type BatchResultItem,
  type CreateTaskInput,
  type TodoTask,
  type TodoTaskList,
  type ChecklistItem,
  type LinkedResource,
  type SearchResult,
  type DailySummary,
} from "./graph.js";

// ─── Formatters compacts (économie tokens) ─────────────────────────────────
// Verbose=true → JSON complet. Sinon, format texte 1 ligne / item.
// Markers : [!] high, [?] low, [v] completed, [>] inProgress, [w] waiting, [d] deferred.

const STATUS_MARKER: Record<TodoTask["status"], string> = {
  notStarted: "",
  completed: "[v]",
  inProgress: "[>]",
  waitingOnOthers: "[w]",
  deferred: "[d]",
};

function formatGraphDate(dt: string): string {
  // "2026-05-04T18:00:00.0000000" → "2026-05-04T18:00" (drop µs + T00:00:00 si juste date)
  const trimmed = dt.replace(/\.\d+$/, "").replace(/:\d{2}$/, "");
  return trimmed.endsWith("T00:00") ? trimmed.slice(0, 10) : trimmed;
}

function formatTaskCompact(t: TodoTask): string {
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

function formatListCompact(l: TodoTaskList): string {
  const parts = [l.id, JSON.stringify(l.displayName)];
  if (l.wellknownListName && l.wellknownListName !== "none")
    parts.push(`wk:${l.wellknownListName}`);
  if (l.isShared) parts.push("shared");
  if (!l.isOwner) parts.push("not-owner");
  return parts.join(" ");
}

function formatChecklistCompact(c: ChecklistItem): string {
  return `${c.id} ${c.isChecked ? "[v]" : "[ ]"} ${JSON.stringify(c.displayName)}`;
}

function formatLinkedCompact(r: LinkedResource): string {
  const parts = [r.id];
  if (r.applicationName) parts.push(`app:${r.applicationName}`);
  if (r.displayName) parts.push(`name:${JSON.stringify(r.displayName)}`);
  if (r.webUrl) parts.push(`url:${r.webUrl}`);
  if (r.externalId) parts.push(`ext:${r.externalId}`);
  return parts.join(" ");
}

function formatSearchCompact(results: SearchResult[]): string {
  if (results.length === 0) return "Aucun résultat.";
  const byList = new Map<string, { name: string; tasks: TodoTask[] }>();
  for (const r of results) {
    const e = byList.get(r.list.id) ?? { name: r.list.displayName, tasks: [] };
    e.tasks.push(r.task);
    byList.set(r.list.id, e);
  }
  const lines: string[] = [`${results.length} résultat(s) :`];
  for (const [listId, { name, tasks }] of byList) {
    lines.push(`\n${JSON.stringify(name)} (${listId}) — ${tasks.length} :`);
    for (const t of tasks) lines.push(`  ${formatTaskCompact(t)}`);
  }
  return lines.join("\n");
}

function formatBatchCompact<T>(
  results: BatchResultItem<T>[],
  formatItem?: (item: T) => string
): string {
  const ok = results.filter((r) => r.ok);
  const err = results.filter((r) => !r.ok);
  const lines: string[] = [`${ok.length} ok / ${err.length} err`];
  if (ok.length > 0 && formatItem) {
    lines.push("OK :");
    for (const r of ok) {
      if (r.result) lines.push(`  [${r.index}] ${formatItem(r.result)}`);
    }
  }
  if (err.length > 0) {
    lines.push("Erreurs :");
    for (const r of err) {
      lines.push(`  [${r.index}] HTTP ${r.status} — ${r.error ?? "(no detail)"}`);
    }
  }
  return lines.join("\n");
}

function formatSummaryCompact(s: DailySummary): string {
  const lines: string[] = [
    `${s.date} — ${s.totalDueToday} due aujourd'hui, ${s.totalOverdue} en retard`,
  ];
  const dueLists = s.byList.filter((l) => l.dueToday.length > 0);
  if (dueLists.length > 0) {
    lines.push("\nDues aujourd'hui :");
    for (const l of dueLists) {
      lines.push(`  ${JSON.stringify(l.list.displayName)} (${l.list.id}) :`);
      for (const t of l.dueToday) lines.push(`    ${formatTaskCompact(t)}`);
    }
  }
  const lateLists = s.byList.filter((l) => l.overdue.length > 0);
  if (lateLists.length > 0) {
    lines.push("\nEn retard :");
    for (const l of lateLists) {
      lines.push(`  ${JSON.stringify(l.list.displayName)} (${l.list.id}) :`);
      for (const t of l.overdue) lines.push(`    ${formatTaskCompact(t)}`);
    }
  }
  return lines.join("\n");
}

const server = new Server(
  { name: "microsoft-todo", version: "0.4.0" },
  { capabilities: { tools: {} } }
);

// ─── Schémas Zod réutilisables ─────────────────────────────────────────────

const dayOfWeek = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const recurrenceSchema = z
  .object({
    pattern: z.object({
      type: z.enum([
        "daily",
        "weekly",
        "absoluteMonthly",
        "relativeMonthly",
        "absoluteYearly",
        "relativeYearly",
      ]),
      interval: z.number().int().positive(),
      daysOfWeek: z.array(dayOfWeek).optional(),
      firstDayOfWeek: dayOfWeek.optional(),
      dayOfMonth: z.number().int().positive().optional(),
      weekIndex: z.enum(["first", "second", "third", "fourth", "last"]).optional(),
      month: z.number().int().min(1).max(12).optional(),
      index: z.enum(["first", "second", "third", "fourth", "last"]).optional(),
    }),
    range: z.object({
      type: z.enum(["endDate", "noEnd", "numbered"]),
      startDate: z.string(),
      endDate: z.string().optional(),
      numberOfOccurrences: z.number().int().nonnegative().optional(),
      recurrenceTimeZone: z.string().optional(),
    }),
  })
  .strict();

const verboseField = {
  verbose: z
    .boolean()
    .optional()
    .describe("Si true : retourne le JSON complet. Sinon : format compact texte (défaut, économise les tokens)."),
};

const paginateField = {
  paginate: z
    .boolean()
    .optional()
    .describe("Si true : suit @odata.nextLink jusqu'à 50 pages (récupère TOUTES les entrées). Défaut false (1 page)."),
};

const taskBaseFields = {
  body: z.string().optional(),
  importance: z.enum(["low", "normal", "high"]).optional(),
  due_date: z
    .string()
    .optional()
    .describe("ISO 8601, ex: 2026-05-15T18:00:00"),
  time_zone: z.string().optional().default("Europe/Paris"),
  categories: z.array(z.string()).optional(),
  recurrence: recurrenceSchema.optional(),
  is_reminder_on: z.boolean().optional(),
  reminder_date_time: z
    .string()
    .optional()
    .describe("ISO 8601 du rappel"),
  reminder_time_zone: z.string().optional(),
};

// ─── Schémas Zod (validation runtime des args) ─────────────────────────────

const schemas = {
  list_task_lists: z.object({ ...verboseField, ...paginateField }),
  list_tasks: z.object({
    list_id: z.string().describe("ID de la liste To Do"),
    filter: z
      .string()
      .optional()
      .describe("Filtre OData, ex: \"status ne 'completed'\""),
    top: z.number().int().positive().max(100).optional(),
    orderby: z.string().optional().describe("OData $orderby, ex: 'dueDateTime/dateTime asc'"),
    ...verboseField,
    ...paginateField,
  }),
  get_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
    ...verboseField,
  }),
  create_task: z.object({
    list_id: z.string(),
    title: z.string(),
    ...taskBaseFields,
    ...verboseField,
  }),
  update_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
    title: z.string().optional(),
    status: z
      .enum([
        "notStarted",
        "inProgress",
        "completed",
        "waitingOnOthers",
        "deferred",
      ])
      .optional(),
    ...taskBaseFields,
    ...verboseField,
  }),
  complete_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
    ...verboseField,
  }),
  delete_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
  }),
  move_task: z.object({
    source_list_id: z.string(),
    task_id: z.string(),
    target_list_id: z.string(),
    ...verboseField,
  }),
  search_tasks: z.object({
    query: z.string().min(1),
    top_per_list: z.number().int().positive().max(100).optional(),
    include_completed: z.boolean().optional(),
    ...verboseField,
  }),
  summarize_today: z.object({
    time_zone: z.string().optional(),
    ...verboseField,
  }),
  list_checklist_items: z.object({
    list_id: z.string(),
    task_id: z.string(),
    ...verboseField,
    ...paginateField,
  }),
  create_checklist_item: z.object({
    list_id: z.string(),
    task_id: z.string(),
    display_name: z.string(),
    is_checked: z.boolean().optional(),
    ...verboseField,
  }),
  update_checklist_item: z.object({
    list_id: z.string(),
    task_id: z.string(),
    item_id: z.string(),
    display_name: z.string().optional(),
    is_checked: z.boolean().optional(),
    ...verboseField,
  }),
  delete_checklist_item: z.object({
    list_id: z.string(),
    task_id: z.string(),
    item_id: z.string(),
  }),
  list_linked_resources: z.object({
    list_id: z.string(),
    task_id: z.string(),
    ...verboseField,
    ...paginateField,
  }),
  create_linked_resource: z.object({
    list_id: z.string(),
    task_id: z.string(),
    web_url: z.string().url().optional(),
    application_name: z.string().optional(),
    display_name: z.string().optional(),
    external_id: z.string().optional(),
    ...verboseField,
  }),
  delete_linked_resource: z.object({
    list_id: z.string(),
    task_id: z.string(),
    resource_id: z.string(),
  }),
  batch_create_tasks: z.object({
    items: z
      .array(
        z.object({
          list_id: z.string(),
          title: z.string(),
          ...taskBaseFields,
        })
      )
      .min(1)
      .max(100),
    ...verboseField,
  }),
  batch_complete_tasks: z.object({
    items: z
      .array(z.object({ list_id: z.string(), task_id: z.string() }))
      .min(1)
      .max(100),
    ...verboseField,
  }),
  batch_delete_tasks: z.object({
    items: z
      .array(z.object({ list_id: z.string(), task_id: z.string() }))
      .min(1)
      .max(100),
    ...verboseField,
  }),
};

// ─── JSON Schemas pour ListTools (mirror simplifié des Zod) ────────────────

const recurrenceJsonSchema = {
  type: "object",
  description:
    "Récurrence patternedRecurrence Microsoft Graph. Combine pattern (type, interval, ...) et range (type, startDate, ...).",
  properties: {
    pattern: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "daily",
            "weekly",
            "absoluteMonthly",
            "relativeMonthly",
            "absoluteYearly",
            "relativeYearly",
          ],
        },
        interval: { type: "number" },
        daysOfWeek: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ],
          },
        },
      },
      required: ["type", "interval"],
    },
    range: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["endDate", "noEnd", "numbered"] },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string" },
        numberOfOccurrences: { type: "number" },
        recurrenceTimeZone: { type: "string" },
      },
      required: ["type", "startDate"],
    },
  },
  required: ["pattern", "range"],
};

const verboseJsonProp = {
  verbose: {
    type: "boolean",
    description:
      "Si true : retourne le JSON complet. Sinon : format compact texte (défaut, économise les tokens).",
  },
};

const paginateJsonProp = {
  paginate: {
    type: "boolean",
    description:
      "Si true : suit @odata.nextLink jusqu'à 50 pages (récupère TOUTES les entrées). Défaut false.",
  },
};

const taskBaseJsonProps = {
  body: { type: "string" },
  importance: { type: "string", enum: ["low", "normal", "high"] },
  due_date: { type: "string", description: "ISO 8601" },
  time_zone: { type: "string" },
  categories: { type: "array", items: { type: "string" } },
  recurrence: recurrenceJsonSchema,
  is_reminder_on: { type: "boolean" },
  reminder_date_time: { type: "string", description: "ISO 8601" },
  reminder_time_zone: { type: "string" },
};

// ─── ListTools ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_task_lists",
      description:
        "Liste toutes les listes To Do de l'utilisateur (Tâches, Boîte de réception, listes custom).",
      inputSchema: {
        type: "object",
        properties: { ...verboseJsonProp, ...paginateJsonProp },
      },
    },
    {
      name: "list_tasks",
      description:
        "Liste les tâches d'une liste To Do. Supporte filtre OData, $orderby, et limite.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          filter: { type: "string" },
          top: { type: "number" },
          orderby: { type: "string" },
          ...verboseJsonProp,
          ...paginateJsonProp,
        },
        required: ["list_id"],
      },
    },
    {
      name: "get_task",
      description: "Récupère le détail d'une tâche par son ID.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "create_task",
      description:
        "Crée une nouvelle tâche dans une liste To Do. Supporte récurrence et rappel.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          title: { type: "string" },
          ...taskBaseJsonProps,
          ...verboseJsonProp,
        },
        required: ["list_id", "title"],
      },
    },
    {
      name: "update_task",
      description:
        "Met à jour une tâche existante (titre, statut, récurrence, rappel, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          title: { type: "string" },
          status: {
            type: "string",
            enum: [
              "notStarted",
              "inProgress",
              "completed",
              "waitingOnOthers",
              "deferred",
            ],
          },
          ...taskBaseJsonProps,
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "complete_task",
      description: "Raccourci pour marquer une tâche comme complétée.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "delete_task",
      description: "Supprime définitivement une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "move_task",
      description:
        "Déplace une tâche d'une liste à une autre. Recrée la tâche dans la liste cible (titre, body, due, recurrence, reminder, categories préservés) puis supprime l'originale. Note : les checklistItems et linkedResources NE sont PAS déplacés (limite Graph). L'ID de la tâche change.",
      inputSchema: {
        type: "object",
        properties: {
          source_list_id: { type: "string" },
          task_id: { type: "string" },
          target_list_id: { type: "string" },
          ...verboseJsonProp,
        },
        required: ["source_list_id", "task_id", "target_list_id"],
      },
    },
    {
      name: "search_tasks",
      description:
        "Recherche un terme dans les titres des tâches de TOUTES les listes (case-sensitive). Par défaut exclut les complétées.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          top_per_list: { type: "number" },
          include_completed: { type: "boolean" },
          ...verboseJsonProp,
        },
        required: ["query"],
      },
    },
    {
      name: "summarize_today",
      description:
        "Résumé des tâches dues aujourd'hui et en retard, agrégées par liste. Utile pour la question 'qu'est-ce que j'ai à faire aujourd'hui ?'.",
      inputSchema: {
        type: "object",
        properties: {
          time_zone: { type: "string" },
          ...verboseJsonProp,
        },
      },
    },
    {
      name: "list_checklist_items",
      description: "Liste les sous-éléments (checklist) d'une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          ...verboseJsonProp,
          ...paginateJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "create_checklist_item",
      description: "Ajoute un sous-élément (checklist) à une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          display_name: { type: "string" },
          is_checked: { type: "boolean" },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id", "display_name"],
      },
    },
    {
      name: "update_checklist_item",
      description: "Modifie un sous-élément (renommer ou cocher/décocher).",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          item_id: { type: "string" },
          display_name: { type: "string" },
          is_checked: { type: "boolean" },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id", "item_id"],
      },
    },
    {
      name: "delete_checklist_item",
      description: "Supprime un sous-élément.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          item_id: { type: "string" },
        },
        required: ["list_id", "task_id", "item_id"],
      },
    },
    {
      name: "list_linked_resources",
      description:
        "Liste les ressources liées (URLs externes, refs d'apps tierces) d'une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          ...verboseJsonProp,
          ...paginateJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "create_linked_resource",
      description: "Attache une ressource liée (URL ou ref externe) à une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          web_url: { type: "string" },
          application_name: { type: "string" },
          display_name: { type: "string" },
          external_id: { type: "string" },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id"],
      },
    },
    {
      name: "delete_linked_resource",
      description: "Supprime une ressource liée d'une tâche.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          resource_id: { type: "string" },
        },
        required: ["list_id", "task_id", "resource_id"],
      },
    },
    {
      name: "batch_create_tasks",
      description:
        "Crée plusieurs tâches en un seul appel HTTP via Microsoft Graph $batch (jusqu'à 100 items, chunked auto par 20). Retour : statut + résultat OU erreur par item dans l'ordre. Plus économe que N appels create_task.",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                list_id: { type: "string" },
                title: { type: "string" },
                ...taskBaseJsonProps,
              },
              required: ["list_id", "title"],
            },
          },
          ...verboseJsonProp,
        },
        required: ["items"],
      },
    },
    {
      name: "batch_complete_tasks",
      description:
        "Marque plusieurs tâches comme complétées en un seul appel HTTP $batch (jusqu'à 100 items).",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                list_id: { type: "string" },
                task_id: { type: "string" },
              },
              required: ["list_id", "task_id"],
            },
          },
          ...verboseJsonProp,
        },
        required: ["items"],
      },
    },
    {
      name: "batch_delete_tasks",
      description:
        "Supprime plusieurs tâches en un seul appel HTTP $batch (jusqu'à 100 items).",
      inputSchema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                list_id: { type: "string" },
                task_id: { type: "string" },
              },
              required: ["list_id", "task_id"],
            },
          },
          ...verboseJsonProp,
        },
        required: ["items"],
      },
    },
  ],
}));

// ─── CallTool ──────────────────────────────────────────────────────────────

// Helper : formatte selon verbose (JSON compact si true, sinon format texte)
function out<T>(value: T, verbose: boolean | undefined, formatter: (v: T) => string) {
  return text(verbose ? JSON.stringify(value) : formatter(value));
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "list_task_lists": {
        const a = schemas.list_task_lists.parse(args ?? {});
        const lists = await listTaskLists({ paginate: a.paginate });
        return out(lists, a.verbose, (ls) =>
          ls.length === 0
            ? "Aucune liste."
            : `${ls.length} liste(s) :\n${ls.map(formatListCompact).join("\n")}`
        );
      }
      case "list_tasks": {
        const a = schemas.list_tasks.parse(args);
        const tasks = await listTasks(a.list_id, {
          filter: a.filter,
          top: a.top,
          orderby: a.orderby,
          paginate: a.paginate,
        });
        return out(tasks, a.verbose, (ts) =>
          ts.length === 0
            ? "Aucune tâche."
            : `${ts.length} tâche(s) :\n${ts.map(formatTaskCompact).join("\n")}`
        );
      }
      case "get_task": {
        const a = schemas.get_task.parse(args);
        const t = await getTask(a.list_id, a.task_id);
        return out(t, a.verbose, formatTaskCompact);
      }
      case "create_task": {
        const a = schemas.create_task.parse(args);
        const t = await createTask(a.list_id, {
          title: a.title,
          body: a.body,
          importance: a.importance,
          dueDateTime: a.due_date,
          timeZone: a.time_zone,
          categories: a.categories,
          recurrence: a.recurrence as PatternedRecurrence | undefined,
          isReminderOn: a.is_reminder_on,
          reminderDateTime: a.reminder_date_time,
          reminderTimeZone: a.reminder_time_zone,
        });
        return out(t, a.verbose, formatTaskCompact);
      }
      case "update_task": {
        const a = schemas.update_task.parse(args);
        const t = await updateTask(a.list_id, a.task_id, {
          title: a.title,
          status: a.status,
          importance: a.importance,
          body: a.body,
          dueDateTime: a.due_date,
          timeZone: a.time_zone,
          categories: a.categories,
          recurrence: a.recurrence as PatternedRecurrence | undefined,
          isReminderOn: a.is_reminder_on,
          reminderDateTime: a.reminder_date_time,
          reminderTimeZone: a.reminder_time_zone,
        });
        return out(t, a.verbose, formatTaskCompact);
      }
      case "complete_task": {
        const a = schemas.complete_task.parse(args);
        const t = await completeTask(a.list_id, a.task_id);
        return out(t, a.verbose, formatTaskCompact);
      }
      case "delete_task": {
        const a = schemas.delete_task.parse(args);
        await deleteTask(a.list_id, a.task_id);
        return text(`Tâche ${a.task_id} supprimée.`);
      }
      case "move_task": {
        const a = schemas.move_task.parse(args);
        const t = await moveTask(a.source_list_id, a.task_id, a.target_list_id);
        return out(t, a.verbose, (x) => `Déplacée. Nouveau ID : ${formatTaskCompact(x)}`);
      }
      case "search_tasks": {
        const a = schemas.search_tasks.parse(args);
        const results = await searchTasks(a.query, {
          topPerList: a.top_per_list,
          includeCompleted: a.include_completed,
        });
        return out(results, a.verbose, formatSearchCompact);
      }
      case "summarize_today": {
        const a = schemas.summarize_today.parse(args ?? {});
        const summary = await summarizeToday(a.time_zone);
        return out(summary, a.verbose, formatSummaryCompact);
      }
      case "list_checklist_items": {
        const a = schemas.list_checklist_items.parse(args);
        const items = await listChecklistItems(a.list_id, a.task_id, {
          paginate: a.paginate,
        });
        return out(items, a.verbose, (xs) =>
          xs.length === 0
            ? "Aucun sous-élément."
            : xs.map(formatChecklistCompact).join("\n")
        );
      }
      case "create_checklist_item": {
        const a = schemas.create_checklist_item.parse(args);
        const item = await createChecklistItem(
          a.list_id,
          a.task_id,
          a.display_name,
          a.is_checked
        );
        return out(item, a.verbose, formatChecklistCompact);
      }
      case "update_checklist_item": {
        const a = schemas.update_checklist_item.parse(args);
        const item = await updateChecklistItem(a.list_id, a.task_id, a.item_id, {
          displayName: a.display_name,
          isChecked: a.is_checked,
        });
        return out(item, a.verbose, formatChecklistCompact);
      }
      case "delete_checklist_item": {
        const a = schemas.delete_checklist_item.parse(args);
        await deleteChecklistItem(a.list_id, a.task_id, a.item_id);
        return text(`Sous-élément ${a.item_id} supprimé.`);
      }
      case "list_linked_resources": {
        const a = schemas.list_linked_resources.parse(args);
        const rs = await listLinkedResources(a.list_id, a.task_id, {
          paginate: a.paginate,
        });
        return out(rs, a.verbose, (xs) =>
          xs.length === 0
            ? "Aucune ressource liée."
            : xs.map(formatLinkedCompact).join("\n")
        );
      }
      case "create_linked_resource": {
        const a = schemas.create_linked_resource.parse(args);
        const r = await createLinkedResource(a.list_id, a.task_id, {
          webUrl: a.web_url,
          applicationName: a.application_name,
          displayName: a.display_name,
          externalId: a.external_id,
        });
        return out(r, a.verbose, formatLinkedCompact);
      }
      case "delete_linked_resource": {
        const a = schemas.delete_linked_resource.parse(args);
        await deleteLinkedResource(a.list_id, a.task_id, a.resource_id);
        return text(`Ressource liée ${a.resource_id} supprimée.`);
      }
      case "batch_create_tasks": {
        const a = schemas.batch_create_tasks.parse(args);
        const items: Array<{ listId: string; task: CreateTaskInput }> = a.items.map(
          (it) => ({
            listId: it.list_id,
            task: {
              title: it.title,
              body: it.body,
              importance: it.importance,
              dueDateTime: it.due_date,
              timeZone: it.time_zone,
              categories: it.categories,
              recurrence: it.recurrence as PatternedRecurrence | undefined,
              isReminderOn: it.is_reminder_on,
              reminderDateTime: it.reminder_date_time,
              reminderTimeZone: it.reminder_time_zone,
            },
          })
        );
        const results = await batchCreateTasks(items);
        return out(results, a.verbose, (rs) => formatBatchCompact(rs, formatTaskCompact));
      }
      case "batch_complete_tasks": {
        const a = schemas.batch_complete_tasks.parse(args);
        const results = await batchCompleteTasks(
          a.items.map((it) => ({ listId: it.list_id, taskId: it.task_id }))
        );
        return out(results, a.verbose, (rs) => formatBatchCompact(rs, formatTaskCompact));
      }
      case "batch_delete_tasks": {
        const a = schemas.batch_delete_tasks.parse(args);
        const results = await batchDeleteTasks(
          a.items.map((it) => ({ listId: it.list_id, taskId: it.task_id }))
        );
        return out(results, a.verbose, (rs) => formatBatchCompact(rs));
      }
      default:
        throw new Error(`Outil inconnu: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Erreur: ${err.message}` }],
    };
  }
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ─── Démarrage ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-microsoft-todo] ready\n");
}

main().catch((err) => {
  process.stderr.write(`[mcp-microsoft-todo] fatal: ${err.message}\n`);
  process.exit(1);
});
