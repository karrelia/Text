/** Розпізнавання тексту з фотографій через мультимодальну модель OpenRouter. */

import type { Env } from "./env";
import { OpenRouterError, complete, stripWrapper } from "./openrouter";
import { buildPhotoSystemPrompt } from "./prompts";
import type { UserSettings } from "./settings";

/**
 * Base64 частинами: `btoa(String.fromCharCode(...bytes))` на цілому файлі
 * переповнює стек, а побайтовий цикл з'їдає процесорний час, якого на
 * вільному тарифі лише 10 мс.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function dataUri(bytes: Uint8Array, mimeType: string): string {
  const safe = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  return `data:${safe};base64,${toBase64(bytes)}`;
}

export interface PhotoInput {
  body: Response;
  mimeType: string;
}

/**
 * Кілька знімків читаються одним запитом: сторінки одного акта мають
 * потрапити до моделі разом, інакше вона не побачить, що шапка з першої
 * сторінки стосується таблиці на другій.
 */
export async function readPhoto(
  env: Env,
  images: PhotoInput[],
  user: UserSettings,
  instruction: string,
): Promise<string> {
  const parts: unknown[] = [
    {
      type: "text",
      text:
        images.length > 1
          ? `Зчитай текст із цих знімків (${images.length} сторінки одного документа).`
          : "Зчитай текст із цього знімка.",
    },
  ];

  for (const image of images) {
    const bytes = new Uint8Array(await image.body.arrayBuffer());
    parts.push({ type: "image_url", image_url: { url: dataUri(bytes, image.mimeType) } });
  }

  const messages = [
    {
      role: "system",
      content: buildPhotoSystemPrompt(user.glossary, instruction, images.length),
    },
    { role: "user", content: parts },
  ];

  const result = await complete(env, user.visionModel, messages, 0);
  const text = stripWrapper(result);
  if (!text) {
    throw new OpenRouterError(
      `Модель ${user.visionModel} не повернула тексту. ` +
        "Можливо, вона не приймає зображення — обери іншу командою /vision.",
    );
  }
  return text;
}
