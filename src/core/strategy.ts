import type { Broker } from "./broker.js";
import type { Tick } from "./types.js";

/** Context passed to a strategy on each tick */
export interface StrategyContext {
  broker: Broker;
}

/** Abstract strategy interface */
export interface Strategy {
  readonly name: string;

  /** Called once when the strategy starts */
  init(ctx: StrategyContext): Promise<void>;

  /** Called on each price tick */
  onTick(ctx: StrategyContext, tick: Tick): Promise<void>;

  /** Called when the strategy is stopped */
  dispose(): Promise<void>;
}
