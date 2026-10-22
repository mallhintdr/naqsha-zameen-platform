import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Alert } from 'react-bootstrap';
import axios from 'axios';
import '../../../styles/ShiftMouzaForm.css';

const ShiftMouzaForm = ({ show, onHide, onShift, tehsil, mauza }) => {
    const [direction, setDirection] = useState('North');
    const [distance, setDistance] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [currentOffsets, setCurrentOffsets] = useState({ lat: 0, lng: 0 });

    const apiBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';

    const handleReset = useCallback(async () => {
        setLoading(true);
        setMessage(null);

        try {
            const url = `${apiBaseUrl}/api/geo/adjustment/${encodeURIComponent(tehsil)}/${encodeURIComponent(mauza)}`;
            const { data } = await axios.delete(url, { withCredentials: true });

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
    }, [apiBaseUrl, tehsil, mauza, onShift]);

    // Listen for tour value dispatch events & silent reset
    useEffect(() => {
        const handleTourValues = (e) => {
            const { distance: d, direction: dir } = e.detail || {};
            if (d !== undefined) setDistance(d);
            if (dir !== undefined) setDirection(dir);
        };
        const handleSilentReset = () => {
            handleReset();
        };
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

        const fetchOffset = async () => {
            try {
                const url = `${apiBaseUrl}/api/geo/adjustment/${encodeURIComponent(tehsil)}/${encodeURIComponent(mauza)}`;
                const { data } = await axios.get(url, { withCredentials: true });
                setCurrentOffsets({ lat: data.latOffset || 0, lng: data.lngOffset || 0 });
            } catch (err) {
                console.error('Failed to fetch initial adjustment:', err);
            }
        };

        fetchOffset();
    }, [tehsil, mauza, show, apiBaseUrl]);

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
            else if (direction === 'East')  lngOffset += distNum * feetToLng;
            else if (direction === 'West')  lngOffset -= distNum * feetToLng;

            const url = `${apiBaseUrl}/api/geo/adjustment/${encodeURIComponent(tehsil)}/${encodeURIComponent(mauza)}`;
            await axios.post(url, { latOffset, lngOffset }, { withCredentials: true });

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



    const fmt = (n) => (n >= 0 ? `+${n.toFixed(6)}` : n.toFixed(6));

    // ── Result modal config by type ──────────────────────────────────────────
    const resultConfig = {
        success: {
            icon: '✅',
            iconClass: 'result-icon-success',
            headerClass: 'result-header-success',
            title: 'Shift Applied',
            okLabel: 'OK',
        },
        danger: {
            icon: '❌',
            iconClass: 'result-icon-danger',
            headerClass: 'result-header-danger',
            title: 'Error',
            okLabel: 'Close',
        },
        info: {
            icon: '🔁',
            iconClass: 'result-icon-info',
            headerClass: 'result-header-info',
            title: 'Position Reset',
            okLabel: 'OK',
        },
    };

    const cfg = message ? resultConfig[message.type] ?? resultConfig.info : null;

    return (
        <>
            {/* ── Main Shift Form Modal ── */}
            <Modal
                show={show}
                onHide={onHide}
                centered
                size="sm"
                dialogClassName="modern-modal-compact shift-mouza-modal"
            >
                {/* Header */}
                <Modal.Header closeButton>
                    <Modal.Title>
                        <span className="title-icon">🔄</span>
                        Shift Mouza
                    </Modal.Title>
                </Modal.Header>

                {/* Body */}
                <Modal.Body>

                    {/* Selected mouza chip */}
                    <div className="shift-mouza-chip">
                        <div>
                            <span className="chip-label">Selected Chak&nbsp;</span>
                            <span className="chip-value">{mauza || '—'}</span>
                        </div>
                    </div>



                    {/* Compass direction pad */}
                    <div className="shift-compass">
                        <div />
                        <button className={`compass-btn btn-north${direction === 'North' ? ' active' : ''}`} onClick={() => setDirection('North')} title="North">N</button>
                        <div />

                        <button className={`compass-btn btn-west${direction === 'West' ? ' active' : ''}`} onClick={() => setDirection('West')} title="West">W</button>
                        <div className="compass-center"><div className="compass-dot" /></div>
                        <button className={`compass-btn btn-east${direction === 'East' ? ' active' : ''}`} onClick={() => setDirection('East')} title="East">E</button>

                        <div />
                        <button className={`compass-btn btn-south${direction === 'South' ? ' active' : ''}`} onClick={() => setDirection('South')} title="South">S</button>
                        <div />
                    </div>

                    {/* Distance input */}
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

                    {/* Action buttons */}
                    <div className="shift-action-row">
                        <button
                            className="shift-btn-reset"
                            onClick={handleReset}
                            disabled={loading}
                            title="Reset to original position"
                        >
                            {loading ? '…' : '↺ Reset'}
                        </button>
                        <button
                            className="shift-btn-apply"
                            onClick={handleMove}
                            disabled={loading}
                            title={`Shift ${distance || '?'} ft to the ${direction}`}
                        >
                            {loading ? 'Applying…' : '↑ Apply Shift'}
                        </button>
                    </div>

                </Modal.Body>
            </Modal>

            {/* ── Result Notification Modal ── */}
            {message && cfg && (
                <Modal
                    show={!!message}
                    onHide={() => setMessage(null)}
                    centered
                    size="sm"
                    dialogClassName="modern-modal-compact shift-result-modal"
                    backdrop="static"
                >
                    <Modal.Body className="shift-result-body">
                        {/* Icon */}
                        <div className={`shift-result-icon ${cfg.iconClass}`}>
                            {cfg.icon}
                        </div>

                        {/* Title */}
                        <h5 className="shift-result-title">{cfg.title}</h5>

                        {/* Message text */}
                        <p className="shift-result-text">{message.text}</p>

                        {/* Dismiss button */}
                        <button
                            className={`shift-result-ok-btn ${cfg.headerClass}`}
                            onClick={() => setMessage(null)}
                            autoFocus
                        >
                            {cfg.okLabel}
                        </button>
                    </Modal.Body>
                </Modal>
            )}
        </>
    );
};

export default ShiftMouzaForm;
