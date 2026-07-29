import { ALLOWED_LLM_MODELS, config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import type { ChatMessage } from '../shared/types.js';

// The OpenAI Chat Completions proxy. The API key lives only in the server's
// environment (config.openaiApiKey); clients send { model, messages } and the
// server forwards the request to OpenAI. This keeps the key off every device.

export async function chatWithLLM(model: string, messages: ChatMessage[]): Promise<string> {
  if (!config.openaiApiKey) {
    throw new AppError(
      503,
      'LLM_NOT_CONFIGURED',
      'The AI assistant is not configured on the server. Set OPENAI_API_KEY in the server .env.'
    );
  }
  if (!ALLOWED_LLM_MODELS.includes(model as (typeof ALLOWED_LLM_MODELS)[number])) {
    throw new AppError(
      400,
      'INVALID_MODEL',
      `Model "${model}" is not allowed. Choose one of: ${ALLOWED_LLM_MODELS.join(', ')}.`
    );
  }

  let res: Response;
  try {
    res = await fetch(`${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.7 }),
    });
  } catch (err: any) {
    throw new AppError(
      502,
      'LLM_UNREACHABLE',
      `The server could not reach OpenAI. (${err?.message ?? err})`
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const data: any = await res.json();
      detail = data?.error?.message || JSON.stringify(data);
    } catch {
      detail = await res.text().catch(() => '');
    }
    if (res.status === 401) {
      throw new AppError(502, 'LLM_AUTH', 'OpenAI rejected the server API key. Check OPENAI_API_KEY on the server.');
    }
    if (res.status === 429) {
      throw new AppError(429, 'LLM_RATE_LIMIT', `OpenAI rate limit or quota reached. ${detail}`);
    }
    throw new AppError(502, 'LLM_ERROR', `OpenAI error (${res.status}): ${detail}`);
  }

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new AppError(502, 'LLM_BAD_RESPONSE', 'OpenAI returned an unexpected response.');
  }
  return content;
}
