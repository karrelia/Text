/** Обробка текстових команд. */

import { type Env, PROVIDER_TITLES } from "../env";
import {
  PREFIX,
  PRESET_LLM_MODELS,
  PRESET_VISION_MODELS,
  expensesKeyboard,
  historyKeyboard,
  listKeyboard,
  modelsKeyboard,
  providersKeyboard,
  remindersKeyboard,
  stylesKeyboard,
} from "../keyboards";
import {
  OpenRouterError,
  fetchCredits,
  listModels,
  modelExists,
  searchModels,
} from "../openrouter";
import {
  MAX_PER_USER,
  ReminderError,
  keyTail,
  listReminders,
  planReminder,
  saveReminder,
} from "../reminders";
import { recent, search, stampOf } from "../history";
import { loadMonth, monthOf, summarize } from "../expenses";
import { addItems, itemTail, listId, listNames, loadList } from "../lists";
import { showList } from "../pipeline";
import {
  MAX_BODY_LENGTH,
  MAX_TEMPLATES,
  deleteTemplate,
  listTemplates,
  loadTemplate,
  nameTooLong,
  saveTemplate,
  templateId,
} from "../templates";
import { DEFAULT_TIMEZONE, formatLocal, localDay } from "../timezone";
import { STYLES, selectHintTerms } from "../prompts";
import {
  loadLastTranscript,
  loadSettings,
  resetSettings,
  spentToday,
  updateSettings,
} from "../settings";
import type { TelegramClient, TgMessage } from "../telegram";
import * as texts from "../texts";

export const COMMANDS = [
  { command: "settings", description: "Поточні налаштування" },
  { command: "model", description: "Модель обробки тексту" },
  { command: "style", description: "Стиль обробки" },
  { command: "stt", description: "Рушій розпізнавання мови" },
  { command: "vision", description: "Модель для читання фото" },
  { command: "remind", description: "Створити нагадування" },
  { command: "reminders", description: "Список нагадувань" },
  { command: "autoremind", description: "Нагадування без команди" },
  { command: "list", description: "Списки: покупки, справи" },
  { command: "expenses", description: "Витрати за місяць" },
  { command: "template", description: "Шаблони документів" },
  { command: "find", description: "Пошук по надиктованому" },
  { command: "history", description: "Останні записи" },
  { command: "usage", description: "Витрати на OpenRouter" },
  { command: "glossary", description: "Імена й терміни" },
  { command: "prompt", description: "Додаткові побажання" },
  { command: "reset", description: "Скинути налаштування" },
  { command: "help", description: "Довідка" },
];

/** Розбирає "/model claude" та "/model@my_bot claude". */
export function parseCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

/**
 * Звідки брати текст нагадування: явний аргумент команди, повідомлення, на
 * яке відповіли, або остання розшифровка. Останнє — головний шлях: у
 * Telegram відповідати на повідомлення незручно, а `/remind` одразу після
 * голосового це найчастіший сценарій.
 */
export function pickReminderSource(
  args: string,
  replied: string,
  last: string,
): { source: string; fromHistory: boolean } {
  if (args.trim()) return { source: args, fromHistory: false };
  if (replied.trim()) return { source: replied, fromHistory: false };
  return { source: last, fromHistory: Boolean(last.trim()) };
}

