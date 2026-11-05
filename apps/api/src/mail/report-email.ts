import { formatLagosDateTime } from '@nfc/shared';

export interface ReportEmailCopy {
  senderName: string;
  fromAddress: string;
  recipient: string;
  title: string;
  runReference: string;
  entityLabel: string;
  periodLabel: string;
  sentAt: Date;
  message?: string | null;
  filename: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function reportEmailSubject(copy: Pick<ReportEmailCopy, 'title' | 'entityLabel' | 'periodLabel' | 'runReference'>): string {
  return `NFC · ${copy.title} · ${copy.entityLabel} · ${copy.periodLabel} · ${copy.runReference}`;
}

export function reportEmailText(copy: ReportEmailCopy): string {
  const sent = formatLagosDateTime(copy.sentAt);
  const note = copy.message?.trim()
    ? `\n${copy.senderName} wrote:\n${copy.message.trim()}\n`
    : '';
  return [
    `Dear colleague,`,
    '',
    `${copy.senderName}, Managing Director of the Nigeria Food Corporation, is sharing an official report with you.`,
    note,
    `Report: ${copy.title}`,
    `Reference: ${copy.runReference}`,
    `Entity: ${copy.entityLabel}`,
    `Period: ${copy.periodLabel}`,
    `Sent: ${sent} (Africa/Lagos)`,
    '',
    `The complete report is attached as ${copy.filename}.`,
    'This message does not grant access to the NFC system.',
    '',
    'Yours faithfully,',
    copy.senderName,
    'Managing Director',
    'Nigeria Food Corporation',
  ].join('\n');
}

export function reportEmailHtml(copy: ReportEmailCopy): string {
  const sent = formatLagosDateTime(copy.sentAt);
  const note = copy.message?.trim()
    ? `<p style="margin:16px 0;padding:12px 14px;border-left:3px solid #1b3a2f;background:#f4f1ea;color:#1a1a1a;font-size:14px;line-height:1.5;">${escapeHtml(copy.message.trim()).replace(/\n/g, '<br/>')}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>${escapeHtml(copy.title)}</title></head>
<body style="margin:0;padding:0;background:#e8e4db;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8e4db;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #cfc8b8;">
        <tr><td style="background:#1b3a2f;padding:20px 28px;color:#f4f1ea;">
          <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;">Nigeria Food Corporation</p>
          <p style="margin:6px 0 0;font-size:20px;font-weight:bold;">Office of the Managing Director</p>
        </td></tr>
        <tr><td style="height:4px;background:#c4a35a;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Dear colleague,</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">${escapeHtml(copy.senderName)}, Managing Director of the Nigeria Food Corporation, is sharing an official report with you.</p>
          ${note}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 20px;border:1px solid #d9d3c6;">
            <tr><td style="padding:8px 12px;background:#f4f1ea;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5c574c;">Report</td><td style="padding:8px 12px;font-size:14px;">${escapeHtml(copy.title)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f4f1ea;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5c574c;">Reference</td><td style="padding:8px 12px;font-size:14px;font-family:ui-monospace,monospace;">${escapeHtml(copy.runReference)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f4f1ea;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5c574c;">Entity</td><td style="padding:8px 12px;font-size:14px;">${escapeHtml(copy.entityLabel)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f4f1ea;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5c574c;">Period</td><td style="padding:8px 12px;font-size:14px;">${escapeHtml(copy.periodLabel)}</td></tr>
            <tr><td style="padding:8px 12px;background:#f4f1ea;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#5c574c;">Sent</td><td style="padding:8px 12px;font-size:14px;">${escapeHtml(sent)} (Africa/Lagos)</td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">The complete report is attached as <strong>${escapeHtml(copy.filename)}</strong>. This message does not grant access to the NFC system.</p>
          <p style="margin:24px 0 0;font-size:15px;line-height:1.55;">Yours faithfully,<br/><strong>${escapeHtml(copy.senderName)}</strong><br/>Managing Director<br/>Nigeria Food Corporation</p>
        </td></tr>
        <tr><td style="padding:12px 28px;background:#f4f1ea;font-size:11px;color:#5c574c;">Confidential. Intended only for ${escapeHtml(copy.recipient)}.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
