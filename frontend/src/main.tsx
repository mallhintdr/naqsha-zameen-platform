import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import './styles/tailwind.css';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { DialogProvider, Toaster } from '@/shared/ui';
import { initSecureLogger, installChartTooltipAutoHide, startVersionChecker } from '@/shared/lib/system';
import App from './app/App';

initSecureLogger();
installChartTooltipAutoHide();
startVersionChecker();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <DialogProvider>
            <App />
            <Toaster />
          </DialogProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
