/**
 * MIME sniffing from magic bytes. Extension is never trusted.
 */

export interface SniffedFile {
  mimeType: string;
  extension: string;
}

export function sniffMime(buffer: Buffer): SniffedFile | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }
  return null;
}

export function sanitizeFilename(name: string): string {
  const trimmed = name.replace(/\\/g, '/').split('/').pop() ?? 'document';
  const cleaned = trimmed.replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '');
  const base = cleaned.trim() === '' ? 'document' : cleaned.trim();
  return base.slice(0, 180);
}
