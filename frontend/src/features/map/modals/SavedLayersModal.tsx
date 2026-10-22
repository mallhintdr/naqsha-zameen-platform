/** Port of legacy src/App/SavedLayersModal.js. */
import { FolderOpen, Trash2 } from 'lucide-react';
import { Modal } from '@/shared/ui';
import { fmtDate } from '@/shared/lib/format';
import type { UserLayer } from '../useUserLayers';

interface Props {
  show: boolean;
  onHide: () => void;
  userLayers: UserLayer[];
  tourType?: string;
  onLoad: (l: UserLayer) => void;
  onDelete: (l: UserLayer) => void;
}

const demoLayers = (): UserLayer[] => [
  { _id: 'demo-1', name: 'Test Layer 101', updatedAt: new Date().toISOString() },
  { _id: 'demo-2', name: 'Field Survey Parcel Alpha', updatedAt: new Date().toISOString() },
  { _id: 'demo-3', name: 'Murabba Sub-Division Zone B', updatedAt: new Date().toISOString() },
];

const th =
  'whitespace-nowrap !px-[10px] !py-2 !text-[0.78rem] max-sm:!px-[6px] max-sm:!py-[5px] max-sm:!text-[0.72rem] !bg-[linear-gradient(135deg,#0b0e28_0%,#121a36_100%)] !text-[#00ffff] !border-b !border-b-[rgba(0,255,255,0.3)]';
const td = '!px-2 !py-[6px] !text-[0.82rem] max-sm:!px-[6px] max-sm:!py-[5px] max-sm:!text-[0.72rem] align-middle';
const actBtn =
  'inline-flex items-center justify-center rounded border bg-transparent px-[6px] py-[2px] text-[0.75rem] max-sm:min-h-[36px] max-sm:min-w-[36px]';

export default function SavedLayersModal({ show, onHide, userLayers, tourType, onLoad, onDelete }: Props) {
  const displayLayers = userLayers && userLayers.length > 0 ? userLayers : tourType === 'savedLayers' ? demoLayers() : [];
  return (
    <Modal
      show={show}
      onHide={onHide}
      size="lg"
      className="unified-modal saved-layers-modal"
      title={<span className="text-[0.95rem] font-semibold text-[#f8fbff]">📁 Saved Layers</span>}
      bodyClassName="!p-4 max-h-[280px]"
      footer={
        <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-[36px]" onClick={onHide}>
          Close
        </button>
      }
    >
      {displayLayers.length > 0 ? (
        <div className="table-wrap">
          <table className="table table-striped table-hover mb-0 text-[0.85rem]">
            <thead>
              <tr>
                <th className={th} style={{ width: '8%', textAlign: 'center' }}>S. No.</th>
                <th className={th} style={{ width: '50%' }}>Name of Layer</th>
                <th className={th} style={{ width: '25%' }}>Created/Updated On</th>
                <th className={th} style={{ width: '17%', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayLayers.map((layer, index) => (
                <tr key={layer._id || index}>
                  <td className={td} style={{ textAlign: 'center' }}>{index + 1}</td>
                  <td className={td} style={{ fontWeight: 500, wordBreak: 'break-word' }}>{layer.name}</td>
                  <td className={`${td} whitespace-nowrap`}>{fmtDate(layer.updatedAt)}</td>
                  <td className={td} style={{ textAlign: 'center' }}>
                    <div className="flex flex-nowrap justify-center gap-1">
                      <button
                        type="button"
                        id={index === 0 ? 'btn-open-layer-0' : undefined}
                        className={`${actBtn} btn-open-layer border-[#0d6efd] text-[#0d6efd] hover:bg-[#0d6efd] hover:text-white`}
                        onClick={() => {
                          onLoad(layer);
                          onHide();
                        }}
                        title="Open Layer"
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        type="button"
                        id={index === 0 ? 'btn-delete-layer-0' : undefined}
                        className={`${actBtn} btn-delete-layer border-[#dc3545] text-[#dc3545] hover:bg-[#dc3545] hover:text-white`}
                        onClick={() => onDelete(layer)}
                        title="Delete Layer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-6 text-center text-[#6c757d]">
          <FolderOpen size={32} className="mx-auto mb-2 text-[#6c757d]" />
          <div>No saved layers found.</div>
        </div>
      )}
    </Modal>
  );
}
