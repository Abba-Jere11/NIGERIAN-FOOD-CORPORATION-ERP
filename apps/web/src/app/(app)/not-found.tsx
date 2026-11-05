import { ButtonLink } from '@/components/ui/Button';
import { PageHeader, Surface } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';

export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="Not found" title="That record is not here" />
      <Surface padded={false}>
        <EmptyState
          title="It does not exist, or it is outside your access"
          description="Records belonging to another subsidiary are not shown to you at all, so a record you cannot reach looks the same as one that was never created."
          action={<ButtonLink href="/">Back to home</ButtonLink>}
        />
      </Surface>
    </>
  );
}
