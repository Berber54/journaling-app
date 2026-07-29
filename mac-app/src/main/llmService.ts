import { getConfig } from './database.js';
import { apiFetch } from './syncService.js';
import type { ChatMessage } from '../shared/types.js';

// The AI assistant now runs through your own sync server: the OpenAI API key
// lives on the server, and the desktop app calls POST /api/llm/chat. Because
// that call needs the server (and therefore an internet/LAN connection), the AI
// feature is only available while you're connected — which is exactly when the
// server (and thus OpenAI) is reachable.

export async function chatWithLLM(model: string, messages: ChatMessage[]): Promise<string> {
  const serverUrl = getConfig('server_url');
  const token = getConfig('auth_token');
  if (!serverUrl || !token) {
    throw new Error('Connect to your server in Settings to use the AI assistant.');
  }
  if (!model) {
    throw new Error('No model selected.');
  }

  let res: Response;
  try {
    res = await apiFetch('/llm/chat', {
      method: 'POST',
      body: JSON.stringify({ model, messages }),
    });
  } catch (err: any) {
    throw new Error(`Could not reach your server. Check your connection. (${err?.message ?? err})`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      const data: any = await res.json();
      detail = data?.message || data?.error || JSON.stringify(data);
    } catch {
      detail = await res.text().catch(() => '');
    }
    if (res.status === 503) {
      throw new Error('The AI assistant is not configured on the server (no API key set).');
    }
    if (res.status === 429) {
      throw new Error('OpenAI rate limit or quota reached (429). ' + detail);
    }
    throw new Error(detail || `AI request failed (${res.status}).`);
  }

  const data: any = await res.json();
  const content = data?.content;
  if (typeof content !== 'string') {
    throw new Error('The server returned an unexpected response.');
  }
  return content;
}
