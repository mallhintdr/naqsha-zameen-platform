/**
 * Shared pieces of the "Area of Interest" / "Tehsil & Mouza Access" pickers used by
 * PublicRegistrationPage and AdminRegistrationPage (legacy duplicated this markup inline).
 * `variant` reproduces the small visual differences between the two legacy forms.
 */
import { Check, ChevronDown, ChevronUp, Lock, ListChecks, Pencil, Star, Trash2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, cn } from '@/shared/ui';

export type TehsilItem = string | { name: string; isGroup?: boolean; rawAliases?: string[] };
export interface Assignment {
  tehsil: string;
  mouzas: string[];
}
type Variant = 'public' | 'admin';

export const tehsilName = (item: TehsilItem) => (typeof item === 'string' ? item : item.name);

export function TehsilList({
  items, selected, onSelect, variant, className,
}: { items: TehsilItem[]; selected: string; onSelect: (t: string) => void; variant: Variant; className?: string }) {
  if (!items.length) return <p className="py-3 text-center text-sm text-[#6c757d]">No tehsils found</p>;
  return (
    <div className={className}>
      {items.map((item) => {
        const t = tehsilName(item);
        const isGroup = typeof item !== 'string' && Boolean(item.isGroup);
        const isSelected = selected === t;
        const aliases = typeof item !== 'string' && Array.isArray(item.rawAliases) ? item.rawAliases : null;
        const style =
          variant === 'public'
            ? {
                background: isSelected ? '#e3f2fd' : isGroup ? '#f0f9ff' : 'transparent',
                borderBottom: '1px solid #f8f9fa',
                borderLeft: isGroup ? '4px solid #0284c7' : 'none',
              }
            : {
                background: isSelected ? '#e3f2fd' : isGroup ? '#f0f9ff' : 'white',
                border: `1px solid ${isSelected ? '#2196f3' : isGroup ? '#bae6fd' : '#dee2e6'}`,
                borderLeft: isGroup ? '4px solid #0284c7' : `1px solid ${isSelected ? '#2196f3' : '#dee2e6'}`,
              };
        return (
          <div
            key={t}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(t)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(t))}
            title={isGroup && aliases ? `Merged Group (${aliases.join(', ')})` : ''}
            className={cn(
              'flex min-h-9 cursor-pointer items-center justify-between gap-2 px-2.5 py-2 text-[0.85rem]',
              variant === 'public' ? 'mb-[3px] rounded' : 'mb-1.5 rounded-md',
            )}
            style={style}
          >
            <span className={cn('min-w-0 break-words', isGroup && 'font-bold text-[#052c65]')}>
              {isGroup && <span className="mr-1">🔗</span>}
              {t}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {isGroup && (
                <Badge bg="info" className={cn('!text-[#212529]', variant === 'public' ? '!px-[5px] !py-[2px] text-[0.62rem]' : 'text-[0.65rem]')}>
                  {variant === 'public' ? 'Merged' : 'Merged Group'}
                </Badge>
              )}
              {isSelected && variant === 'public' && <Check size={14} className="text-[#198754]" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function EmptyBox({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-lg bg-[#f8f9fa] p-3 text-center text-[#6c757d]', className)}>
      <span className="mb-2 opacity-50">{icon}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function AssignmentSummary({
  assignments, activeTehsil, expanded, onToggleExpand, onEdit, onMakePrimary, onRemove, onRemoveMouza, variant,
}: {
  assignments: Assignment[];
  activeTehsil: string;
  expanded: string | null;
  onToggleExpand: (t: string) => void;
  onEdit: (t: string) => void;
  onMakePrimary: (t: string) => void;
  onRemove: (t: string) => void;
  onRemoveMouza?: (t: string, m: string) => void;
  variant: Variant;
}) {
  if (!assignments.length) {
    return (
      <EmptyBox
        className={cn('h-[250px]', variant === 'public' ? 'border border-dashed border-[#dee2e6]' : 'border-2 border-dashed border-[#dee2e6]')}
        icon={variant === 'public' ? <ListChecks size={24} /> : <Lock size={24} />}
      >
        {variant === 'public' ? 'No areas assigned yet' : 'No access assigned yet'}
      </EmptyBox>
    );
  }
  const list = variant === 'admin' ? [...assignments].sort((a, b) => a.tehsil.localeCompare(b.tehsil)) : assignments;
  return (
    <div className="max-h-[250px] overflow-y-auto">
      {list.map((entry) => {
        const primary = entry.tehsil === activeTehsil;
        const isOpen = expanded === entry.tehsil;
        return (
          <div
            key={entry.tehsil}
            className={cn('mb-2 rounded-lg', variant === 'public' && 'shadow-[0_2px_4px_rgba(0,0,0,0.075)]')}
            style={
              variant === 'public'
                ? { background: primary ? '#f0fff4' : '#fff', border: `1px solid ${primary ? '#c6f6d5' : '#edf2f7'}` }
                : { background: '#fff', border: `1px solid ${primary ? '#28a745' : '#dee2e6'}` }
            }
          >
            <div className={variant === 'public' ? 'p-2' : 'px-3 py-2'}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    <strong className="truncate text-[0.85rem]">{entry.tehsil}</strong>
                    {primary && <Badge bg="success" className="text-[0.6rem]">Primary</Badge>}
                  </div>
                  <Badge bg="secondary" className="mt-1 text-[0.65rem]" onClick={() => onToggleExpand(entry.tehsil)}>
                    {entry.mouzas.length} mouzas {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className="rounded p-1.5 text-[#0096c7] hover:bg-black/5" title="Edit" onClick={() => onEdit(entry.tehsil)}>
                    <Pencil size={17} />
                  </button>
                  {!primary && (
                    <button type="button" className="rounded p-1.5 text-[#198754] hover:bg-black/5" title="Make Primary" onClick={() => onMakePrimary(entry.tehsil)}>
                      <Star size={17} />
                    </button>
                  )}
                  <button type="button" className="rounded p-1.5 text-[#dc3545] hover:bg-black/5" title="Remove" onClick={() => onRemove(entry.tehsil)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="mt-2 max-h-[200px] overflow-y-auto border-t border-[#dee2e6] pt-2">
                  {entry.mouzas.map((m, idx) => (
                    <div
                      key={m}
                      className="mb-1 flex items-center justify-between gap-2 rounded bg-[#f8f9fa] px-2 py-1 text-[0.75rem]"
                      style={{ borderLeft: '3px solid #6c757d' }}
                    >
                      <span className="min-w-0 break-words">
                        <span className="mr-1 text-[#6c757d]">{idx + 1}.</span>
                        <span className="font-medium text-[#212529]">{m}</span>
                      </span>
                      {onRemoveMouza && (
                        <button type="button" className="shrink-0 p-0.5 text-[#dc3545]" title="Remove mouza" onClick={() => onRemoveMouza(entry.tehsil, m)}>
                          <XCircle size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
