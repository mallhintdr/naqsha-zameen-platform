/**
 * Slim amber bar under the navbar while a preview mouza is open ("All Mouzas" browsing):
 * says what preview means and offers full access.
 */
import { Eye } from 'lucide-react';
import { useAppStore } from '@/app/store';
import './chrome.css';

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://naqsha-zameen.com').replace(/\/$/, '');

export default function PreviewBanner() {
  const previewActive = useAppStore((s) => s.previewActive);
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const previewLeft = useAppStore((s) => s.previewLeft);
  const set = useAppStore((s) => s.set);
  if (!previewActive || !selectedMauza) return null;
  return (
    <div className="preview-banner" role="status">
      <Eye size={13} />
      <span className="min-w-0 truncate">
        Preview: {selectedMauza} · street map{previewLeft != null ? ` · ${previewLeft} left today` : ''}
      </span>
      <a className="preview-banner-link" href={`${SITE_URL}/maps/`}>Website</a>
      <button type="button" onClick={() => set({ subscribeFeature: 'preview' })}>Get full access</button>
    </div>
  );
}
