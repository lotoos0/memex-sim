import { useStore } from 'zustand';
import { useTokenStore as v1Tokens } from '../store/tokenStore';
import { usePostStore as v1Posts } from '../store/postStore';
import { useTradingStore as v1Trading } from '../store/tradingStore';
import { useWalletStore as v1Wallet } from '../store/walletStore';
import { EngineV2Adapter } from './engineV2Adapter';
import { registry as v1Registry } from './registry';

const selectionKey = 'memex:engine';
const requested = new URLSearchParams(window.location.search).get('engine');
if (requested === 'v1' || requested === 'v2') window.sessionStorage.setItem(selectionKey, requested);

export const engineVersion = window.sessionStorage.getItem(selectionKey) === 'v2' ? 'v2' : 'v1';
const v2 = engineVersion === 'v2' ? new EngineV2Adapter() : null;

export function switchEngine() {
  const target = engineVersion === 'v2' ? 'v1' : 'v2';
  window.location.assign('/?engine=' + target);
}

export function displayNowMs() {
  return v2?.displayNowMs ?? Date.now();
}

export const registry = v2 ?? v1Registry;
export const getCurveDebug = (id: string) => v2
  ? v2.curveDebug(id)
  : v1Registry.getTokenSim(id)?.getCurveDebugSnapshot() ?? null;
export const getMigrationReference = (id: string) => v2
  ? v2.migrationReference(id)
  : v1Registry.getTokenSim(id)?.getMigrationReferenceMcapUsd() ?? null;

// Legacy read selectors share the public field shapes. Their private V1 methods are not used by views.
function bind<S, K extends 'tokens' | 'posts' | 'trading' | 'wallet'>(v1: (select: (state: S) => unknown) => unknown, key: K) {
  return (v2
    ? function useEngineV2<T>(select: (state: S) => T): T {
        return useStore(v2!.store, bundle => select(bundle[key] as unknown as S));
      }
    : v1) as <T>(select: (state: S) => T) => T;
}

export const usePostStore = bind<ReturnType<typeof v1Posts.getState>, 'posts'>(v1Posts, 'posts');
export const useTradingStore = bind<ReturnType<typeof v1Trading.getState>, 'trading'>(v1Trading, 'trading');
export const useWalletStore = bind<ReturnType<typeof v1Wallet.getState>, 'wallet'>(v1Wallet, 'wallet');

export const useTokenStore = bind<ReturnType<typeof v1Tokens.getState>, 'tokens'>(v1Tokens, 'tokens');

export const useSimulationFault = v2
  ? function useEngineV2Fault() { return useStore(v2!.store, state => state.fault); }
  : () => null;

export const useRecordingSaving = v2
  ? function useEngineV2RecordingSaving() { return useStore(v2!.store, state => state.saving); }
  : () => false;

export const useRecordingExport = v2
  ? function useEngineV2RecordingExport() { return useStore(v2!.store, state => state.canExport); }
  : () => false;

export const useRecordingExportMessage = v2
  ? function useEngineV2ExportMessage() { return useStore(v2!.store, state => state.exportMessage); }
  : () => null;

export function exportRecording() { void v2?.exportRecording(); }
