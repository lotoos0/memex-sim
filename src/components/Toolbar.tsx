import { useTradingStore } from '../store/tradingStore';

export default function Toolbar() {
  const resetView = useTradingStore(s => s.resetView);
  return (
    <div className="toolcol">
      <button title="Reset view (R)" onClick={resetView}>⤢</button>
      <button title="Crosshair">✚</button>
      <button title="Measure">📏</button>
      <button title="Pan">✥</button>
    </div>
  );
}
