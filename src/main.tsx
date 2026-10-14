import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './app/theme/tokens.css';
import './app/app.css';
import { App } from './app/App';
import { loadThemePreference } from './app/theme/theme';
import { useAppStore } from './state/store';

useAppStore.getState().setTheme(loadThemePreference());

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
