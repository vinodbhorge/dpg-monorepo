import type { RJSFSchema } from '@rjsf/utils';
import type { DotActionSchema } from '@/engine/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ActionButton } from './action-button';

interface ItemDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: RJSFSchema;
  schemaName?: string;
  data: Record<string, unknown>;
  itemId: string;
  actions?: DotActionSchema[];
  onAction?: (type: string, schema: DotActionSchema) => void;
}

function renderValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(renderValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ItemDetailDialog({
  open,
  onOpenChange,
  schema,
  schemaName,
  data,
  itemId,
  actions = [],
  onAction,
}: ItemDetailDialogProps) {
  const properties = (schema.properties ?? {}) as Record<
    string,
    { title?: string; description?: string }
  >;
  const title =
    typeof data.name === 'string' && data.name.length > 0
      ? data.name
      : itemId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {schemaName ? (
            <DialogDescription>
              {schemaName.replace(/_/g, ' ')}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Object.entries(properties).map(([key, prop]) => {
            const value = data[key];
            if (value == null || value === '') return null;
            return (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {prop.title ?? key.replace(/_/g, ' ')}
                </span>
                <span className="text-sm break-words">
                  {renderValue(value)}
                </span>
              </div>
            );
          })}
        </div>

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            {actions.map((action) => (
              <ActionButton
                key={action.action_type}
                actionType={action.action_type}
                actionSchema={action}
                onAction={(type, schema) => {
                  onAction?.(type, schema);
                  onOpenChange(false);
                }}
              />
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
