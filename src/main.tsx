import { createRoot } from 'react-dom/client';
import Router from './router';
import './styles.css';

// Registry is now started inside AppShell useEffect (safer lifecycle)
createRoot(document.getElementById('root')!).render(<Router />);
