import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/layout/Header';
import SubHeaderBar from './components/layout/SubHeaderBar';
import PulsePage from './pages/PulsePage';
import TokenPage from './pages/TokenPage';
import ErrorBoundary from './components/layout/ErrorBoundary';
import {
  engineVersion, exportRecording, registry, switchEngine, useRecordingExport,
  useRecordingExportMessage, useRecordingSaving, useSimulationFault,
} from './tokens/sessionBinding';

function AppShell() {
  const [paused, setPaused] = useState(false);
  const fault = useSimulationFault();
  const saving = useRecordingSaving();
  const canExport = useRecordingExport();
  const exportMessage = useRecordingExportMessage();
  useEffect(() => {
    registry.start();
    return () => registry.stop();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-ax-bg text-ax-text overflow-hidden">
      <Header />
      <div className="flex justify-end gap-3 px-4 py-1 text-xs text-ax-text-dim">
        <span>Engine {engineVersion.toUpperCase()}</span>
        {fault && <span role="alert" className="text-ax-red">Simulation stopped. {fault} Saved history is retained.</span>}
        {saving && <span role="status">Saving V2 session…</span>}
        {exportMessage && <span role="status">{exportMessage}</span>}
        {canExport && (
          <button type="button" onClick={exportRecording} className="text-ax-green">Export V2 recording</button>
        )}
        {engineVersion === 'v2' && !fault && (
          <button type="button" className="text-ax-green" onClick={() => {
            if (paused) registry.start();
            else registry.stop();
            setPaused(!paused);
          }}>
            {paused ? 'Resume simulation' : 'Pause simulation'}
          </button>
        )}
        <button type="button" onClick={switchEngine} className="text-ax-green">
          {engineVersion === 'v1' ? 'Open V2 session' : 'Switch to V1'}
        </button>
      </div>
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
