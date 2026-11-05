import { PageHeader, Surface } from '@/components/ui/Surface';
import { ButtonLink } from '@/components/ui/Button';

export default function SecurityPage() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Security" description="Password and authenticator." />
      <Surface>
        <p className="text-[13px] text-ink-700">
          Change your password from the forced-change screen when an Administrator requires it, or
          use Forgot password on the sign-in page.
        </p>
        <div className="mt-3">
          <ButtonLink href="/login/forgot">Reset password</ButtonLink>
        </div>
      </Surface>
    </>
  );
}
