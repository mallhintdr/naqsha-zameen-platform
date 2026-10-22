import type { CSSProperties } from 'react';

/** Legacy `.shift-mouza-modal .modal-header` (inv-04 §7.1). */
export const SHIFT_HEADER_STYLE: CSSProperties = {
  background: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  padding: '14px 18px',
  color: '#fff',
};
export const SHIFT_HEADER_CLASS = 'text-white [&_h2]:text-[0.95rem] [&_h2]:font-semibold [&_h2]:tracking-[0.3px] [&_h2]:text-white';
export const SHIFT_BODY_CLASS = 'flex flex-col gap-[10px] bg-white !px-[14px] !py-3';
