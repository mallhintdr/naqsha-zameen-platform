// Password reset shared by the admin and sub-admin screens: the server makes a
// random password, a WhatsApp-ready message with the user ID and new password is
// copied to the clipboard, and PasswordCopiedModal tells the admin / sub-admin.
import { useState } from 'react';
import { KeyRound, MessageCircle } from 'lucide-react';
import { api } from '@/shared/api/client';
import { Button, Modal } from '@/shared/ui';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function passwordMessage({ userId, userName, password, signOff, quickLink }: { userId: string; userName?: string; password: string; signOff?: string; quickLink?: string }) {
  const origin = window.location.origin || 'https://dashboard.naqsha-zameen.pk';
  return [
    `Dear *${userName || userId}*,`, '',
    'Your Naqsha Zameen password has been reset.',
    `User ID: *${userId}*`,
    `New Password: *${password}*`, '',
    quickLink ? `Quick Login Link:\n${quickLink}` : `Login at: ${origin}/login`, '',
    'Please change your password after logging in.', '',
    'Thanks,', `*${signOff || 'GeoMatrix Technologies'}*`,
  ].join('\n');
}

export interface PasswordResetInfo {
  userId: string;
  userName?: string;
  password: string;
  message: string;
  copied: boolean;
  emailSent: boolean;
}

/** Resets the password on the server and copies the WhatsApp message. */
export async function resetPasswordAndCopy(
  userId: string,
  { userName, signOff, withQuickLink = false }: { userName?: string; signOff?: string; withQuickLink?: boolean } = {},
): Promise<PasswordResetInfo> {
  const { data } = await api.post(`/api/users/${encodeURIComponent(userId)}/reset-default-password`, {});
  const password = data?.temporaryPassword;
  if (!password) throw new Error(data?.message || 'The server did not return the new password.');
  const name = userName || data.userName;
  let quickLink: string | undefined;
  if (withQuickLink) {
    const token = btoa(JSON.stringify({ u: userId, p: password }));
    quickLink = `${window.location.origin || 'https://dashboard.naqsha-zameen.pk'}/login?t=${token}`;
  }
  const message = passwordMessage({ userId, userName: name, password, signOff, quickLink });
  const copied = await copyToClipboard(message);
  return { userId, userName: name, password, message, copied, emailSent: !!data.emailSent };
}

/** "New password copied" notice with the message, for pasting into WhatsApp. */
export function PasswordCopiedModal({ info, onHide }: { info: PasswordResetInfo | null; onHide: () => void }) {
  const [again, setAgain] = useState(false);
  if (!info) return null;
  const close = () => {
    setAgain(false);
    onHide();
  };
  return (
    <Modal
      show
      onHide={close}
      size="compact"
      zIndex={20000}
      title={<><KeyRound size={16} className="text-[#10b981]" />Password reset</>}
      footer={
        <>
          <Button variant="outline-success" size="sm" onClick={async () => setAgain(await copyToClipboard(info.message))}>
            <MessageCircle size={14} />{again ? 'Copied again' : 'Copy again'}
          </Button>
          <Button variant="primary" size="sm" onClick={close}>OK</Button>
        </>
      }
    >
      <div className={`alert ${info.copied ? 'alert-success' : 'alert-warning'} mb-2 py-2 text-[0.9rem]`}>
        <div>
          {info.copied ? (
            <><MessageCircle size={14} className="mr-1 inline" />The new password and a WhatsApp message were <strong>copied to the clipboard</strong>. Paste it into WhatsApp to send it to the customer.</>
          ) : (
            'The clipboard could not be used. Copy the message below.'
          )}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap justify-between gap-1 text-[0.9rem]">
        <span>User ID: <strong>{info.userId}</strong></span>
        <span>New password: <code className="text-[0.95rem] text-[#d63384]">{info.password}</code></span>
      </div>
      <textarea className="textarea text-[0.8rem]" rows={9} readOnly value={info.message} onFocus={(e) => e.target.select()} />
      {info.emailSent && <div className="mt-1 text-sm text-ink-2">The new password was also emailed to the customer.</div>}
    </Modal>
  );
}
