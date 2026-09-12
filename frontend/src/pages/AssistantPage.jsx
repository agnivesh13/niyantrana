/**
 * The assistant.
 *
 * Two properties are worth more than the conversation UI around them:
 *
 * 1. **The key is not here.** The browser calls POST /api/chat and the server
 *    holds the Gemini credential. The previous client read
 *    `VITE_GEMINI_API_KEY`, which Vite inlines into the bundle -- readable by
 *    anyone with devtools and spendable against the project quota.
 * 2. **Grounding is visible.** The server says whether a reply was built
 *    against the user own stored assessment, and each answer shows which it
 *    was. The old client faked token-by-token streaming from seven canned
 *    strings on failure, so a stub was indistinguishable from an answer.
 */
import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';

import { useChat } from '../contexts/ChatContext.jsx';
import { cn } from '../lib/utils.js';
import { Alert, Button, Card, CardBody, Disclaimer, Input, Spinner } from '../ui/primitives.jsx';

const SUGGESTIONS = [
  'What is driving my highest risk score?',
  'Suggest a lighter alternative to mutton biryani',
  'How much would more walking change my blood pressure risk?',
];

function Bubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]',
          isUser
            ? 'bg-accent text-white'
            : 'border border-line bg-surface text-primary',
        )}
      >
        <p className="whitespace-pre-wrap">{message.text}</p>
        {!isUser && message.grounded !== undefined && (
          <p className="mt-2 text-xs text-muted">
            {message.grounded
              ? 'Answered using your stored assessment'
              : 'General answer — your own scores were not used'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AssistantPage() {
  const { messages, isSending, error, send, clear } = useChat();
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isSending]);

  const submit = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(text);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Assistant</h1>
          <p className="mt-1.5 text-secondary">
            Grounded in your own scores and the Indian food database.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>Clear conversation</Button>
        )}
      </div>

      <Card>
        <CardBody className="pt-6">
          {messages.length === 0 ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-accent-soft">
                <Sparkles className="size-5 text-accent" aria-hidden />
              </div>
              <p className="font-medium text-primary">Ask about your results</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-secondary">
                Answers are built from your stored assessment where one exists, and every
                reply says whether yours was used.
              </p>
              <div className="mt-5 flex flex-col items-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-line px-3.5 py-2 text-sm text-secondary hover:bg-surface-sunken hover:text-primary"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => (
                <Bubble key={`${index}-${message.role}`} message={message} />
              ))}
              {isSending && (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Spinner className="size-4" label="Thinking" />
                  Thinking...
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}

          {error && (
            <Alert tone="error" className="mt-4">
              {error} Nothing is substituted when the assistant fails.
            </Alert>
          )}

          <form onSubmit={submit} className="mt-5 flex gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question about your results"
              aria-label="Message"
              disabled={isSending}
            />
            <Button type="submit" loading={isSending} disabled={!draft.trim()}>
              <Send className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">Send</span>
            </Button>
          </form>
        </CardBody>
      </Card>

      <Disclaimer />
    </div>
  );
}
