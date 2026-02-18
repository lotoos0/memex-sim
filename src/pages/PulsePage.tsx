import { useMemo } from 'react';
import { useTokenStore } from '../store/tokenStore';
import TokenColumn from '../components/pulse/TokenColumn';

export default function PulsePage() {
  const tokensById = useTokenStore(s => s.tokensById);

  const { newPairs, finalStretch, migrated, rugged } = useMemo(() => {
    const all = Object.values(tokensById);
    const byMcapDesc = (a: (typeof all)[number], b: (typeof all)[number]) => b.mcapUsd - a.mcapUsd;
    return {
      newPairs: all.filter(t => t.phase === 'NEW').sort(byMcapDesc),
      finalStretch: all.filter(t => t.phase === 'FINAL').sort(byMcapDesc),
      migrated: all.filter(t => t.phase === 'MIGRATED').sort(byMcapDesc),
      rugged: all.filter(t => t.phase === 'RUGGED').sort(byMcapDesc),
    };
  }, [tokensById]);

  // Rugged tokens show in their natural column (NEW/FINAL) based on mcap
  const newWithRugged    = [...newPairs,    ...rugged.filter(t => t.mcapUsd < 30_000)];
  const finalWithRugged  = [...finalStretch, ...rugged.filter(t => t.mcapUsd >= 30_000)];

  return (
    <div className="flex flex-1 overflow-hidden">
      <TokenColumn
        title="New Pairs"
        tokens={newWithRugged}
        accent="#00d4a1"
      />
      <TokenColumn
        title="Final Stretch"
        tokens={finalWithRugged}
        accent="#f5c542"
      />
      <TokenColumn
        title="Migrated"
        tokens={migrated}
        accent="#6c63ff"
      />
    </div>
  );
}
