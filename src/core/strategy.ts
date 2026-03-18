import type { Broker } from "./broker.js";
import type { Tick, Granularity, Position } from "./types.js";

/** Context passed to a strategy on each tick */
export interface StrategyContext {
  broker: Broker;
  /** True during candle replay (backfill recovery) — skip order placement */
  backfilling?: boolean;
}

/** Recovery mode configuration for live trading */
export type RecoveryConfig =
  | { mode: "clean" }
  | { mode: "backfill"; lookback: number; granularity: Granularity }
  | { mode: "checkpoint" }
  | { mode: "custom" };

/**
 * Whether the strategy requires, forbids, or allows hedging accounts.
 * - "required" — needs hedging (simultaneous long/short on same instrument)
 * - "forbidden" — assumes netting (one position per instrument)
 * - "allowed" — works either way
 */
export type HedgingMode = "required" | "forbidden" | "allowed";

/** A single indicator row for display on the live page */
export interface StrategyIndicator {
  label: string;
  instrument?: string;
  value: string;
  signal?: "buy" | "sell" | "neutral" | "warn";
}

/** A strategy position for display */
export interface StrategyPosition {
  instrument: string;
  side: "buy" | "sell";
  entryPrice: number;
  pnl?: number;
  detail?: string;
}

/** Generic state snapshot returned by getState() for live display */
export interface StrategyStateSnapshot {
  phase: string;
  detail?: string;
  indicators: StrategyIndicator[];
  positions: StrategyPosition[];
}

/** Abstract strategy interface */
export interface Strategy {
  readonly name: string;
  readonly hedging: HedgingMode;

  /** Instruments this strategy needs streamed. If absent, the runner uses a default set. */
  readonly instruments?: readonly string[];

  /** Called once when the strategy starts */
  init(ctx: StrategyContext): Promise<void>;

  /** Called on each price tick */
  onTick(ctx: StrategyContext, tick: Tick): Promise<void>;

  /** Called when the strategy is stopped */
  dispose(): Promise<void>;

  /** Return current strategy state for live monitoring */
  getState(): StrategyStateSnapshot;

  /** For "checkpoint" recovery: return serializable state */
  checkpoint?(): unknown;

  /** For "checkpoint" recovery: restore from serialized state */
  restore?(state: unknown): void;

  /** For "custom" recovery: strategy handles its own recovery */
  recover?(ctx: StrategyContext, positions: Position[]): Promise<void>;
}
