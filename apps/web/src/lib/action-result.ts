/**
 * The result of a server action, shaped so a form can show exactly what the
 * server said: a general message, or errors keyed by field.
 */
export type ActionResult =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string[]>;
      requestId?: string | null;
    };

export const IDLE_ACTION_RESULT: ActionResult = { status: 'idle' };
