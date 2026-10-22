import React from 'react';
import { Button, ButtonGroup } from 'react-bootstrap';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const MouzaNavigator = ({ onPrev, onNext, currentMauza, hasPrev, hasNext }) => {
    return (
        <div
            style={{
                position: 'absolute',
                top: '10px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 2000,
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                padding: '5px 10px',
                borderRadius: '20px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
            }}
        >
            <span style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#333' }}>
                Test Mode: {currentMauza || 'No Mouza'}
            </span>
            <ButtonGroup size="sm">
                <Button
                    variant="outline-primary"
                    onClick={onPrev}
                    disabled={!hasPrev}
                    title="Previous Mouza"
                >
                    <FaChevronLeft /> Prev
                </Button>
                <Button
                    variant="outline-primary"
                    onClick={onNext}
                    disabled={!hasNext}
                    title="Next Mouza"
                >
                    Next <FaChevronRight />
                </Button>
            </ButtonGroup>
        </div>
    );
};

export default MouzaNavigator;
