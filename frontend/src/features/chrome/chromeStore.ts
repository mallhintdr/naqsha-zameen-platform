/** Small chrome-local state shared between the navbar notification panel and GlobalModals. */
import { create } from 'zustand';
import type { AppNotification } from '@/features/auth/AuthProvider';

interface ChromeState {
  /** Notification being replied to (legacy Header `replyFor`) */
  replyFor: AppNotification | null;
  setReplyFor: (n: AppNotification | null) => void;
}

export const useChromeStore = create<ChromeState>((set) => ({
  replyFor: null,
  setReplyFor: (replyFor) => set({ replyFor }),
}));
