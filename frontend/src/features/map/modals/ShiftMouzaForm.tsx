/** Port of legacy components/Map/Core/ShiftMouzaForm.js (inv-04 §7.3). */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui';
import { api } from '@/shared/api/client';
import { SHIFT_BODY_CLASS, SHIFT_HEADER_CLASS, SHIFT_HEADER_STYLE } from './shared';
import '../ShiftMouzaForm.css';

interface Props {
  show: boolean;
  onHide: () => void;
  onShift: (o: { latOffset: number; lngOffset: number }) => void;
  tehsil?: string;
  mauza?: string;
}

type Msg = { type: 'success' | 'danger' | 'info'; text: string } | null;

const resultConfig = {
  success: { icon: '✅', iconClass: 'result-icon-success', headerClass: 'result-header-success', title: 'Shift Applied', okLabel: 'OK' },
  danger: { icon: '❌', iconClass: 'result-icon-danger', headerClass: 'result-header-danger', title: 'Error', okLabel: 'Close' },
  info: { icon: '🔁', iconClass: 'result-icon-info', headerClass: 'result-header-info', title: 'Position Reset', okLabel: 'OK' },
};

const adjustmentUrl = (tehsil: string, mauza: string) =>
  `/api/geo/adjustment/${encodeURIComponent(tehsil)}/${encodeURIComponent(mauza)}`;

const ShiftMouzaForm = ({ show, onHide, onShift, tehsil, mauza }: Props) => {
  const [direction, setDirection] = useState('North');
  const [distance, setDistance] = useState<string | number>('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [currentOffsets, setCurrentOffsets] = useState({ lat: 0, lng: 0 });

  const handleReset = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { data } = await api.delete(adjustmentUrl(tehsil, mauza));
      const newLat = data?.latOffset ?? 0;
      const newLng = data?.lngOffset ?? 0;
      setCurrentOffsets({ lat: newLat, lng: newLng });
      onShift({ latOffset: newLat, lngOffset: newLng });
      setMessage({ type: 'info', text: 'Mouza position has been reset to its baseline location.' });
      setDistance('');
    } catch (error) {
      console.error('Error resetting offset:', error);
      setMessage({ type: 'danger', text: 'Failed to reset offset. Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [tehsil, mauza, onShift]);

  // Tour value dispatch events & silent reset
  useEffect(() => {
    const handleTourValues = (e: any) => {
      const { distance: d, direction: dir } = e.detail || {};
      if (d !== undefined) setDistance(d);
      if (dir !== undefined) setDirection(dir);
    };
    const handleSilentReset = () => handleReset();
    window.addEventListener('setShiftTourValues', handleTourValues);
    window.addEventListener('silentResetShiftMouza', handleSilentReset);
    return () => {
      window.removeEventListener('setShiftTourValues', handleTourValues);
      window.removeEventListener('silentResetShiftMouza', handleSilentReset);
    };
  }, [handleReset]);

  // Fetch existing offset for the current mouza
  useEffect(() => {
    if (!tehsil || !mauza || !show || mauza === 'undefined') return;
    api
      .get(adjustmentUrl(tehsil, mauza))
      .then(({ data }) => setCurrentOffsets({ lat: data?.latOffset || 0, lng: data?.lngOffset || 0 }))
      .catch((err) => console.error('Failed to fetch initial adjustment:', err));
  }, [tehsil, mauza, show]);

  const handleMove = async () => {
    if (!distance || Number(distance) <= 0) {
      setMessage({ type: 'danger', text: 'Please enter a valid distance in feet.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      // Approximate conversion: 1 ft ≈ 1/364000 deg lat, 1/315000 deg lng at ~30°N
      let latOffset = currentOffsets.lat;
      let lngOffset = currentOffsets.lng;
      const feetToLat = 1 / 364000;
      const feetToLng = 1 / 315000;
      const distNum = Number(distance);
      if (direction === 'North') latOffset += distNum * feetToLat;
      else if (direction === 'South') latOffset -= distNum * feetToLat;
      else if (direction === 'East') lngOffset += distNum * feetToLng;
      else if (direction === 'West') lngOffset -= distNum * feetToLng;

      await api.post(adjustmentUrl(tehsil, mauza), { latOffset, lngOffset });
      setCurrentOffsets({ lat: latOffset, lng: lngOffset });
      onShift({ latOffset, lngOffset });
      setMessage({ type: 'success', text: `Shift of ${distance} ft to the ${direction} applied successfully.` });
      setDistance('');
    } catch (error) {
      console.error('Error applying shift:', error);
      setMessage({ type: 'danger', text: 'Failed to apply shift. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const cfg = message ? resultConfig[message.type] ?? resultConfig.info : null;
  const dirBtn = (dir: string, cls: string, letter: string) => (
    <button type="button" className={`compass-btn ${cls}${direction === dir ? ' active' : ''}`} onClick={() => setDirection(dir)} title={dir}>
      {letter}
    </button>
  );

  return (
    <>
      <Modal
        show={show}
        onHide={onHide}
        size="compact"
        headerVariant="custom"
        headerStyle={SHIFT_HEADER_STYLE}
        headerClassName={SHIFT_HEADER_CLASS}
        bodyClassName={SHIFT_BODY_CLASS}
        className="shift-mouza-modal"
        title={
          <>
            <span className="text-base opacity-90">🔄</span> Shift Mouza
          </>
        }
      >
        <div className="shift-mouza-chip">
          <div>
            <span className="chip-label">Selected Chak&nbsp;</span>
            <span className="chip-value">{mauza || '—'}</span>
          </div>
        </div>

        <div className="shift-compass">
          <div />
          {dirBtn('North', 'btn-north', 'N')}
          <div />
          {dirBtn('West', 'btn-west', 'W')}
          <div className="compass-center">
            <div className="compass-dot" />
          </div>
          {dirBtn('East', 'btn-east', 'E')}
          <div />
          {dirBtn('South', 'btn-south', 'S')}
          <div />
        </div>

        <div className="shift-distance-group">
          <span className="shift-distance-label">Distance</span>
          <div className="shift-distance-input-wrap">
            <input
              type="number"
              min="1"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="e.g., 100"
              disabled={loading}
              onKeyDown={(e) => e.key === 'Enter' && !loading && handleMove()}
            />
            <span className="shift-distance-unit">feet</span>
          </div>
        </div>

        <div className="shift-action-row">
          <button type="button" className="shift-btn-reset" onClick={handleReset} disabled={loading} title="Reset to original position">
            {loading ? '…' : '↺ Reset'}
          </button>
          <button type="button" className="shift-btn-apply" onClick={handleMove} disabled={loading} title={`Shift ${distance || '?'} ft to the ${direction}`}>
            {loading ? 'Applying…' : '↑ Apply Shift'}
          </button>
        </div>
      </Modal>

      {message && cfg && (
        <Modal
          show={!!message}
          onHide={() => setMessage(null)}
          size="compact"
          backdrop="static"
          headerVariant="none"
          title={cfg.title}
          className="shift-result-modal"
          bodyClassName="shift-result-body"
          zIndex={10600}
        >
          <div className={`shift-result-icon ${cfg.iconClass}`}>{cfg.icon}</div>
          <h5 className="shift-result-title">{cfg.title}</h5>
          <p className="shift-result-text">{message.text}</p>
          <button type="button" className={`shift-result-ok-btn ${cfg.headerClass}`} onClick={() => setMessage(null)} autoFocus>
            {cfg.okLabel}
          </button>
        </Modal>
      )}
    </>
  );
};

export default ShiftMouzaForm;
