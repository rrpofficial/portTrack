import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './theme/tokens.css';
import './theme/app.css';

const container = document.getElementById('root');
if (container === null) throw new Error('root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
