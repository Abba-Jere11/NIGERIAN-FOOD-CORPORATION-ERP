'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { MessageView } from '@nfc/shared';
import { TextAreaField } from '@/components/ui/Field';
import { ActionForm } from '../../ActionForm';
import { sendMessage } from '../../actions';

export function MessageThread({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: MessageView[];
}) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {messages.map((message) => (
          <li key={message.id} className="border border-ink-200 px-3 py-2 text-[13px]">
            <p className="text-[12px] text-ink-500">
              {message.senderName} · {new Date(message.createdAt).toLocaleString()}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>
      <ActionForm action={sendMessage} submitLabel="Send">
        <input type="hidden" name="conversationId" value={conversationId} />
        <TextAreaField name="body" label="Message" required />
      </ActionForm>
    </div>
  );
}
