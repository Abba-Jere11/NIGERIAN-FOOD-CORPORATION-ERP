import { Surface, SurfaceHeader } from '@/components/ui/Surface';
import { EmptyState } from '@/components/ui/States';

export function InventoryPlaceholder({
  title = 'Inventory snapshot',
  description = 'Low-stock and expected deliveries will appear here when the inventory module ships.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Surface padded={false}>
      <SurfaceHeader title={title} description={description} />
      <EmptyState
        title="Inventory module not yet available"
        description="No stock counts or delivery forecasts are stored in this release."
      />
    </Surface>
  );
}