export async function handleCommand(
  env: Env,
  tg: TelegramClient,
  message: TgMessage,
  userId: number,
  name: string,
  args: string,
): Promise<void> {
  const chatId = message.chat.id;
  const html = { html: true } as const;

  switch (name) {
    case "start":
      await tg.sendMessage(chatId, texts.START, html);
      return;

    case "help":
      await tg.sendMessage(chatId, texts.HELP, html);
      return;

    case "settings": {
      const user = await loadSettings(env, userId);
      await tg.sendMessage(chatId, texts.renderSettings(user), html);
      return;
    }

    case "reset": {
      await resetSettings(env, userId);
      const user = await loadSettings(env, userId);
      await tg.sendMessage(
        chatId,
        `${texts.RESET_DONE}\n\n${texts.renderSettings(user)}`,
        html,
      );
      return;
    }

    case "model":
      await handleModel(env, tg, chatId, userId, args);
      return;

    case "vision":
      await handleVision(env, tg, chatId, userId, args);
      return;

    case "remind":
      await handleRemind(env, tg, message, userId, args);
      return;

    case "reminders":
      await handleReminders(env, tg, chatId, userId);
      return;

    case "find":
    case "history":
      await handleHistory(env, tg, chatId, userId, name === "find" ? args : "");
      return;

    case "expenses": {
      const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
      const month = monthOf(localDay(new Date(), timeZone));
      const expenses = await loadMonth(env, userId, month);
      if (expenses.length === 0) {
        await tg.sendMessage(chatId, texts.EXPENSES_EMPTY(month), html);
        return;
      }
      await tg.sendMessage(chatId, texts.expensesSummary(month, summarize(expenses)), {
        html: true,
        keyboard: expensesKeyboard(texts.EXPENSE_CSV_BUTTON),
      });
      return;
    }

    case "list":
    case "lists":
      await handleLists(env, tg, chatId, userId, args);
      return;

    case "template":
    case "templates":
      await handleTemplate(env, tg, chatId, userId, args);
      return;

    case "autoremind": {
      const user = await loadSettings(env, userId);
      const next = !user.autoRemind;
      await updateSettings(env, userId, { autoRemind: next });
      await tg.sendMessage(
        chatId,
        next ? texts.AUTO_REMIND_ON : texts.AUTO_REMIND_OFF,
        html,
      );
      return;
    }

    case "usage": {
      const today = await spentToday(
        env,
        userId,
        localDay(new Date(), env.TIMEZONE || DEFAULT_TIMEZONE),
      );
      try {
        const { spent, granted } = await fetchCredits(env);
        await tg.sendMessage(chatId, texts.USAGE(spent, granted, today), html);
      } catch (error) {
        const reason = error instanceof OpenRouterError ? error.message : String(error);
        await tg.sendMessage(chatId, texts.USAGE_FAILED(reason), html);
      }
      return;
    }

    case "style": {
      const user = await loadSettings(env, userId);
      const style = STYLES[user.style] ?? STYLES.clean!;
      await tg.sendMessage(chatId, texts.STYLE_PICK(style.title), {
        html: true,
        keyboard: stylesKeyboard(user.style),
      });
      return;
    }

    case "stt": {
      const user = await loadSettings(env, userId);
      await tg.sendMessage(chatId, texts.STT_PICK(PROVIDER_TITLES[user.sttProvider]), {
        html: true,
        keyboard: providersKeyboard(env, user.sttProvider),
      });
      return;
    }

    case "glossary":
      await handleTextSetting(env, tg, chatId, userId, "glossary", args, texts.GLOSSARY_HELP);
      return;

    case "prompt":
      await handleTextSetting(env, tg, chatId, userId, "extraPrompt", args, texts.PROMPT_HELP);
      return;

    default:
      await tg.sendMessage(chatId, texts.HELP, html);
  }
}

async function handleModel(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  query: string,
): Promise<void> {
  const user = await loadSettings(env, userId);

  if (!query) {
    await tg.sendMessage(chatId, texts.MODEL_HELP(user.llmModel), {
      html: true,
      keyboard: modelsKeyboard(PRESET_LLM_MODELS, user.llmModel),
    });
    return;
  }

  // Схоже на точний ідентифікатор — ставимо одразу.
  if (query.includes("/") && !query.includes(" ")) {
    if ((await modelExists(env, query)) === false) {
      await tg.sendMessage(chatId, texts.MODEL_UNKNOWN(query), { html: true });
      return;
    }
    await updateSettings(env, userId, { llmModel: query });
    await tg.sendMessage(
      chatId,
      `${texts.SETTINGS_SAVED} Модель: <code>${texts.escapeHtml(query)}</code>`,
      { html: true },
    );
    return;
  }

  const matches = await searchModels(env, query);
  if (matches.length === 0) {
    await tg.sendMessage(chatId, texts.NO_MATCHES(query), { html: true });
    return;
  }

  await tg.sendMessage(chatId, `Знайшов за запитом «${texts.escapeHtml(query)}»:`, {
    html: true,
    keyboard: modelsKeyboard(
      matches.map((model) => model.id),
      user.llmModel,
    ),
  });
}

