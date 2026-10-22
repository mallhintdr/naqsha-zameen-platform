import React, { useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import {
  validateCoordinates,
  parseCoordinateString,
  isInPakistan
} from '@/shared/lib/locationUtils';
import '../../../styles/ShiftMouzaForm.css'; // Reuse shift modal styling

const GoToLocationForm = ({ show = true, onClose, onGoToLocation, onClearMarkers }) => {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [coordinateInput, setCoordinateInput] = useState('');
  const [coordFormat, setCoordFormat] = useState('decimal');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    let lat, lng;

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

    if (isNaN(lat) || isNaN(lng)) {
      return setErrorMessage('Please enter valid numbers.');
    }
    if (!validateCoordinates(lat, lng)) {
      return setErrorMessage('Lat must be -90 to 90; Lng -180 to 180.');
    }

    if (!isInPakistan(lat, lng)) {
      return setErrorMessage('Coordinates must be within Pakistan.');
    }

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
      show={show}
      onHide={onClose}
      centered
      size="sm"
      dialogClassName="modern-modal-compact shift-mouza-modal"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          <span className="title-icon">🎯</span> Go To Location
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {errorMessage && (
          <Alert
            variant="danger"
            className="error-alert py-1 px-2 mb-2"
            style={{ fontSize: '0.8rem', margin: 0 }}
            dismissible
            onClose={() => setErrorMessage('')}
          >
            {errorMessage}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Form.Group className="form-group-modern mb-3">
            <Form.Label className="modern-label mb-1" style={{ fontSize: '0.8rem', fontWeight: '600' }}>
              Format
            </Form.Label>
            <Form.Select
              size="sm"
              value={coordFormat}
              onChange={(e) => {
                setCoordFormat(e.target.value);
                setCoordinateInput('');
                setLatitude('');
                setLongitude('');
              }}
              className="modern-input"
            >
              <option value="decimal">Decimal Degrees (DD)</option>
              <option value="dms">Degrees Minutes Seconds (DMS)</option>
              <option value="paste">Paste Coordinates</option>
            </Form.Select>
          </Form.Group>

          {coordFormat === 'paste' ? (
            <Form.Group className="form-group-modern mb-3">
              <Form.Label className="modern-label mb-1" style={{ fontSize: '0.8rem', fontWeight: '600' }}>
                Paste Coordinates
              </Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                size="sm"
                value={coordinateInput}
                onChange={e => setCoordinateInput(e.target.value)}
                placeholder="31.5204, 74.3587"
                className="modern-input"
              />
            </Form.Group>
          ) : (
            <div className="d-flex gap-2 mb-3">
              <Form.Group className="form-group-modern flex-fill mb-0">
                <Form.Label className="modern-label mb-1" style={{ fontSize: '0.8rem', fontWeight: '600' }}>
                  Latitude
                </Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  min="-90"
                  max="90"
                  size="sm"
                  value={latitude}
                  onChange={e => setLatitude(e.target.value)}
                  placeholder="-90 to 90"
                  required
                  className="modern-input"
                />
              </Form.Group>

              <Form.Group className="form-group-modern flex-fill mb-0">
                <Form.Label className="modern-label mb-1" style={{ fontSize: '0.8rem', fontWeight: '600' }}>
                  Longitude
                </Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  min="-180"
                  max="180"
                  size="sm"
                  value={longitude}
                  onChange={e => setLongitude(e.target.value)}
                  placeholder="-180 to 180"
                  required
                  className="modern-input"
                />
              </Form.Group>
            </div>
          )}

          <div className="d-flex gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="flex-fill"
              style={{ fontWeight: '600' }}
            >
              Go To Location
            </Button>
            <Button
              type="button"
              variant="outline-danger"
              size="sm"
              onClick={handleClearAll}
              style={{ fontWeight: '600' }}
            >
              Clear
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
};

export default GoToLocationForm;
