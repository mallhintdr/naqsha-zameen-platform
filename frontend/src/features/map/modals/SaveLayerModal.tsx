/** Port of legacy src/App/SaveLayerModal.js. */
import type { FormEvent } from 'react';
import { Modal } from '@/shared/ui';

interface Props {
  show: boolean;
  onHide: () => void;
  onSubmit: (e: FormEvent) => void;
  saveLayerName: string;
  setSaveLayerName: (v: string) => void;
  savingLayer: boolean;
}

export default function SaveLayerModal({ show, onHide, onSubmit, saveLayerName, setSaveLayerName, savingLayer }: Props) {
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="compact"
      title={<span className="text-[0.95rem] font-semibold text-[#f8fbff]">💾 Save Layer</span>}
      bodyClassName="!p-0"
    >
      <form onSubmit={onSubmit}>
        <div className="p-4">
          <label htmlFor="layerName" className="mb-2 block text-[0.85rem] font-medium text-[#374151]">
            Layer Name
          </label>
          <input
            id="layerName"
            type="text"
            className="input max-sm:min-h-[36px]"
            style={{ fontSize: '0.85rem', padding: '6px 10px' }}
            placeholder="Enter layer name"
            value={saveLayerName}
            onChange={(e) => setSaveLayerName(e.target.value)}
            required
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#e5e7eb] bg-[#f9fafb] px-4 py-2">
          <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-[36px]" onClick={onHide}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm max-sm:min-h-[36px]" disabled={savingLayer || !saveLayerName.trim()}>
            {savingLayer ? <span className="spinner spinner-sm" /> : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
