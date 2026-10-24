import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';
// Tipografía de la portada, servida con la app (funciona sin conexión).
import '@fontsource/alegreya/700-italic.css';
import '@fontsource/alegreya/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import '@fontsource/alegreya-sans/800.css';

// Alto real de la ventana. En algunas webs instaladas (PWA) de Android,
// `100dvh` cuenta también la zona de la barra de navegación del sistema y
// la parte de abajo (tu mano) quedaba tapada. `innerHeight` es lo que se ve.
function setAppHeight(): void {
  document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);

// Service worker registrado siempre (no solo al activar avisos): sin él el
// navegador no ofrece instalar la app. `sw.js` no cachea nada.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
