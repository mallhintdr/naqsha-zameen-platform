/** Port of legacy components/Map/Core/GoToLocationForm.js (inv-04 §7.2). */
import { useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui';
import { validateCoordinates, parseCoordinateString, isInPakistan } from '@/shared/lib/locationUtils';
import { SHIFT_BODY_CLASS, SHIFT_HEADER_CLASS, SHIFT_HEADER_STYLE } from './shared';
import '../ShiftMouzaForm.css';

interface Props {
  show?: boolean;
  onClose: () => void;
  onGoToLocation: (p: { lat: number; lng: number }) => void;
  onClearMarkers: () => void;
}

const label = 'mb-1 block text-[0.8rem] font-semibold text-[#212529]';
const input =
  'block w-full rounded-[0.25rem] border border-[#dee2e6] bg-white px-2 py-1 text-[0.875rem] text-[#212529] outline-none focus:border-[#86b7fe] focus:shadow-[0_0_0_0.25rem_rgba(13,110,253,0.25)] max-sm:min-h-[36px]';

const GoToLocationForm = ({ show = true, onClose, onGoToLocation, onClearMarkers }: Props) => {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [coordinateInput, setCoordinateInput] = useState('');
  const [coordFormat, setCoordFormat] = useState('decimal');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    let lat: number, lng: number;
    if (coordinateInput.trim()) {
      const parsed = parseCoordinateString(coordinateInput);
      if (parsed) {
        lat = parsed.lat;
        lng = parsed.lng;
      } else {
        return setErrorMessage('Format example: "31.5204, 74.3587"');
      }
    } else {
      lat = parseFloat(latitude);
      lng = parseFloat(longitude);
    }
    if (isNaN(lat) || isNaN(lng)) return setErrorMessage('Please enter valid numbers.');
    if (!validateCoordinates(lat, lng)) return setErrorMessage('Lat must be -90 to 90; Lng -180 to 180.');
    if (!isInPakistan(lat, lng)) return setErrorMessage('Coordinates must be within Pakistan.');
    setErrorMessage('');
    onGoToLocation({ lat, lng });
    onClose();
  };

  const handleClearAll = () => {
    onClearMarkers();
    setLatitude('');
    setLongitude('');
    setCoordinateInput('');
    setErrorMessage('');
  };

  return (
    <Modal
      id="goto-location-modal"
      show={show}
      onHide={onClose}
      size="compact"
      headerVariant="custom"
      headerStyle={SHIFT_HEADER_STYLE}
      headerClassName={SHIFT_HEADER_CLASS}
      bodyClassName={SHIFT_BODY_CLASS}
      className="shift-mouza-modal goto-location-modal"
      title={
        <>
          <span className="text-base opacity-90">🎯</span> Go To Location
        </>
      }
    >
      {errorMessage && (
        <div role="alert" className="relative m-0 rounded-lg border-[1.5px] border-[#f1aeb5] bg-[#f8d7da] py-1 pl-2 pr-8 text-[0.8rem] text-[#58151c]">
          {errorMessage}
          <button type="button" aria-label="Close" className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-base leading-none opacity-60 hover:opacity-100" onClick={() => setErrorMessage('')}>
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className={label} htmlFor="goto-format">Format</label>
          <select
            id="goto-format"
            className={input}
            value={coordFormat}
            onChange={(e) => {
              setCoordFormat(e.target.value);
              setCoordinateInput('');
              setLatitude('');
              setLongitude('');
            }}
          >
            <option value="decimal">Decimal Degrees (DD)</option>
            <option value="dms">Degrees Minutes Seconds (DMS)</option>
            <option value="paste">Paste Coordinates</option>
          </select>
        </div>

        {coordFormat === 'paste' ? (
          <div className="mb-3">
            <label className={label} htmlFor="goto-paste">Paste Coordinates</label>
            <textarea id="goto-paste" rows={2} className={input} value={coordinateInput} onChange={(e) => setCoordinateInput(e.target.value)} placeholder="31.5204, 74.3587" />
          </div>
        ) : (
          <div className="mb-3 flex gap-2">
            <div className="min-w-0 flex-1">
              <label className={label} htmlFor="goto-lat">Latitude</label>
              <input id="goto-lat" type="number" step="any" min="-90" max="90" className={input} value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="-90 to 90" required />
            </div>
            <div className="min-w-0 flex-1">
              <label className={label} htmlFor="goto-lng">Longitude</label>
              <input id="goto-lng" type="number" step="any" min="-180" max="180" className={input} value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="-180 to 180" required />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button id="goto-submit-btn" type="submit" className="btn btn-primary btn-sm flex-1 font-semibold max-sm:min-h-[36px]">Go To Location</button>
          <button type="button" className="btn btn-outline-danger btn-sm font-semibold max-sm:min-h-[36px]" onClick={handleClearAll}>Clear</button>
        </div>
      </form>
    </Modal>
  );
};

export default GoToLocationForm;
