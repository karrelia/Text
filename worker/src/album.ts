/**
 * Збирання альбому знімків в один документ.
 *
 * Telegram шле кожне фото альбому окремим оновленням — три сторінки акта
 * приходять трьома незалежними запитами до Worker'а, які нічого не знають
 * одне про одного. Читати їх нарізно означає віддати людині три шматки
 * тексту замість одного документа.
 *
 * Кожна сторінка кладеться **своїм** ключем. Спільний список був би
 * природнішим, але його довелося б читати, доповнювати й писати назад — а
 * три запити роблять це одночасно, і кожен затер би чужу сторінку: атомарного
 * дописування KV не має. Окремі ключі усувають гонитву зовсім.
 *
 * Номер повідомлення в ключі доповнений нулями, тож KV віддає сторінки
 * лексикографічно — тобто в тому порядку, в якому їх надсилали.
 */

import type { Env } from "./env";

/**
 * Скільки чекати решту знімків. Telegram відправляє альбом одним пакетом,
 * тож розрив між оновленнями — сотні мілісекунд; півтори секунди мають
 * помітний запас і не встигають дратувати.
 */
export const GATHER_MS = 1500;

const ALBUM_TTL_SECONDS = 600;

const groupPrefix = (userId: number, groupId: string) => `album:${userId}:${groupId}:`;

const pageKey = (userId: number, groupId: string, messageId: number) =>
  groupPrefix(userId, groupId) + String(messageId).padStart(12, "0");

export interface AlbumPage {
  fileId: string;
  mimeType: string;
  caption: string;
  /** Порядок надсилання — за ним сторінки й читаються. */
  messageId: number;
}

export async function addPage(
  env: Env,
  userId: number,
  groupId: string,
  page: AlbumPage,
): Promise<void> {
  await env.SETTINGS.put(
    pageKey(userId, groupId, page.messageId),
    JSON.stringify(page),
    { expirationTtl: ALBUM_TTL_SECONDS },
  );
}

async function read(env: Env, userId: number, groupId: string) {
  const prefix = groupPrefix(userId, groupId);
  const listed = await env.SETTINGS.list({ prefix, limit: 64 });
  const pages: { key: string; page: AlbumPage }[] = [];

  for (const entry of listed.keys) {
    const page = await env.SETTINGS.get<AlbumPage>(entry.name, "json");
    if (page?.fileId) pages.push({ key: entry.name, page });
  }

  return pages;
}

/**
 * Чекає решту знімків і повертає повний альбом — або null, якщо читати його
 * має інший запит.
 *
 * Ведучого визначає сам список: читає той, чия сторінка виявилась першою.
 * Це не потребує ані блокувань, ані домовленостей між запитами — кожен
 * бачить той самий порядок і сам розуміє, чия черга.
 */
export async function gather(
  env: Env,
  userId: number,
  groupId: string,
  mine: string,
  waitMs = GATHER_MS,
): Promise<AlbumPage[] | null> {
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const pages = await read(env, userId, groupId);
  if (pages[0]?.page.fileId !== mine) return null;

  // Прибираємо одразу: повторне оновлення того самого альбому (Telegram
  // шле їх при затримці) не має читати його вдруге за ті самі гроші.
  for (const item of pages) {
    await env.SETTINGS.delete(item.key);
  }
  return pages.map((item) => item.page);
}
