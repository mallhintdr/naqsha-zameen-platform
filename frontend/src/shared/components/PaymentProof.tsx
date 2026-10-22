// Optional payment proof: a screenshot (picked, or pasted with Ctrl+V) and/or the
// text of a payment SMS. Shared by sub-admin payments and user renewals.
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Image as ImageIcon, MessageSquare, Paperclip, Receipt } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Badge, Button, Modal, Spinner } from '@/shared/ui';
import { fmtDate } from '@/shared/lib/format';

export interface Proof {
  image: string | null;
  preview: string | null;
  smsText: string;
}
export const EMPTY_PROOF: Proof = { image: null, preview: null, smsText: '' };
export const hasProof = (p: any) => Boolean(p && (p.image || (p.smsText || '').trim()));

// Shrink to at most 1600px on the long side, JPEG ~80%.
function compressImage(file: File | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image (screenshot).'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Uploads the proof if anything was attached. Returns the saved proof, or null when there was nothing to send. */
export async function uploadPaymentProof({ kind, refId, userId, proof, note, attachToLatest = false }: { kind: string; refId?: string; userId?: string; proof?: any; note?: string; attachToLatest?: boolean }) {
  if (!hasProof(proof) && !note) return null;
  const { data } = await api.post('/api/payment-proofs', {
    kind, refId, userId, image: proof?.image || undefined, smsText: proof?.smsText || undefined, note: note || undefined,
    attachToLatest: attachToLatest || undefined,
  });
  return data.proof;
}

/** Form section: screenshot + SMS text, both optional. */
export function PaymentProofInput({ value = EMPTY_PROOF, onChange, compact = false, disabled = false }: { value?: Proof; onChange: (p: Proof) => void; compact?: boolean; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const takeFile = useCallback(async (file: File | null) => {
    setError(null);
    setBusy(true);
    try {
      const image = await compressImage(file);
      onChange({ ...value, image, preview: image });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [value, onChange]);

  const onPaste = (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      takeFile(item.getAsFile());
    }
  };

  return (
    <div onPaste={onPaste} className="rounded border border-dashed border-[#94a3b8] bg-[#f8fafc] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[0.8rem] font-semibold text-[#475569]">
          <Paperclip size={13} className="mr-1 inline" />Payment proof <span className="font-normal text-ink-2">(optional)</span>
        </span>
        {hasProof(value) && (
          <button type="button" className="text-[0.8rem] text-[#dc3545] hover:underline" disabled={disabled} onClick={() => onChange(EMPTY_PROOF)}>Remove</button>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-none">
          <input ref={fileRef} type="file" accept="image/*" hidden disabled={disabled}
            onChange={(e) => { if (e.target.files?.[0]) takeFile(e.target.files[0]); e.target.value = ''; }} />
          {value.preview ? (
            <img src={value.preview} alt="Payment screenshot" title="Click to replace" onClick={() => fileRef.current?.click()}
              className="h-[84px] w-[84px] cursor-pointer rounded-md border border-[#cbd5e1] object-cover" />
          ) : (
            <Button size="sm" variant="outline-primary" disabled={disabled || busy} onClick={() => fileRef.current?.click()}
              className="!flex h-[84px] w-[84px] flex-col !gap-1.5 !p-1 text-center !text-[0.72rem] !leading-tight !whitespace-normal">
              {busy ? <Spinner size="sm" /> : <><ImageIcon size={22} /><span>Add screenshot</span></>}
            </Button>
          )}
        </div>
        <textarea className="textarea min-h-[84px] flex-[1_1_220px] !text-[0.85rem]" rows={compact ? 2 : 3} disabled={disabled} maxLength={2000}
          placeholder="Paste the payment SMS / confirmation text here (optional). You can also paste a screenshot with Ctrl+V."
          value={value.smsText} onChange={(e) => onChange({ ...value, smsText: e.target.value })} />
      </div>
      {error && <div className="mt-1 text-sm text-[#dc3545]">{error}</div>}
    </div>
  );
}

/** Small "📎 Proof" button that opens the attached screenshot / SMS text. */
export function ProofViewButton({ proofs }: { proofs?: any[] }) {
  const [show, setShow] = useState(false);
  if (!proofs || !proofs.length) return null;
  return (
    <>
      <Button size="sm" variant="outline-info" className="!px-1 !py-0 !text-[0.72rem]" title="View payment proof"
        onClick={(e) => { e.stopPropagation(); setShow(true); }}>
        <Paperclip size={12} />{proofs.length > 1 ? ` ${proofs.length}` : ''}
      </Button>
      {show && <ProofModal proofs={proofs} onHide={() => setShow(false)} />}
    </>
  );
}

function ProofImage({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    api.get(`/api/payment-proofs/${id}/file`, { responseType: 'blob' })
      .then((r) => { url = URL.createObjectURL(r.data); if (alive) setSrc(url); })
      .catch(() => alive && setErr('Could not load the screenshot.'));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (err) return <div className="text-sm text-[#dc3545]">{err}</div>;
  if (!src) return <div className="py-3 text-center"><Spinner size="sm" /></div>;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Open full size" className="flex w-full items-center justify-center rounded-md bg-[#f8fafc]">
      <img src={src} alt="Payment screenshot" className="block h-auto max-h-[calc(100vh-260px)] w-auto max-w-full rounded-md border border-[#e2e8f0] object-contain" />
    </a>
  );
}

export function ProofModal({ proofs, onHide }: { proofs: any[]; onHide: () => void }) {
  return (
    <Modal show onHide={onHide} size="lg" title="Payment proof" zIndex={10800}
      footer={<Button variant="secondary" onClick={onHide}>Close</Button>}>
      {proofs.map((p, i) => (
        <div key={p._id} className={i ? 'mt-4 border-t border-[#dee2e6] pt-3' : ''}>
          <div className="mb-2 text-sm text-ink-2">
            Added {new Date(p.createdAt).toLocaleString('en-PK')} by {p.uploadedBy} <Badge bg="light">{p.uploaderRole}</Badge>
          </div>
          {p.file && <ProofImage id={p._id} />}
          {p.smsText && (
            <div className="mt-2 whitespace-pre-wrap rounded bg-[#f1f5f9] p-2 font-mono text-[0.85rem]">
              <div className="mb-1 text-sm text-ink-2"><MessageSquare size={12} className="mr-1 inline" />Payment SMS / text</div>
              {p.smsText}
            </div>
          )}
          {p.note && <div className="mt-2 text-sm"><strong>Note:</strong> {p.note}</div>}
        </div>
      ))}
    </Modal>
  );
}

/** Every payment proof attached to this customer's renewals, newest first, each with a View button. */
export function RenewalProofList({ userId, refreshKey }: { userId: string; refreshKey?: any }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  useEffect(() => {
    if (!userId) return undefined;
    let alive = true;
    api.get('/api/payment-proofs', { params: { kind: 'renewal', userId } })
      .then((r) => alive && setRows(r.data.proofs || []))
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [userId, refreshKey]);

  return (
    <div className="mt-3">
      <div className="mb-1 text-[0.8rem] font-semibold text-[#475569]">
        <Receipt size={13} className="mr-1 inline" />Payment proofs {rows ? `(${rows.length})` : ''}
      </div>
      {rows === null ? <Spinner size="sm" />
        : rows.length === 0 ? <div className="text-[0.8rem] text-ink-2">No payment proof attached to this customer&apos;s renewals yet.</div>
          : (
            <div className="max-h-[180px] overflow-y-auto rounded border border-[#dee2e6] bg-white">
              {rows.map((p) => (
                <div key={p._id} className="flex items-center justify-between gap-2 border-b border-[#dee2e6] px-2 py-1 text-[0.8rem]">
                  <div className="min-w-0">
                    <strong>{fmtDate(p.createdAt)}</strong>{' '}
                    {p.file && <Badge bg="info" className="mr-1">screenshot</Badge>}
                    {p.smsText && <Badge bg="secondary" className="mr-1">SMS</Badge>}
                    {!p.refId && <Badge bg="warning" title="Saved without a matching renewal entry">unlinked</Badge>}
                    {p.smsText && <div className="max-w-[360px] truncate text-ink-2">{p.smsText}</div>}
                  </div>
                  <Button size="sm" variant="outline-info" className="shrink-0 !px-2 !py-0" onClick={() => setOpen(p)}>View</Button>
                </div>
              ))}
            </div>
          )}
      {open && <ProofModal proofs={[open]} onHide={() => setOpen(null)} />}
    </div>
  );
}

/** Loads proofs for a set of records and groups them by refId (or userId). */
export function useProofs(params: any, deps?: any[]): [Record<string, any[]>, () => void] {
  const [byRef, setByRef] = useState<Record<string, any[]>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!params) return undefined;
    api.get('/api/payment-proofs', { params })
      .then((r) => {
        if (!alive) return;
        const map: Record<string, any[]> = {};
        (r.data.proofs || []).forEach((p: any) => { const k = p.refId || `user:${p.userId}`; (map[k] = map[k] || []).push(p); });
        setByRef(map);
      })
      .catch(() => {});
    return () => { alive = false; };
     
  }, [...(deps || []), tick]);
  return [byRef, () => setTick((t) => t + 1)];
}
