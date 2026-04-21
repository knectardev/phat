import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../vwc-dynamic-matrix-l2ghost.jsx';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(<App />);
}
