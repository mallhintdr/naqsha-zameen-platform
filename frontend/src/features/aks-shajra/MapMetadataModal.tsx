// Ported from legacy src/components/AksShajra/MapMetadataModal.js
import { useState, type ChangeEvent } from 'react';
import { Modal } from '@/shared/ui';
import { NORTH_ARROW_STYLES } from './shajraConstants';

const Field = ({ label, children }: { label: string; children: any }) => (
  <div>
    <label className="field-title">{label}</label>
    {children}
  </div>
);

const MapMetadataModal = ({ show, onClose, metadata, onSaveMetadata, northArrowStyle, onSaveNorthArrowStyle }: any) => {
  const [formData, setFormData] = useState<any>({ ...metadata });
  const [selectedArrow, setSelectedArrow] = useState(northArrowStyle || 'standard');

  // D7 fix: re-sync the form from props every time the modal opens (after Open / New / Undo)
  const [prevShow, setPrevShow] = useState(show);
  if (prevShow !== show) {
    setPrevShow(show);
    if (show) {
      setFormData({ ...metadata });
      setSelectedArrow(northArrowStyle || 'standard');
    }
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    onSaveMetadata(formData);
    onSaveNorthArrowStyle(selectedArrow);
    onClose();
  };

  const text = (name: string, placeholder?: string, type = 'text') => (
    <input className="input" type={type} name={name} value={formData[name] || ''} onChange={handleChange} placeholder={placeholder} />
  );

  return (
    <Modal
      show={show}
      onHide={onClose}
      size="lg"
      className="shajra-modal"
      headerVariant="custom"
      headerClassName="modal-header-custom"
      bodyClassName="modal-body-custom"
      footerClassName="modal-footer-custom"
      title={
        <>
          <span style={{ marginRight: '8px' }}>📜</span> Aks Shajra Map Information & Title Block
        </>
      }
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            Save Metadata
          </button>
        </>
      }
    >
      <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
        <Field label="Map Title (عنوان نقشہ)">{text('title', 'Aks Shajra Parcha (اکس شجرہ پارچہ)')}</Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Mauza / Village (موضع / چک)">{text('mauza', 'e.g. Mauza Rustam')}</Field>
          <Field label="Murabba / Mutateel No (مربع / متعالل نمبر)">{text('murabba', 'e.g. 12 / M-5')}</Field>
          <Field label="Hadbast Number (نمبر حد بست)">{text('hadbastNo', 'e.g. 142')}</Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Tehsil (تحصیل)">{text('tehsil', 'e.g. Bahawalpur')}</Field>
          <Field label="District (ضلع)">{text('district', 'e.g. Bahawalpur')}</Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Prepared By (تیار کنندہ / پٹواری)">{text('preparedBy', 'e.g. Patwari Muhammad Ahmad')}</Field>
          <Field label="Checked By (تصدیق کنندہ / گرداور / قانونگو)">{text('checkedBy', 'e.g. Qanungo / Naib Tehsildar')}</Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Date (تاریخ)">{text('date', undefined, 'date')}</Field>
          <Field label="North Arrow Style">
            <select className="select" value={selectedArrow} onChange={(e) => setSelectedArrow(e.target.value)}>
              {NORTH_ARROW_STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
};

export default MapMetadataModal;
