/** "Subscribe to unlock" message shown when a limited user taps a locked feature (shared/lib/featureAccess). */
import { Lock } from 'lucide-react';
import { Modal } from '@/shared/ui';
import { useAppStore } from '@/app/store';
import { LOCKED_FEATURE_LABEL, type LockedFeature } from '@/shared/lib/featureAccess';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMapTehsil } from '@/features/map/useMapTehsil';

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://naqsha-zameen.com').replace(/\/$/, '');
const ALL: LockedFeature[] = ['satellite', 'live-location', 'killa-info', 'saved-layers', 'shift-mouza', 'change-mouza'];

export default function SubscribeRequiredModal() {
  const feature = useAppStore((s) => s.subscribeFeature) as LockedFeature | null;
  const set = useAppStore((s) => s.set);
  const previewActive = useAppStore((s) => s.previewActive);
  const selectedMauza = useAppStore((s) => s.selectedMauza);
  const tehsil = useMapTehsil();
  const { user } = useAuth();
  const close = () => set({ subscribeFeature: null });
  // Preview mouza: request that mouza from the provider (sub-admin) or Naqsha Zameen on WhatsApp.
  const provider: any = (user as any)?.provider || {};
  const wa = String(provider.whatsapp || '923048840264').replace(/\D/g, '');
  const requestMouza = () => {
    const text = `Assalam-o-Alaikum, I am ${user?.userId}. I want full access to mouza ${selectedMauza}, tehsil ${tehsil}.`;
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    close();
  };
  return (
    <Modal show={!!feature} onHide={close} size="sm" title={<><Lock size={15} /> Subscribe for full features</>}
      footer={
        <>
          <button type="button" className="btn btn-sm btn-secondary" onClick={close}>Later</button>
          {previewActive ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={requestMouza}>Request this mouza</button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => set({ subscribeFeature: null, showWarningModal: true })}>Subscribe / Renew</button>
          )}
        </>
      }>
      <p className="m-0 text-[0.9rem]">
        {previewActive ? (
          <>You are previewing <strong>{selectedMauza}</strong>. {feature && feature !== 'preview' ? <><strong>{LOCKED_FEATURE_LABEL[feature]}</strong> and the features below</> : 'These features'} need a subscription to this mouza.</>
        ) : (
          <><strong>{feature ? LOCKED_FEATURE_LABEL[feature] : ''}</strong> needs an active subscription. You can still view the map on street basemaps.</>
        )}
      </p>
      <ul className="mt-2 mb-0 space-y-0.5 pl-0 text-[0.85rem]">
        {ALL.map((f) => <li key={f} className="flex items-center gap-1.5"><Lock size={12} className="text-[#b45309]" />{LOCKED_FEATURE_LABEL[f]}</li>)}
      </ul>
      <p className="mt-3 mb-0 text-[0.8rem] text-ink-2">
        We also offer RTK land measurement, drone imagery and revenue record consultancy.{' '}
        <a href={SITE_URL} target="_blank" rel="noopener" className="font-semibold text-[#0096c7] underline">See our services</a>
      </p>
    </Modal>
  );
}
