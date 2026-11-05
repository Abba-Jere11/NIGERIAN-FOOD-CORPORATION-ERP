import { describe, expect, it } from 'vitest';
import { signDownloadToken, verifyDownloadToken } from './download-tokens';

describe('download tokens', () => {
  it('accepts a valid token and rejects a tampered one', () => {
    const signed = signDownloadToken(
      {
        sub: '00000000-0000-4000-8000-000000000011',
        documentId: '00000000-0000-4000-8000-000000000201',
        versionId: '00000000-0000-4000-8000-000000000202',
      },
      60,
    );
    expect(verifyDownloadToken(signed.token)?.sub).toBe('00000000-0000-4000-8000-000000000011');
    expect(verifyDownloadToken(`${signed.token}x`)).toBeNull();
    expect(verifyDownloadToken('not-a-token')).toBeNull();
  });
});
