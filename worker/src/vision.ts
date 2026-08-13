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

export async function readPhoto(
  env: Env,
  image: Response,
  mimeType: string,
  user: UserSettings,
  instruction: string,
): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());

  const messages = [
    {
      role: "system",
      content: buildPhotoSystemPrompt(user.glossary, instruction),
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Зчитай текст із цього знімка." },
        { type: "image_url", image_url: { url: dataUri(bytes, mimeType) } },
      ],
    },
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
