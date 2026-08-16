/**
 * Чеки → витрати.
 *
 * Знімок чека бот і так уміє прочитати — бракувало лише того, щоб зчитане
 * десь осідало. Розбираємо вже готовий текст, а не сам знімок: другий
 * виклик із зображенням коштував би вдесятеро дорожче й нічого б не додав.
 */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildReceiptPrompt } from "./prompts";
import type { UserSettings } from "./settings";

export class ExpenseError extends Error {}

export const CATEGORIES = [
  "продукти",
  "кафе",
  "транспорт",
  "комуналка",
  "здоров'я",
  "побут",
  "одяг",
  "розваги",
  "інше",
] as const;

export interface Expense {
  key: string;
  at: number;
  merchant: string;
  total: number;
  category: string;
}

interface StoredExpense {
  at: number;
  merchant: string;
  total: number;
  category: string;
}

const monthPrefix = (userId: number, month: string) => `exp:${userId}:${month}:`;

/** Місяць запису як «2026-08» — за ним і групуються витрати. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/**
 * Чи схоже зчитане на чек. Дешева перевірка, щоб не показувати кнопку
 * «у витрати» під кожним актом і накладною.
 *
 * Межі слів виписані вручну: `\b` рахує словом лише латиницю, тож із
 * кирилицею він не спрацьовує зовсім — та сама пастка, що й у розпізнаванні
 * намірів для нагадувань.
 */
const RECEIPT_WORDS = /(^|[^\p{L}])(сума|разом|до сплати|total|грн|uah)([^\p{L}]|$)/iu;

export function looksLikeReceipt(text: string): boolean {
  return RECEIPT_WORDS.test(text) || text.includes("₴");
}

export function parseReceiptReply(raw: string): {
  merchant: string;
  total: number;
  category: string;
} {
  const cleaned = stripWrapper(raw);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new ExpenseError("Не зрозумів, що це за чек.");
  }

  let payload: { merchant?: string; total?: unknown; category?: string; error?: string };
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ExpenseError("Не зрозумів, що це за чек.");
  }

  if (payload.error) throw new ExpenseError(payload.error);

  const total = Number(payload.total);
  if (!Number.isFinite(total) || total <= 0) {
    throw new ExpenseError("Не знайшов на чеку підсумкової суми.");
  }

  const category = (payload.category ?? "").trim().toLowerCase();
  return {
    merchant: (payload.merchant ?? "").trim() || "без назви",
    total: Math.round(total * 100) / 100,
    category: (CATEGORIES as readonly string[]).includes(category) ? category : "інше",
  };
}

export async function readReceipt(
  env: Env,
  user: UserSettings,
  document: string,
): Promise<{ merchant: string; total: number; category: string }> {
  let raw: string;
  try {
    raw = await complete(
      env,
      user.llmModel,
      [
        { role: "system", content: buildReceiptPrompt([...CATEGORIES]) },
        { role: "user", content: `<receipt>\n${document}\n</receipt>` },
      ],
      0,
    );
  } catch (error) {
    throw error instanceof OpenRouterError ? new ExpenseError(error.message) : error;
  }
  return parseReceiptReply(raw);
}

const EXPENSE_TTL_SECONDS = 400 * 86_400;

export async function saveExpense(
  env: Env,
  userId: number,
  month: string,
  expense: { merchant: string; total: number; category: string },
  at: number = Date.now(),
): Promise<void> {
  const salt = Math.random().toString(36).slice(2, 8);
  const value: StoredExpense = { at, ...expense };
  await env.SETTINGS.put(
    `${monthPrefix(userId, month)}${String(at).padStart(14, "0")}:${salt}`,
    JSON.stringify(value),
    { expirationTtl: EXPENSE_TTL_SECONDS },
  );
}

export async function loadMonth(
  env: Env,
  userId: number,
  month: string,
): Promise<Expense[]> {
  const listed = await env.SETTINGS.list({
    prefix: monthPrefix(userId, month),
    limit: 1000,
  });
  const expenses: Expense[] = [];

  for (const entry of listed.keys) {
    const stored = await env.SETTINGS.get<StoredExpense>(entry.name, "json");
    if (stored && typeof stored.total === "number") {
      expenses.push({ key: entry.name, ...stored });
    }
  }

  return expenses;
}

export interface MonthSummary {
  total: number;
  count: number;
  byCategory: { category: string; total: number }[];
}

export function summarize(expenses: Expense[]): MonthSummary {
  const sums = new Map<string, number>();
  let total = 0;

  for (const expense of expenses) {
    total += expense.total;
    sums.set(expense.category, (sums.get(expense.category) ?? 0) + expense.total);
  }

  return {
    total: Math.round(total * 100) / 100,
    count: expenses.length,
    byCategory: [...sums.entries()]
      .map(([category, sum]) => ({ category, total: Math.round(sum * 100) / 100 }))
      .sort((a, b) => b.total - a.total),
  };
}

/** Витрати місяця у CSV. Формат той самий, що й для зчитаних документів. */
export function expensesToCsv(expenses: Expense[], formatDate: (at: number) => string): string {
  const rows = [["Дата", "Магазин", "Категорія", "Сума"].join(";")];
  for (const expense of expenses) {
    const merchant = expense.merchant.includes(";")
      ? `"${expense.merchant.replace(/"/g, '""')}"`
      : expense.merchant;
    rows.push(
      [formatDate(expense.at), merchant, expense.category, expense.total.toFixed(2)].join(";"),
    );
  }
  return rows.join("\n");
}
