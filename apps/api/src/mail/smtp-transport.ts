import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { createConnection, type Socket } from 'node:net';
import { loadApiEnv } from '../config/env';

export interface OutboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutboundMail {
  fromName: string;
  fromAddress: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: OutboundAttachment[];
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function encodeSubject(value: string): string {
  const safe = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, 'utf8').toString('base64')}?=`;
}

function quotedPrintable(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  let out = '';
  let line = 0;
  for (const byte of bytes) {
    const literal = byte >= 32 && byte <= 126 && byte !== 61;
    const chunk = literal ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    if (line + chunk.length > 73) {
      out += '=\r\n';
      line = 0;
    }
    out += chunk;
    line += chunk.length;
  }
  return out;
}

function wrapBase64(value: string): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += 76) lines.push(value.slice(i, i + 76));
  return lines.join('\r\n');
}

export function buildMime(mail: OutboundMail): string {
  const boundary = `nfc-${Date.now().toString(36)}`;
  const alt = `${boundary}-alt`;
  const from = `"${headerSafe(mail.fromName).replace(/"/g, '')}" <${headerSafe(mail.fromAddress)}>`;
  const lines = [
    `From: ${from}`,
    `To: ${headerSafe(mail.to)}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(mail.text),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(mail.html),
    `--${alt}--`,
  ];
  for (const file of mail.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${file.contentType}; name="${headerSafe(file.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${headerSafe(file.filename)}"`,
      '',
      wrapBase64(file.content.toString('base64')),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

function present(value?: string): boolean {
  return Boolean(value && value.trim());
}

export function smtpConfigured(): boolean {
  const env = loadApiEnv();
  return present(env.SMTP_HOST) && present(env.SMTP_FROM);
}

function smtpData(mime: string): string {
  return `${mime.replace(/(^|\r\n)\./g, '$1..')}\r\n.\r\n`;
}

type MailSocket = Socket | TLSSocket;

class SmtpClient {
  private buffer = '';
  private queue: string[] = [];
  private waiter: {
    expect: number;
    resolve: (blob: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onDataBound = (chunk: Buffer) => this.onData(chunk);
  private readonly onErrorBound = (error: Error) => this.fail(error);
  private readonly onTimeoutBound = () => this.fail(new Error('SMTP timeout'));

  constructor(private socket: MailSocket) {
    this.bind(socket);
  }

  attach(socket: MailSocket): void {
    this.unbind();
    this.socket = socket;
    this.buffer = '';
    this.queue = [];
    this.bind(socket);
  }

  private bind(socket: MailSocket): void {
    socket.setTimeout(20_000);
    socket.on('data', this.onDataBound);
    socket.on('error', this.onErrorBound);
    socket.on('timeout', this.onTimeoutBound);
  }

  private unbind(): void {
    this.socket.off('data', this.onDataBound);
    this.socket.off('error', this.onErrorBound);
    this.socket.off('timeout', this.onTimeoutBound);
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    const parts = this.buffer.split('\r\n');
    this.buffer = parts.pop() ?? '';
    const collected: string[] = [];
    for (const line of parts) {
      collected.push(line);
      if (!/^\d{3} /.test(line)) continue;
      const blob = collected.join('\n');
      collected.length = 0;
      if (this.waiter) {
        const { expect, resolve, reject } = this.waiter;
        this.clearWait();
        const code = Number(line.slice(0, 3));
        if (code >= expect && code < expect + 100) resolve(blob);
        else reject(new Error(line || 'SMTP rejected the command.'));
      } else {
        this.queue.push(blob);
      }
    }
  }

  private clearWait(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiter = null;
  }

  private fail(error: Error): void {
    const waiter = this.waiter;
    this.clearWait();
    waiter?.reject(error);
  }

  wait(expect: number): Promise<string> {
    if (this.queue.length > 0) {
      const blob = this.queue.shift() ?? '';
      const last = blob.split('\n').pop() ?? blob;
      const code = Number(last.slice(0, 3));
      if (code >= expect && code < expect + 100) return Promise.resolve(blob);
      return Promise.reject(new Error(last || 'SMTP rejected the command.'));
    }
    return new Promise((resolve, reject) => {
      this.timer = setTimeout(() => this.fail(new Error('SMTP timeout')), 20_000);
      this.waiter = { expect, resolve, reject };
    });
  }

  async command(line: string, expect: number): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.wait(expect);
  }

  writeData(mime: string): Promise<string> {
    this.socket.write(smtpData(mime));
    return this.wait(200);
  }

  end(): void {
    this.socket.end();
  }
}

export async function sendSmtp(mail: OutboundMail): Promise<void> {
  const env = loadApiEnv();
  const host = env.SMTP_HOST?.trim();
  const from = (env.SMTP_FROM ?? mail.fromAddress).trim();
  const port = env.SMTP_PORT ?? 587;
  if (!host || !from) throw new Error('SMTP is not configured.');
  const mime = buildMime({ ...mail, fromAddress: from });
  const implicitTls = port === 465;

  const raw = implicitTls
    ? tlsConnect({ host, port, servername: host })
    : createConnection({ host, port });

  await new Promise<void>((resolve, reject) => {
    const ok = () => resolve();
    raw.once('connect', ok);
    raw.once('secureConnect', ok);
    raw.once('error', reject);
    raw.once('timeout', () => {
      raw.destroy();
      reject(new Error(`SMTP timeout for ${mail.to}`));
    });
    raw.setTimeout(20_000);
  });

  const client = new SmtpClient(raw);
  await client.wait(200);
  const ehlo = await client.command('EHLO nfc.local', 200);

  let tlsUp = implicitTls;
  if (!implicitTls && /STARTTLS/i.test(ehlo)) {
    await client.command('STARTTLS', 200);
    const secure = tlsConnect({ socket: raw, host, servername: host });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });
    client.attach(secure);
    tlsUp = true;
    await client.command('EHLO nfc.local', 200);
  }

  if (present(env.SMTP_USER) && present(env.SMTP_PASSWORD)) {
    if (!tlsUp) throw new Error('SMTP authentication requires TLS.');
    await client.command('AUTH LOGIN', 300);
    await client.command(Buffer.from(env.SMTP_USER ?? '', 'utf8').toString('base64'), 300);
    await client.command(Buffer.from(env.SMTP_PASSWORD ?? '', 'utf8').toString('base64'), 200);
  }
  await client.command(`MAIL FROM:<${from}>`, 200);
  await client.command(`RCPT TO:<${mail.to}>`, 200);
  await client.command('DATA', 300);
  await client.writeData(mime);
  await client.command('QUIT', 200).catch(() => undefined);
  client.end();
}