/**
 * Дописування та вилучення окремих пунктів: `+ Кірпосенко`, `- Кірпосенко`.
 *
 * Без цього словник із півтора десятка назв доводилось переписувати цілком
 * заради однієї нової — найчастіша дрібна морока в щоденному користуванні.
 * Усе інше, як і раніше, замінює список повністю.
 */
export function applyListEdit(
  current: string,
  input: string,
): { value: string; error?: string } {
  const match = /^([+-])\s*([\s\S]*)$/.exec(input.trim());
  if (!match) return { value: input };

  const addition = match[1] === "+";
  const argument = (match[2] ?? "").trim();
  if (!argument) return { value: input };

  const items = current
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (addition) {
    const fresh = argument
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter(
        (part) => !items.some((existing) => existing.toLowerCase() === part.toLowerCase()),
      );
    return { value: [...items, ...fresh].join(", ") };
  }

  const needle = argument.toLowerCase();
  const kept = items.filter((item) => item.toLowerCase() !== needle);
  if (kept.length === items.length) {
    return { value: current, error: texts.LIST_NOT_FOUND(argument) };
  }
  return { value: kept.join(", ") };
}

async function handleTextSetting(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  field: "glossary" | "extraPrompt",
  value: string,
  help: (current: string) => string,
): Promise<void> {
  if (!value) {
    const user = await loadSettings(env, userId);
    const current = user[field].trim();
    await tg.sendMessage(
      chatId,
      help(current ? `<code>${texts.escapeHtml(current)}</code>` : "—"),
      { html: true },
    );
    return;
  }

  if (value === "-") {
    await updateSettings(env, userId, { [field]: "" });
    await tg.sendMessage(chatId, "🧹 Очищено.");
    return;
  }

  const user = await loadSettings(env, userId);
  const change = applyListEdit(user[field], value);
  if (change.error) {
    await tg.sendMessage(chatId, change.error, { html: true });
    return;
  }
  value = change.value;

  await updateSettings(env, userId, { [field]: value });

  let note = "";
  if (field === "glossary") {
    const { kept, total } = selectHintTerms(value);
    note =
      kept.length < total
        ? "\n\n" + texts.GLOSSARY_TRUNCATED(kept.length, total)
        : "\n\n" + texts.GLOSSARY_FULL(total);
  }

  await tg.sendMessage(
    chatId,
    `${texts.SETTINGS_SAVED}\n\n<code>${texts.escapeHtml(value)}</code>${note}`,
    { html: true },
  );
}


async function handleVision(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  query: string,
): Promise<void> {
  const user = await loadSettings(env, userId);

  if (!query) {
    const models = await searchModels(env, "", { imageOnly: true, limit: 8 });
    await tg.sendMessage(chatId, texts.VISION_HELP(user.visionModel), {
      html: true,
      keyboard: modelsKeyboard(
        models.length > 0 ? models.map((model) => model.id) : PRESET_VISION_MODELS,
        user.visionModel,
        PREFIX.vision,
      ),
    });
    return;
  }

  if (query.includes("/") && !query.includes(" ")) {
    const catalog = await listModels(env);
    const found = catalog.find((model) => model.id === query);
    if (catalog.length > 0 && !found) {
      await tg.sendMessage(chatId, texts.MODEL_UNKNOWN(query), { html: true });
      return;
    }
    if (found && !found.modalities.includes("image")) {
      await tg.sendMessage(chatId, texts.MODEL_NOT_VISION(query), { html: true });
      return;
    }
    await updateSettings(env, userId, { visionModel: query });
    await tg.sendMessage(
      chatId,
      `${texts.SETTINGS_SAVED} Модель для фото: <code>${texts.escapeHtml(query)}</code>`,
      { html: true },
    );
    return;
  }

  const matches = await searchModels(env, query, { imageOnly: true });
  if (matches.length === 0) {
    await tg.sendMessage(chatId, texts.NO_MATCHES(query), { html: true });
    return;
  }

  await tg.sendMessage(chatId, `Знайшов за запитом «${texts.escapeHtml(query)}»:`, {
    html: true,
    keyboard: modelsKeyboard(
      matches.map((model) => model.id),
      user.visionModel,
      PREFIX.vision,
    ),
  });
}

