'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { confirmMfaAction, enrolMfaAction } from '@/lib/auth-actions';

function groupedSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export default function MfaEnrolPage() {
  const router = useRouter();
  const [uri, setUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backup, setBackup] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void enrolMfaAction().then((result) => {
      if ('error' in result) setError(result.error);
      else {
        setUri(result.uri);
        setSecret(result.secret);
      }
    });
  }, []);

  if (backup) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-ink-900">Save your backup codes</h1>
        <p className="text-[13px] text-ink-600">
          Store these somewhere safe. Each code can be used once if you lose your authenticator.
        </p>
        <ul className="font-mono text-[13px]">
          {backup.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button
          variant="primary"
          onClick={() => {
            router.push('/');
            router.refresh();
          }}
        >
          Continue to the system
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const result = await confirmMfaAction(String(data.get('code') ?? ''));
        if ('error' in result) {
          setError(result.error);
          return;
        }
        setBackup(result.backupCodes);
      }}
    >
      <h1 className="text-xl font-semibold text-ink-900">Enrol authenticator</h1>
      <p className="text-[13px] text-ink-600">
        Scan this QR code with your authenticator app, then enter a code to confirm.
      </p>
      {error ? (
        <p role="alert" className="border-l-2 border-danger-600 bg-danger-100 px-3 py-2 text-[13px]">
          {error}
        </p>
      ) : null}
      {uri && secret ? (
        <>
          <div
            className="flex justify-center border border-ink-200 bg-white p-4"
            data-testid="otpauth-qr"
          >
            <QRCodeSVG value={uri} size={208} level="M" marginSize={2} title="Authenticator QR code" />
          </div>
          <p className="sr-only" data-testid="otpauth-uri">
            {uri}
          </p>
          <p className="text-[13px] text-ink-600">
            Can&apos;t scan? Enter this key in your authenticator app:
          </p>
          <p className="font-mono text-[13px] tracking-wide text-ink-900" data-testid="otpauth-secret">
            {groupedSecret(secret)}
          </p>
        </>
      ) : error ? null : (
        <p className="text-[13px] text-ink-500">Preparing enrolment…</p>
      )}
      <TextField name="code" label="Authenticator code" autoComplete="one-time-code" required />
      <Button type="submit" variant="primary">
        Confirm
      </Button>
    </form>
  );
}
