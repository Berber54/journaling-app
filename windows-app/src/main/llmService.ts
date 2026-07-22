import { getConfig } from './database.js';
import type { ChatMessage } from '../shared/types.js';

// OpenAI Chat Completions endpoint. The API key is read from local app config
// (settings key `openai_api_key`) and never leaves the main process except in
// the outbound request to OpenAI.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export async function chatWithLLM(model: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = getConfig('openai_api_key');
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Add your key in Settings → AI Assistant.');
  }
  if (!model) {
    throw new Error('No model selected.');
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
      }),
    });
  } catch (err: any) {
    throw new Error(`Could not reach OpenAI. Check your internet connection. (${err?.message ?? err})`);
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
      throw new Error('OpenAI rejected your API key (401). Check the key in Settings → AI Assistant.');
    }
    if (res.status === 429) {
      throw new Error('OpenAI rate limit or quota reached (429). ' + detail);
    }
    throw new Error(`OpenAI error (${res.status}): ${detail}`);
  }

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI returned an unexpected response.');
  }
  return content;
}