async function handleRemind(
  env: Env,
  tg: TelegramClient,
  message: TgMessage,
  userId: number,
  args: string,
): Promise<void> {
  const chatId = message.chat.id;
  const replied = message.reply_to_message?.text || message.reply_to_message?.caption || "";
  const { source, fromHistory } = pickReminderSource(
    args,
    replied,
    // Історію читаємо лише коли більше нема звідки взяти текст.
    args.trim() || replied.trim() ? "" : await loadLastTranscript(env, userId),
  );

  if (!source.trim()) {
    await tg.sendMessage(chatId, texts.REMIND_HELP, { html: true });
    return;
  }

  const existing = await listReminders(env, userId);
  if (existing.length >= MAX_PER_USER) {
    await tg.sendMessage(chatId, texts.REMIND_LIMIT(MAX_PER_USER), { html: true });
    return;
  }

  const user = await loadSettings(env, userId);
  try {
    const { dueAt, what, repeat } = await planReminder(env, user, source);
    await saveReminder(env, userId, chatId, what, dueAt, repeat);
    await tg.sendMessage(
      chatId,
      texts.REMIND_SAVED(
        what,
        formatLocal(new Date(dueAt), env.TIMEZONE || DEFAULT_TIMEZONE),
        fromHistory,
        repeat,
      ),
      { html: true },
    );
  } catch (error) {
    if (error instanceof ReminderError) {
      await tg.sendMessage(chatId, texts.REMIND_FAILED(error.message), { html: true });
      return;
    }
    throw error;
  }
}

async function handleReminders(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
): Promise<void> {
  const view = await renderReminderList(env, userId);
  if (!view) {
    await tg.sendMessage(chatId, texts.REMINDERS_EMPTY);
    return;
  }
  await tg.sendMessage(chatId, view.text, { html: true, keyboard: view.keyboard });
}

/**
 * `/history` — останнє, `/find слово` — пошук. Команди різні, а показ один,
 * бо результат в обох випадках той самий: перелік записів із кнопками.
 */
async function handleHistory(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  query: string,
): Promise<void> {
  const items = query.trim()
    ? await search(env, userId, query)
    : await recent(env, userId);

  if (items.length === 0) {
    await tg.sendMessage(
      chatId,
      query.trim() ? texts.FIND_NOTHING(query) : texts.HISTORY_EMPTY,
      { html: true },
    );
    return;
  }

  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
  await tg.sendMessage(
    chatId,
    texts.historyList(
      query.trim() ? `Знайшов: ${items.length}` : "Останні записи",
      items.map((item) => ({
        when: formatLocal(new Date(item.at), timeZone),
        kind: item.kind,
        preview: preview(item.text),
      })),
    ),
    { html: true, keyboard: historyKeyboard(items.map((item) => stampOf(item.key))) },
  );
}

/**
 * `/list` — які списки є, `/list покупки` — показати, `/list покупки молоко,
 * хліб` — дописати. Голосом те саме робиться без команди.
 */
