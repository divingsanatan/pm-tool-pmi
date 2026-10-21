import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { StoreProvider } from './store/StoreContext';
import { UIProvider } from './components/UI';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreProvider>
      <UIProvider>
        <App />
      </UIProvider>
    </StoreProvider>
  </StrictMode>
);
