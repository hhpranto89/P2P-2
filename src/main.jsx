import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker immediately for background push & notifications
try {
  registerSW({
    immediate: true,
    onNeedRefresh() {},
    onOfflineReady() {
      console.log('[PWA] Service Worker ready for offline & background notifications.');
    },
  });
} catch (e) {
  console.warn('[PWA] Service Worker registration skipped:', e);
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
