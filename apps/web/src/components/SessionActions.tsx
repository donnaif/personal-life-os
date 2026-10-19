import { useState, type ReactElement } from 'react';
import { sessionsApi, type SessionAction } from '../api/endpoints';
import type { Session } from '../api/types';
import { Button } from './ui';
import { IconCheck, IconPause, IconPlay } from './icons';
import { useToast } from './Toast';

interface Props {
  session: Session;
  onChanged: (next: Session) => void;
  onError?: (message: string) => void;
}

/**
 * The legal action set per status, mirroring the server's transition table.
 * The server is still the authority: a rejected transition is surfaced, not
 * silently hidden.
 */
function actionsFor(
  status: Session['status'],
): Array<{ action: SessionAction; label: string; variant: 'primary' | 'quiet' | 'danger'; icon: ReactElement }> {
  switch (status) {
    case 'planned':
    case 'missed':
      return [
        { action: 'start', label: 'ابدأ', variant: 'primary', icon: <IconPlay /> },
        { action: 'cancel', label: 'إلغاء', variant: 'quiet', icon: <span aria-hidden>✕</span> },
      ];
    case 'running':
      return [
        { action: 'pause', label: 'إيقاف مؤقت', variant: 'quiet', icon: <IconPause /> },
        { action: 'complete', label: 'إنهاء', variant: 'primary', icon: <IconCheck /> },
        { action: 'cancel', label: 'إلغاء', variant: 'quiet', icon: <span aria-hidden>✕</span> },
      ];
    case 'paused':
      return [
        { action: 'resume', label: 'استئناف', variant: 'primary', icon: <IconPlay /> },
        { action: 'complete', label: 'إنهاء', variant: 'quiet', icon: <IconCheck /> },
        { action: 'cancel', label: 'إلغاء', variant: 'quiet', icon: <span aria-hidden>✕</span> },
      ];
    default:
      return [];
  }
}

export function SessionActions({ session, onChanged, onError }: Props) {
  const [busy, setBusy] = useState<SessionAction | null>(null);
  const { notify } = useToast();
  const actions = actionsFor(session.status);

  if (actions.length === 0) return null;

  const run = async (action: SessionAction) => {
    setBusy(action);
    try {
      const next = await sessionsApi.act(session.id, action);
      onChanged(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذّر تنفيذ الإجراء.';
      notify(message, 'danger');
      onError?.(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ledger__actions">
      {actions.map((a) => (
        <Button
          key={a.action}
          size="sm"
          variant={a.variant}
          icon={a.icon}
          loading={busy === a.action}
          onClick={() => run(a.action)}
        >
          {a.label}
        </Button>
      ))}
    </div>
  );
}
