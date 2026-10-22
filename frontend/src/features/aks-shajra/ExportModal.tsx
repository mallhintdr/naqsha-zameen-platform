// Ported from legacy src/components/AksShajra/ExportModal.js
import { useState } from 'react';
import { FileText, FileImage, Images, Check } from 'lucide-react';
import { Modal, Spinner, useDialog } from '@/shared/ui';
import { exportStageToPNG, exportToPDF } from './exportUtils';
import { PAPER_SIZES } from './shajraConstants';

const ExportModal = ({ show, onClose, stageRef, metadata, legend, paperConfig }: any) => {
  // 'png3x' was legacy 'svg' ("Vector / Web") — it always produced a 3x PNG (D7: renamed to what it is)
  const [exportFormat, setExportFormat] = useState('pdf'); // 'pdf' | 'png' | 'png3x'
  const [exporting, setExporting] = useState(false);
  const [pngDpi, setPngDpi] = useState('3'); // 2x, 3x, 4x
  const dialog = useDialog();

  const handleExecuteExport = async () => {
    setExporting(true);
    try {
      const fileName = `${(metadata.mauza || 'aks_shajra').replace(/\s+/g, '_')}_map.png`;
      if (exportFormat === 'pdf') {
        await exportToPDF({
          stageRef,
          metadata,
          legend,
          paperSize: paperConfig.paperSize,
          orientation: paperConfig.orientation,
          scale: paperConfig.scale,
        });
      } else if (exportFormat === 'png') {
        await exportStageToPNG(stageRef, metadata, fileName, Number(pngDpi));
      } else if (exportFormat === 'png3x') {
        await exportStageToPNG(stageRef, metadata, fileName, 3);
      }
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      dialog.alert('Failed to generate export file. Please ensure canvas has finished rendering.', { variant: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const card = (key: string, icon: any, title: string, desc: string) => (
    <div className={`format-card ${exportFormat === key ? 'active' : ''}`} onClick={() => setExportFormat(key)}>
      {icon}
      <div className="format-title">{title}</div>
      <div className="format-desc">{desc}</div>
    </div>
  );

  return (
    <Modal
      show={show}
      onHide={onClose}
      size="md"
      className="shajra-modal"
      headerVariant="custom"
      headerClassName="modal-header-custom"
      bodyClassName="modal-body-custom"
      footerClassName="modal-footer-custom"
      title={
        <>
          <span style={{ marginRight: '8px' }}>📥</span> Export Cadastral Shajra Map
        </>
      }
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={exporting}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleExecuteExport} disabled={exporting}>
            {exporting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Generating File...
              </>
            ) : (
              <>
                <Check size={14} className="mr-1" />
                Export {exportFormat === 'png3x' ? 'PNG 3x' : exportFormat.toUpperCase()}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="export-format-selector mb-4">
        <label className="field-title">Select Export Format</label>
        <div className="flex gap-2">
          {card('pdf', <FileText className="format-icon mx-auto text-[#dc3545]" size={32} />, 'PDF Document', 'Official Print (Title, Scale, North)')}
          {card('png', <FileImage className="format-icon mx-auto text-[#0d6efd]" size={32} />, 'PNG Image', 'High Resolution Image')}
          {card('png3x', <Images className="format-icon mx-auto text-[#198754]" size={32} />, 'PNG 3x', 'Quick High-Res PNG')}
        </div>
      </div>

      {exportFormat === 'pdf' && (
        <div className="export-options-box">
          <div className="flex justify-between mb-2">
            <span className="text-muted">Paper Format:</span>
            <strong>
              {PAPER_SIZES[paperConfig.paperSize]?.name || 'A3'} ({paperConfig.orientation === 'portrait' ? 'Portrait' : 'Landscape'})
            </strong>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-muted">Cadastral Scale:</span>
            <strong>{paperConfig.scale || '1:1000'}</strong>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted">Included Elements:</span>
            <span className="opt-ok text-right">✓ Title Block ✓ Scale Bar ✓ North Arrow</span>
          </div>
        </div>
      )}

      {exportFormat === 'png' && (
        <div className="export-options-box">
          <label className="field-title">Image Quality / Resolution</label>
          <select className="select" value={pngDpi} onChange={(e) => setPngDpi(e.target.value)}>
            <option value="2">Standard DPI (2x)</option>
            <option value="3">High Quality DPI (3x - Recommended)</option>
            <option value="4">Ultra High DPI (4x - Large Print)</option>
          </select>
        </div>
      )}
    </Modal>
  );
};

export default ExportModal;
