/**
 * Lightweight i18n for compact-format strings and short user-facing messages.
 *
 * Locale resolution order:
 *   1. MCP_LOCALE env var (e.g. "fr", "fr_FR", "en-US")
 *   2. LC_ALL / LANG env var (POSIX standard, e.g. "fr_FR.UTF-8")
 *   3. fallback "en"
 *
 * Only the first 2 chars are inspected. Unsupported locale → falls back to "en".
 *
 * The MCP server returns these strings to Claude as data; Claude already
 * translates to whatever language the human is using. Localizing here is a
 * minor optimization (saves the LLM mental translation hop) and a UX nicety
 * for direct stdio inspection.
 */

export const SUPPORTED_LOCALES = ["en", "fr", "es", "de"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

function detectLocale(): Locale {
  const candidates = [
    process.env.MCP_LOCALE,
    process.env.LC_ALL,
    process.env.LANG,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const code = c.toLowerCase().slice(0, 2);
    if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) {
      return code as Locale;
    }
  }
  return "en";
}

export const LOCALE: Locale = detectLocale();

interface Messages {
  noLists: string;
  lists: (n: number) => string;
  noTasks: string;
  tasks: (n: number) => string;
  noResults: string;
  results: (n: number) => string;
  noSubItems: string;
  noLinkedRes: string;
  noExtensions: string;
  summaryHeader: (date: string, due: number, overdue: number) => string;
  dueTodaySection: string;
  overdueSection: string;
  okErr: (ok: number, err: number) => string;
  okHeader: string;
  errHeader: string;
  noDetail: string;
  taskDeleted: (id: string) => string;
  subItemDeleted: (id: string) => string;
  linkedDeleted: (id: string) => string;
  extensionDeleted: (name: string) => string;
  moved: (compact: string) => string;
  error: (msg: string) => string;
  unknownTool: (name: string) => string;
}

const en: Messages = {
  noLists: "No lists.",
  lists: (n) => `${n} list(s):`,
  noTasks: "No tasks.",
  tasks: (n) => `${n} task(s):`,
  noResults: "No results.",
  results: (n) => `${n} result(s):`,
  noSubItems: "No sub-items.",
  noLinkedRes: "No linked resources.",
  noExtensions: "No extensions.",
  summaryHeader: (date, due, overdue) =>
    `${date} — ${due} due today, ${overdue} overdue`,
  dueTodaySection: "Due today:",
  overdueSection: "Overdue:",
  okErr: (ok, err) => `${ok} ok / ${err} err`,
  okHeader: "OK:",
  errHeader: "Errors:",
  noDetail: "(no detail)",
  taskDeleted: (id) => `Task ${id} deleted.`,
  subItemDeleted: (id) => `Sub-item ${id} deleted.`,
  linkedDeleted: (id) => `Linked resource ${id} deleted.`,
  extensionDeleted: (name) => `Extension ${name} deleted.`,
  moved: (compact) => `Moved. New ID: ${compact}`,
  error: (msg) => `Error: ${msg}`,
  unknownTool: (name) => `Unknown tool: ${name}`,
};

const fr: Messages = {
  noLists: "Aucune liste.",
  lists: (n) => `${n} liste(s) :`,
  noTasks: "Aucune tâche.",
  tasks: (n) => `${n} tâche(s) :`,
  noResults: "Aucun résultat.",
  results: (n) => `${n} résultat(s) :`,
  noSubItems: "Aucun sous-élément.",
  noLinkedRes: "Aucune ressource liée.",
  noExtensions: "Aucune extension.",
  summaryHeader: (date, due, overdue) =>
    `${date} — ${due} due aujourd'hui, ${overdue} en retard`,
  dueTodaySection: "Dues aujourd'hui :",
  overdueSection: "En retard :",
  okErr: (ok, err) => `${ok} ok / ${err} err`,
  okHeader: "OK :",
  errHeader: "Erreurs :",
  noDetail: "(pas de détail)",
  taskDeleted: (id) => `Tâche ${id} supprimée.`,
  subItemDeleted: (id) => `Sous-élément ${id} supprimé.`,
  linkedDeleted: (id) => `Ressource liée ${id} supprimée.`,
  extensionDeleted: (name) => `Extension ${name} supprimée.`,
  moved: (compact) => `Déplacée. Nouvel ID : ${compact}`,
  error: (msg) => `Erreur : ${msg}`,
  unknownTool: (name) => `Outil inconnu : ${name}`,
};

const es: Messages = {
  noLists: "Sin listas.",
  lists: (n) => `${n} lista(s):`,
  noTasks: "Sin tareas.",
  tasks: (n) => `${n} tarea(s):`,
  noResults: "Sin resultados.",
  results: (n) => `${n} resultado(s):`,
  noSubItems: "Sin sub-elementos.",
  noLinkedRes: "Sin recursos enlazados.",
  noExtensions: "Sin extensiones.",
  summaryHeader: (date, due, overdue) =>
    `${date} — ${due} vencen hoy, ${overdue} atrasadas`,
  dueTodaySection: "Vencen hoy:",
  overdueSection: "Atrasadas:",
  okErr: (ok, err) => `${ok} ok / ${err} err`,
  okHeader: "OK:",
  errHeader: "Errores:",
  noDetail: "(sin detalle)",
  taskDeleted: (id) => `Tarea ${id} eliminada.`,
  subItemDeleted: (id) => `Sub-elemento ${id} eliminado.`,
  linkedDeleted: (id) => `Recurso enlazado ${id} eliminado.`,
  extensionDeleted: (name) => `Extensión ${name} eliminada.`,
  moved: (compact) => `Movida. Nuevo ID: ${compact}`,
  error: (msg) => `Error: ${msg}`,
  unknownTool: (name) => `Herramienta desconocida: ${name}`,
};

const de: Messages = {
  noLists: "Keine Listen.",
  lists: (n) => `${n} Liste(n):`,
  noTasks: "Keine Aufgaben.",
  tasks: (n) => `${n} Aufgabe(n):`,
  noResults: "Keine Ergebnisse.",
  results: (n) => `${n} Ergebnis(se):`,
  noSubItems: "Keine Unterelemente.",
  noLinkedRes: "Keine verknüpften Ressourcen.",
  noExtensions: "Keine Erweiterungen.",
  summaryHeader: (date, due, overdue) =>
    `${date} — ${due} heute fällig, ${overdue} überfällig`,
  dueTodaySection: "Heute fällig:",
  overdueSection: "Überfällig:",
  okErr: (ok, err) => `${ok} ok / ${err} Fehler`,
  okHeader: "OK:",
  errHeader: "Fehler:",
  noDetail: "(kein Detail)",
  taskDeleted: (id) => `Aufgabe ${id} gelöscht.`,
  subItemDeleted: (id) => `Unterelement ${id} gelöscht.`,
  linkedDeleted: (id) => `Verknüpfte Ressource ${id} gelöscht.`,
  extensionDeleted: (name) => `Erweiterung ${name} gelöscht.`,
  moved: (compact) => `Verschoben. Neue ID: ${compact}`,
  error: (msg) => `Fehler: ${msg}`,
  unknownTool: (name) => `Unbekanntes Werkzeug: ${name}`,
};

const bundles: Record<Locale, Messages> = { en, fr, es, de };

export const t: Messages = bundles[LOCALE];
