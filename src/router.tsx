import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/layout/Header';
import SubHeaderBar from './components/layout/SubHeaderBar';
import PulsePage from './pages/PulsePage';
import TokenPage from './pages/TokenPage';
import ErrorBoundary from './components/layout/ErrorBoundary';
import { registry } from './tokens/registry';

function AppShell() {
  useEffect(() => {
    registry.start();
    return () => registry.stop();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-ax-bg text-ax-text overflow-hidden">
      <Header />
      <SubHeaderBar />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <Routes>
          <Route path="/" element={<PulsePage />} />
          <Route path="/token/:id" element={<TokenPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function Router() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
