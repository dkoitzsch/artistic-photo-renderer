import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './app/theme/tokens.css';
import './app/app.css';
import './effects/registry';
import { App } from './app/App';
import { loadThemePreference } from './app/theme/theme';
import { installDebugApi } from './debug';
import { useAppStore } from './state/store';

useAppStore.getState().setTheme(loadThemePreference());
if (import.meta.env.DEV) installDebugApi();

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
