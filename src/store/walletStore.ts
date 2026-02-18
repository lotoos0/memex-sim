import { create } from 'zustand';
import { SOL_PRICE_USD } from '../tokens/types';

interface WalletState {
  solBalance: number;
  realizedPnlSol: number;

  deductSol: (amount: number) => boolean;   // returns false if insufficient balance
  addSol: (amount: number) => void;
  addPnl: (pnlSol: number) => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  solBalance: 1.0,
  realizedPnlSol: 0,

  deductSol: (amount) => {
    const { solBalance } = get();
    if (solBalance < amount) return false;
    set({ solBalance: solBalance - amount });
    return true;
  },

  addSol: (amount) => set(s => ({ solBalance: s.solBalance + amount })),

  addPnl: (pnlSol) => set(s => ({ realizedPnlSol: s.realizedPnlSol + pnlSol })),
}));

export const solToUsd = (sol: number) => sol * SOL_PRICE_USD;
export const usdToSol = (usd: number) => usd / SOL_PRICE_USD;
