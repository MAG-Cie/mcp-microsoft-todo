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
  createTask,
  updateTask,
  deleteTask,
  completeTask,
} from "./graph.js";

const server = new Server(
  { name: "microsoft-todo", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Schémas Zod (validation runtime des args) ─────────────────────────────

const schemas = {
  list_task_lists: z.object({}),
  list_tasks: z.object({
    list_id: z.string().describe("ID de la liste To Do"),
    filter: z
      .string()
      .optional()
      .describe("Filtre OData, ex: \"status ne 'completed'\""),
    top: z.number().int().positive().max(100).optional(),
  }),
  create_task: z.object({
    list_id: z.string(),
    title: z.string(),
    body: z.string().optional(),
    importance: z.enum(["low", "normal", "high"]).optional(),
    due_date: z
      .string()
      .optional()
      .describe("ISO 8601, ex: 2026-05-15T18:00:00"),
    time_zone: z.string().optional().default("Europe/Paris"),
    categories: z.array(z.string()).optional(),
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
    importance: z.enum(["low", "normal", "high"]).optional(),
    body: z.string().optional(),
    due_date: z.string().optional(),
    time_zone: z.string().optional(),
  }),
  complete_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
  }),
  delete_task: z.object({
    list_id: z.string(),
    task_id: z.string(),
  }),
};

// ─── ListTools ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_task_lists",
      description:
        "Liste toutes les listes To Do de l'utilisateur (Tâches, Boîte de réception, listes custom).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_tasks",
      description:
        "Liste les tâches d'une liste To Do. Supporte filtre OData et limite.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          filter: { type: "string" },
          top: { type: "number" },
        },
        required: ["list_id"],
      },
    },
    {
      name: "create_task",
      description: "Crée une nouvelle tâche dans une liste To Do.",
      inputSchema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          importance: { type: "string", enum: ["low", "normal", "high"] },
          due_date: { type: "string" },
          time_zone: { type: "string" },
          categories: { type: "array", items: { type: "string" } },
        },
        required: ["list_id", "title"],
      },
    },
    {
      name: "update_task",
      description: "Met à jour une tâche existante (titre, statut, etc.).",
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
          importance: { type: "string", enum: ["low", "normal", "high"] },
          body: { type: "string" },
          due_date: { type: "string" },
          time_zone: { type: "string" },
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
  ],
}));

// ─── CallTool ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "list_task_lists": {
        schemas.list_task_lists.parse(args ?? {});
        const lists = await listTaskLists();
        return text(JSON.stringify(lists, null, 2));
      }
      case "list_tasks": {
        const a = schemas.list_tasks.parse(args);
        const tasks = await listTasks(a.list_id, {
          filter: a.filter,
          top: a.top,
        });
        return text(JSON.stringify(tasks, null, 2));
      }
      case "create_task": {
        const a = schemas.create_task.parse(args);
        const task = await createTask(a.list_id, {
          title: a.title,
          body: a.body,
          importance: a.importance,
          dueDateTime: a.due_date,
          timeZone: a.time_zone,
          categories: a.categories,
        });
        return text(JSON.stringify(task, null, 2));
      }
      case "update_task": {
        const a = schemas.update_task.parse(args);
        const task = await updateTask(a.list_id, a.task_id, {
          title: a.title,
          status: a.status,
          importance: a.importance,
          body: a.body,
          dueDateTime: a.due_date,
          timeZone: a.time_zone,
        });
        return text(JSON.stringify(task, null, 2));
      }
      case "complete_task": {
        const a = schemas.complete_task.parse(args);
        const task = await completeTask(a.list_id, a.task_id);
        return text(JSON.stringify(task, null, 2));
      }
      case "delete_task": {
        const a = schemas.delete_task.parse(args);
        await deleteTask(a.list_id, a.task_id);
        return text(`Tâche ${a.task_id} supprimée.`);
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
