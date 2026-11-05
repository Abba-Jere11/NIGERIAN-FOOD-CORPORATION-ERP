/**
 * Confirmations for actions that finish with a redirect. The server action
 * appends `?notice=<key>`; `NoticeToast` shows the message on the next page.
 */
export const NOTICES = {
  'procurement-created': 'Draft created.',
  'procurement-submitted': 'Submitted. Your seal was applied and the next approver has been notified.',
  'procurement-discarded': 'Draft discarded.',
  'procurement-cloned': 'Cloned as a new draft.',
  'requisition-created': 'Requisition draft created.',
  'requisition-submitted': 'Requisition submitted to the Managing Director.',
  'requisition-discarded': 'Requisition draft discarded.',
} as const;

export type NoticeKey = keyof typeof NOTICES;

export function withNotice(path: string, notice: NoticeKey): string {
  return `${path}${path.includes('?') ? '&' : '?'}notice=${notice}`;
}

export function isNoticeKey(value: string | null): value is NoticeKey {
  return value !== null && Object.prototype.hasOwnProperty.call(NOTICES, value);
}
