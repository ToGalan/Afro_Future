import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { schedulePreloads } from './assets/preloadAssets';

// Wrapper to trigger tiered asset preloads after first paint to avoid blocking initial UI.
function RootApp() {
  useEffect(() => {
    // Defer slightly to let critical React commit finish
    const id = setTimeout(() => {
      try { schedulePreloads(); } catch (e) { /* noop */ }
    }, 50);
    return () => clearTimeout(id);
  }, []);
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
