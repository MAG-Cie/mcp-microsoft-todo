#!/usr/bin/env node
/**
 * MCP server for Microsoft To Do.
 * Transport: stdio (compatible with Claude Code and Claude Desktop).
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
  listTaskExtensions,
  setTaskExtension,
  deleteTaskExtension,
  listOverdueTasks,
  listTasksByCategory,
  bulkUpdateCategories,
  exportTasksIcs,
  type PatternedRecurrence,
  type CreateTaskInput,
} from "./graph.js";
import {
  formatTaskCompact,
  formatListCompact,
  formatChecklistCompact,
  formatLinkedCompact,
  formatExtensionCompact,
  formatSearchCompact,
  formatSummaryCompact,
  formatBatchCompact,
} from "./formatters.js";
import { t } from "./i18n.js";

const server = new Server(
  { name: "microsoft-todo", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Reusable Zod fragments ────────────────────────────────────────────────

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
    .describe(
      "If true: returns full JSON. Otherwise: compact text format (default, saves tokens)."
    ),
};

const paginateField = {
  paginate: z
    .boolean()
    .optional()
    .describe(
      "If true: follows @odata.nextLink up to 20 pages (≈2000 items max). Default false (1 page). Use sparingly — large result sets may exhaust the LLM context window."
    ),
};

const taskBaseFields = {
  body: z.string().optional(),
  importance: z.enum(["low", "normal", "high"]).optional(),
  due_date: z
    .string()
    .optional()
    .describe("ISO 8601, e.g. 2026-05-15T18:00:00"),
  time_zone: z.string().optional().default("Europe/Paris"),
  categories: z.array(z.string()).optional(),
  recurrence: recurrenceSchema.optional(),
  is_reminder_on: z.boolean().optional(),
  reminder_date_time: z
    .string()
    .optional()
    .describe("ISO 8601 of the reminder"),
  reminder_time_zone: z.string().optional(),
};

// ─── Zod tool schemas (runtime arg validation) ─────────────────────────────

const schemas = {
  list_task_lists: z.object({ ...verboseField, ...paginateField }),
  list_tasks: z.object({
    list_id: z.string().describe("ID of the To Do list"),
    filter: z
      .string()
      .optional()
      .describe("OData filter, e.g. \"status ne 'completed'\""),
    top: z.number().int().positive().max(100).optional(),
    orderby: z
      .string()
      .optional()
      .describe("OData $orderby, e.g. 'dueDateTime/dateTime asc'"),
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
  list_extensions: z.object({
    list_id: z.string(),
    task_id: z.string(),
    ...verboseField,
    ...paginateField,
  }),
  set_extension: z.object({
    list_id: z.string(),
    task_id: z.string(),
    extension_name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/, "extension_name: only letters, digits, '.', '_', '-' allowed")
      .describe("Unique name, ideally reverse-DNS, e.g. 'com.example.mydata'"),
    data: z
      .record(z.unknown())
      .describe(
        "Arbitrary JSON object (key/value) to store. Upsert: replaces if extension exists."
      ),
    ...verboseField,
  }),
  delete_extension: z.object({
    list_id: z.string(),
    task_id: z.string(),
    extension_name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/, "extension_name: only letters, digits, '.', '_', '-' allowed"),
  }),
  list_overdue_tasks: z.object({
    top_per_list: z.number().int().positive().max(100).optional(),
    ...verboseField,
  }),
  list_tasks_by_category: z.object({
    category: z.string().min(1),
    top_per_list: z.number().int().positive().max(100).optional(),
    include_completed: z.boolean().optional(),
    ...verboseField,
  }),
  bulk_update_categories: z.object({
    refs: z
      .array(z.object({ list_id: z.string(), task_id: z.string() }))
      .min(1)
      .max(100),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
    ...verboseField,
  }),
  export_tasks_ics: z.object({
    list_ids: z
      .array(z.string())
      .optional()
      .describe("Restrict to the given list IDs. If omitted: all lists."),
    include_completed: z.boolean().optional(),
    top_per_list: z.number().int().positive().max(500).optional(),
  }),
};

// ─── JSON Schemas for ListTools (mirror of Zod, advertised to LLM) ─────────

const recurrenceJsonSchema = {
  type: "object",
  description:
    "Microsoft Graph patternedRecurrence. Combines pattern (type, interval, ...) and range (type, startDate, ...).",
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
      "If true: returns full JSON. Otherwise: compact text format (default, saves tokens).",
  },
};

const paginateJsonProp = {
  paginate: {
    type: "boolean",
    description:
      "If true: follows @odata.nextLink up to 20 pages (≈2000 items max). Default false. Use sparingly — large result sets may exhaust the LLM context window.",
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
        "List all the user's To Do lists (Tasks, Inbox, custom lists, etc.).",
      inputSchema: {
        type: "object",
        properties: { ...verboseJsonProp, ...paginateJsonProp },
      },
    },
    {
      name: "list_tasks",
      description:
        "List the tasks of a To Do list. Supports OData filter, $orderby, $top, and pagination.",
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
      description: "Fetch a task's detail by ID.",
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
        "Create a new task in a To Do list. Supports recurrence and reminder.",
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
        "Update an existing task (title, status, recurrence, reminder, etc.).",
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
      description: "Shortcut to mark a task as completed.",
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
      description: "Delete a task permanently.",
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
        "Move a task from one list to another. Recreates the task in the target list (title, body, due, recurrence, reminder, categories preserved) then deletes the original. Note: checklistItems and linkedResources are NOT moved (Graph limitation). The task ID changes.",
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
        "Search a term in the titles of tasks across ALL lists (case-sensitive). By default excludes completed tasks.",
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
        "Summary of tasks due today and overdue, aggregated per list. Useful for the question \"what do I have to do today?\".",
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
      description: "List the sub-items (checklist) of a task.",
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
      description: "Add a sub-item (checklist) to a task.",
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
      description: "Update a sub-item (rename or check/uncheck).",
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
      description: "Delete a sub-item.",
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
        "List the linked resources (external URLs, third-party app refs) of a task.",
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
      description: "Attach a linked resource (URL or external ref) to a task.",
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
      description: "Delete a linked resource from a task.",
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
        "Create several tasks in a single HTTP call via Microsoft Graph $batch (up to 100 items, auto-chunked by 20). Returns: status + result OR error per item, in order. More efficient than N create_task calls.",
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
        "Mark several tasks as completed in a single $batch HTTP call (up to 100 items).",
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
        "Delete several tasks in a single $batch HTTP call (up to 100 items).",
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
      name: "list_extensions",
      description:
        "List the open extensions (custom JSON metadata) attached to a task.",
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
      name: "set_extension",
      description:
        "Create or update (upsert) an open extension on a task. Lets you attach arbitrary JSON metadata (project_id, external_ref, custom flags...) that persist in Microsoft Graph.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          extension_name: {
            type: "string",
            description:
              "Unique name, ideally reverse-DNS, e.g. 'com.example.mydata'",
          },
          data: {
            type: "object",
            description: "Arbitrary JSON object to store",
            additionalProperties: true,
          },
          ...verboseJsonProp,
        },
        required: ["list_id", "task_id", "extension_name", "data"],
      },
    },
    {
      name: "delete_extension",
      description: "Delete an open extension from a task.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          task_id: { type: "string" },
          extension_name: { type: "string" },
        },
        required: ["list_id", "task_id", "extension_name"],
      },
    },
    {
      name: "list_overdue_tasks",
      description:
        "List ALL overdue tasks (status ne completed and dueDateTime < today) across every list. Aggregated via Promise.all.",
      inputSchema: {
        type: "object",
        properties: {
          top_per_list: { type: "number" },
          ...verboseJsonProp,
        },
      },
    },
    {
      name: "list_tasks_by_category",
      description:
        "List ALL tasks containing a given category, across every list. OData filter: categories/any(c: c eq '...').",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string" },
          top_per_list: { type: "number" },
          include_completed: { type: "boolean" },
          ...verboseJsonProp,
        },
        required: ["category"],
      },
    },
    {
      name: "bulk_update_categories",
      description:
        "Add/remove categories on several tasks in one operation. 2-phase batch: GET to read existing categories, then PATCH with the updated set. Per-item errors, no global fail.",
      inputSchema: {
        type: "object",
        properties: {
          refs: {
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
          add: { type: "array", items: { type: "string" } },
          remove: { type: "array", items: { type: "string" } },
          ...verboseJsonProp,
        },
        required: ["refs"],
      },
    },
    {
      name: "export_tasks_ics",
      description:
        "Export tasks to iCalendar format (text/calendar VTODO) for import into Google Calendar, Apple Calendar, Outlook, Thunderbird, etc. Recurrence converted to RRULE when possible. Reminder converted to VALARM.",
      inputSchema: {
        type: "object",
        properties: {
          list_ids: { type: "array", items: { type: "string" } },
          include_completed: { type: "boolean" },
          top_per_list: { type: "number" },
        },
      },
    },
  ],
}));

// ─── CallTool ──────────────────────────────────────────────────────────────

// Helper: format according to verbose (compact JSON if true, otherwise text format)
function out<T>(value: T, verbose: boolean | undefined, formatter: (v: T) => string) {
  return text(verbose ? JSON.stringify(value) : formatter(value));
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "list_task_lists": {
        const a = schemas.list_task_lists.strict().parse(args ?? {});
        const lists = await listTaskLists({ paginate: a.paginate });
        return out(lists, a.verbose, (ls) =>
          ls.length === 0
            ? t.noLists
            : `${t.lists(ls.length)}\n${ls.map(formatListCompact).join("\n")}`
        );
      }
      case "list_tasks": {
        const a = schemas.list_tasks.strict().parse(args);
        const tasks = await listTasks(a.list_id, {
          filter: a.filter,
          top: a.top,
          orderby: a.orderby,
          paginate: a.paginate,
        });
        return out(tasks, a.verbose, (ts) =>
          ts.length === 0
            ? t.noTasks
            : `${t.tasks(ts.length)}\n${ts.map(formatTaskCompact).join("\n")}`
        );
      }
      case "get_task": {
        const a = schemas.get_task.strict().parse(args);
        const task = await getTask(a.list_id, a.task_id);
        return out(task, a.verbose, formatTaskCompact);
      }
      case "create_task": {
        const a = schemas.create_task.strict().parse(args);
        const task = await createTask(a.list_id, {
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
        return out(task, a.verbose, formatTaskCompact);
      }
      case "update_task": {
        const a = schemas.update_task.strict().parse(args);
        const task = await updateTask(a.list_id, a.task_id, {
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
        return out(task, a.verbose, formatTaskCompact);
      }
      case "complete_task": {
        const a = schemas.complete_task.strict().parse(args);
        const task = await completeTask(a.list_id, a.task_id);
        return out(task, a.verbose, formatTaskCompact);
      }
      case "delete_task": {
        const a = schemas.delete_task.strict().parse(args);
        await deleteTask(a.list_id, a.task_id);
        return text(t.taskDeleted(a.task_id));
      }
      case "move_task": {
        const a = schemas.move_task.strict().parse(args);
        const moved = await moveTask(a.source_list_id, a.task_id, a.target_list_id);
        return out(moved, a.verbose, (x) => t.moved(formatTaskCompact(x)));
      }
      case "search_tasks": {
        const a = schemas.search_tasks.strict().parse(args);
        const results = await searchTasks(a.query, {
          topPerList: a.top_per_list,
          includeCompleted: a.include_completed,
        });
        return out(results, a.verbose, formatSearchCompact);
      }
      case "summarize_today": {
        const a = schemas.summarize_today.strict().parse(args ?? {});
        const summary = await summarizeToday(a.time_zone);
        return out(summary, a.verbose, formatSummaryCompact);
      }
      case "list_checklist_items": {
        const a = schemas.list_checklist_items.strict().parse(args);
        const items = await listChecklistItems(a.list_id, a.task_id, {
          paginate: a.paginate,
        });
        return out(items, a.verbose, (xs) =>
          xs.length === 0
            ? t.noSubItems
            : xs.map(formatChecklistCompact).join("\n")
        );
      }
      case "create_checklist_item": {
        const a = schemas.create_checklist_item.strict().parse(args);
        const item = await createChecklistItem(
          a.list_id,
          a.task_id,
          a.display_name,
          a.is_checked
        );
        return out(item, a.verbose, formatChecklistCompact);
      }
      case "update_checklist_item": {
        const a = schemas.update_checklist_item.strict().parse(args);
        const item = await updateChecklistItem(a.list_id, a.task_id, a.item_id, {
          displayName: a.display_name,
          isChecked: a.is_checked,
        });
        return out(item, a.verbose, formatChecklistCompact);
      }
      case "delete_checklist_item": {
        const a = schemas.delete_checklist_item.strict().parse(args);
        await deleteChecklistItem(a.list_id, a.task_id, a.item_id);
        return text(t.subItemDeleted(a.item_id));
      }
      case "list_linked_resources": {
        const a = schemas.list_linked_resources.strict().parse(args);
        const rs = await listLinkedResources(a.list_id, a.task_id, {
          paginate: a.paginate,
        });
        return out(rs, a.verbose, (xs) =>
          xs.length === 0
            ? t.noLinkedRes
            : xs.map(formatLinkedCompact).join("\n")
        );
      }
      case "create_linked_resource": {
        const a = schemas.create_linked_resource.strict().parse(args);
        const r = await createLinkedResource(a.list_id, a.task_id, {
          webUrl: a.web_url,
          applicationName: a.application_name,
          displayName: a.display_name,
          externalId: a.external_id,
        });
        return out(r, a.verbose, formatLinkedCompact);
      }
      case "delete_linked_resource": {
        const a = schemas.delete_linked_resource.strict().parse(args);
        await deleteLinkedResource(a.list_id, a.task_id, a.resource_id);
        return text(t.linkedDeleted(a.resource_id));
      }
      case "batch_create_tasks": {
        const a = schemas.batch_create_tasks.strict().parse(args);
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
        const a = schemas.batch_complete_tasks.strict().parse(args);
        const results = await batchCompleteTasks(
          a.items.map((it) => ({ listId: it.list_id, taskId: it.task_id }))
        );
        return out(results, a.verbose, (rs) => formatBatchCompact(rs, formatTaskCompact));
      }
      case "batch_delete_tasks": {
        const a = schemas.batch_delete_tasks.strict().parse(args);
        const results = await batchDeleteTasks(
          a.items.map((it) => ({ listId: it.list_id, taskId: it.task_id }))
        );
        return out(results, a.verbose, (rs) => formatBatchCompact(rs));
      }
      case "list_extensions": {
        const a = schemas.list_extensions.strict().parse(args);
        const exts = await listTaskExtensions(a.list_id, a.task_id, {
          paginate: a.paginate,
        });
        return out(exts, a.verbose, (xs) =>
          xs.length === 0
            ? t.noExtensions
            : xs.map(formatExtensionCompact).join("\n")
        );
      }
      case "set_extension": {
        const a = schemas.set_extension.strict().parse(args);
        const ext = await setTaskExtension(
          a.list_id,
          a.task_id,
          a.extension_name,
          a.data
        );
        return out(ext, a.verbose, formatExtensionCompact);
      }
      case "delete_extension": {
        const a = schemas.delete_extension.strict().parse(args);
        await deleteTaskExtension(a.list_id, a.task_id, a.extension_name);
        return text(t.extensionDeleted(a.extension_name));
      }
      case "list_overdue_tasks": {
        const a = schemas.list_overdue_tasks.strict().parse(args ?? {});
        const results = await listOverdueTasks(a.top_per_list);
        return out(results, a.verbose, formatSearchCompact);
      }
      case "list_tasks_by_category": {
        const a = schemas.list_tasks_by_category.strict().parse(args);
        const results = await listTasksByCategory(a.category, {
          topPerList: a.top_per_list,
          includeCompleted: a.include_completed,
        });
        return out(results, a.verbose, formatSearchCompact);
      }
      case "bulk_update_categories": {
        const a = schemas.bulk_update_categories.strict().parse(args);
        const results = await bulkUpdateCategories(
          a.refs.map((r) => ({ listId: r.list_id, taskId: r.task_id })),
          { add: a.add, remove: a.remove }
        );
        return out(results, a.verbose, (rs) =>
          formatBatchCompact(rs, formatTaskCompact)
        );
      }
      case "export_tasks_ics": {
        const a = schemas.export_tasks_ics.strict().parse(args ?? {});
        const ics = await exportTasksIcs({
          listIds: a.list_ids,
          includeCompleted: a.include_completed,
          topPerList: a.top_per_list,
        });
        return text(ics);
      }
      default:
        throw new Error(t.unknownTool(name));
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: t.error(err.message) }],
    };
  }
});

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ─── Startup ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-microsoft-todo] ready\n");
}

main().catch((err) => {
  process.stderr.write(`[mcp-microsoft-todo] fatal: ${err.message}\n`);
  process.exit(1);
});
