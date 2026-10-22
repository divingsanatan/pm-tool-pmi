import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import CloudGate from './components/CloudGate';
import { UIProvider } from './components/UI';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CloudGate>
      <UIProvider>
        <App />
      </UIProvider>
    </CloudGate>
  </StrictMode>
);
