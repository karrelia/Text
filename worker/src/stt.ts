/** Розпізнавання мови через OpenAI-сумісний /audio/transcriptions. */

import { type Env, type SttProvider, apiKeyFor } from "./env";

export class TranscriptionError extends Error {}

const ENDPOINTS: Record<SttProvider, string> = {
  groq: "https://api.groq.com/openai/v1/audio/transcriptions",
  openai: "https://api.openai.com/v1/audio/transcriptions",
};

const PROVIDER_NAMES: Record<SttProvider, string> = {
  groq: "Groq",
  openai: "OpenAI",
};

const RETRIABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * Whisper приймає ogg/opus від Telegram напряму — перекодовувати нічого
 * не треба. Тіло відповіді Telegram перетворюємо на Blob і віддаємо
 * платформі: байти не проходять через JS, тож процесорний час лишається
 * мізерним навіть на файлі в кілька мегабайтів.
 */
export async function transcribe(
  env: Env,
  provider: SttProvider,
  model: string,
  audio: Response,
  fileName: string,
  hint: string,
): Promise<string> {
  const apiKey = apiKeyFor(env, provider);
  if (!apiKey) {
    throw new TranscriptionError(
      `Для рушія ${PROVIDER_NAMES[provider]} не заданий API-ключ. ` +
        "Обери інший рушій командою /stt.",
    );
  }

  const blob = await audio.blob();

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const form = new FormData();
    form.append("file", blob, fileName);
    form.append("model", model);
    form.append("language", "uk");
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (hint) form.append("prompt", hint);

    let response: Response;
    try {
      response = await fetch(ENDPOINTS[provider], {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } catch (error) {
      lastError = String(error);
      await backoff(attempt);
      continue;
    }

    if (RETRIABLE.has(response.status)) {
      lastError = `${PROVIDER_NAMES[provider]} повернув ${response.status}`;
      await backoff(attempt);
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new TranscriptionError(
        `${PROVIDER_NAMES[provider]} ${response.status}: ` +
          (data.error?.message ?? "невідома помилка"),
      );
    }

    return (data.text ?? "").trim();
  }

  throw new TranscriptionError(`${PROVIDER_NAMES[provider]} недоступний: ${lastError}`);
}

function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
}