async function handleLists(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  args: string,
): Promise<void> {
  const html = { html: true } as const;
  const trimmed = args.trim();

  if (!trimmed) {
    const names = await listNames(env, userId);
    await tg.sendMessage(
      chatId,
      names.length === 0 ? texts.LISTS_NONE : texts.listsOverview(names),
      html,
    );
    return;
  }

  const space = trimmed.search(/\s/);
  const name = listId(space === -1 ? trimmed : trimmed.slice(0, space));
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

  if (!rest) {
    await showList(env, tg, chatId, userId, name);
    return;
  }

  const items = rest
    .split(/[,;\n]+|\s+і\s+|\s+та\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const added = await addItems(env, userId, name, items);
  const all = await loadList(env, userId, name);
  await tg.sendMessage(chatId, texts.LIST_ADDED(name, added, all.length), {
    html: true,
    keyboard: listKeyboard(all.map((item) => itemTail(item.key))),
  });
}

/**
 * `/template` — перелік, `/template акт` — показати, `/template - акт` —
 * прибрати, `/template акт\n<бланк>` — зберегти.
 *
 * Назва й бланк розділені переносом рядка, а не пробілом: назва буває з
 * кількох слів, а вгадувати, де вона скінчилась, — вірний спосіб щоразу
 * різати не там.
 */
async function handleTemplate(
  env: Env,
  tg: TelegramClient,
  chatId: number,
  userId: number,
  args: string,
): Promise<void> {
  const html = { html: true } as const;

  if (!args.trim()) {
    const templates = await listTemplates(env, userId);
    if (templates.length === 0) {
      await tg.sendMessage(chatId, texts.TEMPLATE_NONE, html);
      return;
    }
    await tg.sendMessage(
      chatId,
      texts.templateList(
        templates.map((item) => ({
          title: item.title,
          lines: item.body.split("\n").length,
        })),
      ),
      html,
    );
    return;
  }

  const removal = /^-\s*(.+)$/s.exec(args.trim());
  if (removal?.[1]) {
    const name = removal[1].trim();
    const existing = await loadTemplate(env, userId, templateId(name));
    if (!existing) {
      await tg.sendMessage(chatId, texts.TEMPLATE_UNKNOWN(name), html);
      return;
    }
    await deleteTemplate(env, userId, existing.id);
    await tg.sendMessage(chatId, texts.TEMPLATE_REMOVED(existing.title), html);
    return;
  }

  const breakAt = args.indexOf("\n");
  const title = (breakAt === -1 ? args : args.slice(0, breakAt)).trim();
  const body = breakAt === -1 ? "" : args.slice(breakAt + 1).trim();

  if (!body) {
    // Без тіла це прохання показати наявний бланк, а не зберегти порожній.
    const existing = await loadTemplate(env, userId, templateId(title));
    if (existing) {
      await tg.sendMessage(chatId, texts.templateShown(existing.title, existing.body), html);
      return;
    }
    await tg.sendMessage(chatId, texts.TEMPLATE_NEEDS_BODY, html);
    return;
  }

  if (nameTooLong(title)) {
    await tg.sendMessage(chatId, texts.TEMPLATE_NAME_TOO_LONG, html);
    return;
  }
  if (body.length > MAX_BODY_LENGTH) {
    await tg.sendMessage(chatId, texts.TEMPLATE_TOO_LONG(MAX_BODY_LENGTH), html);
    return;
  }

  const templates = await listTemplates(env, userId);
  const replacing = templates.some((item) => item.id === templateId(title));
  if (!replacing && templates.length >= MAX_TEMPLATES) {
    await tg.sendMessage(chatId, texts.TEMPLATE_LIMIT(MAX_TEMPLATES), html);
    return;
  }

  const saved = await saveTemplate(env, userId, title, body);
  await tg.sendMessage(chatId, texts.TEMPLATE_SAVED(saved.title), html);
}

/** Рядок для переліку: перший рядок запису, обрізаний до одного погляду. */
function preview(text: string, limit = 140): string {
  const flat = text.trim().split(/\s+/).join(" ");
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Список як текст плюс кнопки з номерами. Повертає null, коли нагадувань
 * немає. Використовується і командою, і перемальовуванням після видалення —
 * прибрали одне, а решта лишається перед очима.
 */
export async function renderReminderList(
  env: Env,
  userId: number,
  undoLabel?: string,
): Promise<{ text: string; keyboard: ReturnType<typeof remindersKeyboard> } | null> {
  const reminders = await listReminders(env, userId);
  if (reminders.length === 0) return null;

  const timeZone = env.TIMEZONE || DEFAULT_TIMEZONE;
  return {
    text: texts.renderReminders(
      reminders.map((reminder) => ({
        when: formatLocal(new Date(reminder.dueAt), timeZone),
        text: reminder.text,
        ...(reminder.repeat ? { repeat: reminder.repeat } : {}),
      })),
    ),
    keyboard: remindersKeyboard(
      reminders.map((reminder) => keyTail(reminder.key)),
      undoLabel,
    ),
  };
}
