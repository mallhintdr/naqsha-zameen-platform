import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/ui';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Legacy CustomDatePicker. Shows dd-mm-yyyy (D6), emits YYYY-MM-DD (local). */
export default function CustomDatePicker({ value, onChange }: { value?: string; onChange: (v: string) => void; size?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const sel = value ? new Date(value) : null;
  const selValid = sel && !Number.isNaN(sel.getTime()) ? sel : null;
  const display = selValid ? `${pad(selValid.getDate())}-${pad(selValid.getMonth() + 1)}-${selValid.getFullYear()}` : 'Select Date';

  const today = new Date();
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const days: (Date | null)[] = [];
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) days.push(null);
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) days.push(new Date(y, m, d));
  const same = (a: Date, b: Date | null) => !!b && a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  const pick = (date: Date) => {
    onChange(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
    setIsOpen(false);
  };

  return (
    <div ref={ref} className="custom-datepicker-container relative">
      <div
        className="custom-datepicker-input flex h-[38px] cursor-pointer items-center justify-between rounded border border-[#495057] bg-white p-2 text-[0.9rem]"
        onClick={() => {
          if (!isOpen && selValid) setViewDate(new Date(selValid.getFullYear(), selValid.getMonth(), 1));
          setIsOpen(!isOpen);
        }}
      >
        <span>{display}</span>
        <CalendarDays size={15} className="ml-2 text-ink-2" />
      </div>
      {isOpen && (
        <div className="custom-datepicker-dropdown absolute left-0 top-full z-[2050] mt-1 w-[280px] max-w-[calc(100vw-32px)] rounded border border-[#dee2e6] bg-white p-3 shadow-lg">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" className="btn btn-light btn-sm border !border-[#dee2e6] !px-2 !py-0" onClick={() => setViewDate(new Date(y, m - 1, 1))}><ChevronLeft size={12} /></button>
            <strong className="text-[0.95rem] text-[#212529]">{monthNames[m]} {y}</strong>
            <button type="button" className="btn btn-light btn-sm border !border-[#dee2e6] !px-2 !py-0" onClick={() => setViewDate(new Date(y, m + 1, 1))}><ChevronRight size={12} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[0.8rem]">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d} className="pb-2 font-bold text-ink-2">{d}</div>)}
            {days.map((date, i) => {
              if (!date) return <div key={`e-${i}`} />;
              const isToday = same(date, today);
              const isSel = same(date, selValid);
              return (
                <div
                  key={date.getTime()}
                  onClick={() => pick(date)}
                  className={cn(
                    'h-[30px] cursor-pointer rounded py-1 leading-[22px] transition-all duration-100',
                    isToday ? 'border border-[#fbc02d] bg-[#ffeb3b] font-bold text-black' : isSel ? 'bg-[#0d6efd] font-bold text-white' : 'text-[#212529] hover:bg-[#e9ecef]',
                  )}
                >
                  {date.getDate()}
                </div>
              );
            })}
          </div>
          <div className="mt-2 border-t border-[#dee2e6] pt-2 text-center">
            <button type="button" className="text-[0.75rem] text-[#0d6efd]" onClick={() => pick(today)}>Go to Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
