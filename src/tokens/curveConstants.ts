import { SOL_PRICE_USD } from './types';

// Token quantities are whole tokens (six decimals on the reference curve).
// Quote reserves use the simulator's fixed USD conversion.
export const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000;
export const INITIAL_VIRTUAL_SOL_RESERVES = 30;
export const INITIAL_VIRTUAL_BASE_USD = INITIAL_VIRTUAL_SOL_RESERVES * SOL_PRICE_USD;
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000;
export const CURVE_FEE_BPS = 125;
