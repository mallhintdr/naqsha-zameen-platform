import { ChevronLeft, ChevronRight } from 'lucide-react';

const btn =
  'inline-flex min-h-[36px] items-center gap-1 border border-[#0d6efd] bg-white px-2 py-1 text-[0.875rem] text-[#0d6efd] hover:bg-[#0d6efd] hover:text-white disabled:opacity-65 sm:min-h-0';

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
      <div className="inline-flex" role="group">
        <button type="button" className={`${btn} rounded-l-[0.25rem]`} onClick={onPrev} disabled={!hasPrev} title="Previous Mouza">
          <ChevronLeft size={14} /> Prev
        </button>
        <button type="button" className={`${btn} -ml-px rounded-r-[0.25rem]`} onClick={onNext} disabled={!hasNext} title="Next Mouza">
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};

export default MouzaNavigator;
