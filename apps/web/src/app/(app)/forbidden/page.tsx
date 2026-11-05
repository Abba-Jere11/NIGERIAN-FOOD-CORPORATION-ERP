import { PageHeader } from '@/components/ui/Surface';
import { ButtonLink } from '@/components/ui/Button';

export default function ForbiddenPage() {
  return (
    <>
      <PageHeader
        eyebrow="Access"
        title="You do not have access to this page"
        description="Your grants do not include this area. Hidden navigation is cosmetic; the server refused the request."
      />
      <ButtonLink href="/">Go to your home</ButtonLink>
    </>
  );
}
