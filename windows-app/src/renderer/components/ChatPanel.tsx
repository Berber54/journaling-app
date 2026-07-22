import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { JournalEntry, ChatMessage } from '../../shared/types';
import { htmlToText } from '../lib/utils';
import '../styles/chat.css';

interface ChatPanelProps {
  mode: 'all' | 'single';
  entries: JournalEntry[];
  currentEntry: JournalEntry | null;
  onClose: () => void;
}

// Standard Chat Completions models (all accept the same request shape).
const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
];
const DEFAULT_MODEL = 'gpt-4o';

// Keep the injected context within a sane size so requests don't balloon.
const CONTEXT_CHAR_BUDGET = 48000;

function buildSystemPrompt(
  mode: 'all' | 'single',
  entries: JournalEntry[],
  currentEntry: JournalEntry | null,
): string {
  const intro =
    mode === 'single'
      ? `You are a warm, insightful journaling assistant. Below is a single journal entry the user wants to talk about. Help them reflect on it, answer their questions, and offer thoughtful perspective. Be concise and specific, and ground what you say in the entry.`
      : `You are a warm, insightful journaling assistant. Below are the user's journal entries. Use them to answer questions, surface patterns and themes across time, recall details, and offer thoughtful perspective. Reference entries by their date or title when relevant. Be concise and specific.`;

  const source =
    mode === 'single'
      ? currentEntry
        ? [currentEntry]
        : []
      : entries.filter((e) => !e.deleted);

  // entries arrive newest-first; take newest first under the budget, then flip
  // to oldest-first so the transcript reads chronologically.
  const chosen: string[] = [];
  let used = 0;
  let truncated = false;
  for (const e of source) {
    const date = new Date(e.journal_date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const text = htmlToText(e.content) || '(empty)';
    const block = `--- ${e.title || 'Untitled'} — ${date} ---\n${text}\n\n`;
    if (used + block.length > CONTEXT_CHAR_BUDGET && chosen.length > 0) {
      truncated = true;
      break;
    }
    chosen.push(block);
    used += block.length;
  }
  chosen.reverse();

  const count = mode === 'single' ? source.length : source.length;
  const header =
    mode === 'single'
      ? `\n\nJOURNAL ENTRY:\n\n`
      : `\n\nJOURNAL ENTRIES (${count} total${truncated ? `, showing the ${chosen.length} most recent that fit` : ''}):\n\n`;

  return intro + header + (chosen.join('') || '(no entries yet)');
}

export default function ChatPanel({ mode, entries, currentEntry, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Load saved model + whether an API key is configured.
  useEffect(() => {
    (async () => {
      const savedModel = await window.electronAPI.settingsGet('openai_model');
      if (savedModel) setModel(savedModel);
      const key = await window.electronAPI.settingsGet('openai_api_key');
      setHasKey(!!key);
    })();
  }, []);

  // Auto-scroll to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (hasKey) inputRef.current?.focus();
  }, [hasKey]);

  const handleModelChange = (id: string) => {
    setModel(id);
    window.electronAPI.settingsSet('openai_model', id);
  };

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    await window.electronAPI.settingsSet('openai_api_key', trimmed);
    setKeyInput('');
    setHasKey(true);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setError('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    // Rebuild the system context each turn so it reflects the latest entries.
    const system: ChatMessage = {
      role: 'system',
      content: buildSystemPrompt(mode, entries, currentEntry),
    };

    try {
      const reply = await window.electronAPI.llmChat({
        model,
        messages: [system, ...history],
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong talking to OpenAI.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, mode, entries, currentEntry, model]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const contextLabel =
    mode === 'single'
      ? `This entry: ${currentEntry?.title || 'Untitled'}`
      : `All entries (${entries.filter((e) => !e.deleted).length})`;

  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-titles">
            <span className="chat-title">AI Assistant</span>
            <span className="chat-context-badge">{contextLabel}</span>
          </div>
          <button className="chat-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {/* Model row */}
        <div className="chat-controls">
          <label className="chat-model-label">
            Model
            <select
              className="chat-model-select"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {messages.length > 0 && (
            <button
              className="chat-new-btn"
              onClick={() => {
                setMessages([]);
                setError('');
              }}
            >
              New conversation
            </button>
          )}
        </div>

        {/* API key gate */}
        {hasKey === false ? (
          <div className="chat-keygate">
            <p className="chat-keygate-title">Connect OpenAI</p>
            <p className="chat-keygate-desc">
              Paste your OpenAI API key to start. It's stored locally on this device only.
            </p>
            <input
              className="input"
              type="password"
              placeholder="sk-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveKey();
              }}
            />
            <button className="btn btn-primary" onClick={handleSaveKey} disabled={!keyInput.trim()}>
              Save key
            </button>
            <p className="chat-keygate-hint">
              Get a key at platform.openai.com → API keys.
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="chat-messages" ref={scrollRef}>
              {messages.length === 0 && !loading && (
                <div className="chat-empty">
                  <p className="chat-empty-title">
                    {mode === 'single'
                      ? 'Ask about this entry'
                      : 'Ask about your journal'}
                  </p>
                  <p className="chat-empty-desc">
                    {mode === 'single'
                      ? 'The current entry is loaded as context. Ask a question or start a reflection.'
                      : 'All your entries are loaded as context. Ask about patterns, moods, or anything you’ve written.'}
                  </p>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`chat-msg chat-msg-${m.role}`}>
                  <div className="chat-msg-role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                  <div className="chat-msg-content">{m.content}</div>
                </div>
              ))}

              {loading && (
                <div className="chat-msg chat-msg-assistant">
                  <div className="chat-msg-role">Assistant</div>
                  <div className="chat-msg-content chat-typing">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
            </div>

            {error && <div className="chat-error">{error}</div>}

            {/* Composer */}
            <div className="chat-composer">
              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder={
                  messages.length === 0 ? 'Start the conversation…' : 'Continue the conversation…'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
              />
              <button
                className="btn btn-primary chat-send"
                onClick={send}
                disabled={loading || !input.trim()}
              >
                {loading ? '…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
