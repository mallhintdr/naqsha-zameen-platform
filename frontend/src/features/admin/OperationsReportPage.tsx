// Port of components/Admin/OperationsReportTool.js (/admin/operations-report). PDF is emailed by the backend.
import { useState, type FormEvent } from 'react';
import { FileText, MailOpen } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Alert, Spinner } from '@/shared/ui';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function OperationsReportPage() {
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!startDate || !endDate) {
      setError('Please select both a start and end date.');
      return;
    }
    if (startDate > endDate) {
      setError('Start date must be on or before the end date.');
      return;
    }
    setGenerating(true);
    try {
      const { data } = await api.post('/api/admin/reports/generate', { startDate, endDate }, { timeout: 120000 });
      setResult(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to generate the report.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[700px] px-3 py-6">
      <h4 className="mb-3 flex items-center gap-2 text-xl font-medium text-teal-ink">
        <FileText className="text-[#dc3545]" size={22} />
        Operations Report
      </h4>
      <p className="mb-4 text-[0.9rem] text-ink-2">
        Generate a branded PDF operations report (registrations, renewals, expirations, revenue, subscription health) for any date
        range and email it to yourself.
      </p>
      <div className="card-plain">
        <div className="p-4">
          <form onSubmit={handleGenerate} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label className="field-label">Start Date</label>
              <input type="date" className="input" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="sm:col-span-5">
              <label className="field-label">End Date</label>
              <input type="date" className="input" value={endDate} min={startDate} max={todayStr()} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn btn-primary w-full min-h-[42px]" disabled={generating}>
                {generating ? <Spinner size="sm" className="text-white" /> : 'Generate'}
              </button>
            </div>
          </form>

          {generating && (
            <Alert variant="info" className="mt-3 items-center">
              <span className="inline-flex items-center gap-2">
                <Spinner size="sm" className="text-current" />
                Aggregating data and rendering the PDF — this can take up to a minute for a wide date range.
              </span>
            </Alert>
          )}
          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
          {result && (
            <Alert variant={result.pdfGenerated ? 'success' : 'warning'} className="mt-3">
              <span className="inline-flex items-start gap-2">
                <MailOpen size={18} className="shrink-0" />
                {result.message}
              </span>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
