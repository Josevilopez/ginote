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

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
