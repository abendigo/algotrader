import type { Broker } from "../../core/broker.js";
import type {
  AccountSummary,
  Candle,
  Granularity,
  Instrument,
  OrderRequest,
  OrderResult,
  Position,
  Tick,
} from "../../core/types.js";
import { OandaClient } from "./client.js";
import type { Config } from "../../core/config.js";

export class OandaBroker implements Broker {
  readonly name = "OANDA";
  private client: OandaClient;

  constructor(config: Config) {
    this.client = new OandaClient(config);
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const data = await this.client.getAccountSummary();
    const acct = data.account;
    return {
      balance: parseFloat(acct.balance),
      unrealizedPL: parseFloat(acct.unrealizedPL),
      currency: acct.currency,
      openPositions: acct.openPositionCount,
    };
  }

  async getPositions(): Promise<Position[]> {
    const data = await this.client.getOpenPositions();
    const positions: Position[] = [];

    for (const p of data.positions) {
      const longUnits = parseFloat(p.long.units);
      const shortUnits = parseFloat(p.short.units);

      if (longUnits > 0) {
        positions.push({
          instrument: p.instrument,
          side: "buy",
          units: longUnits,
          averagePrice: parseFloat(p.long.averagePrice),
          unrealizedPL: parseFloat(p.long.unrealizedPL),
        });
      }

      if (shortUnits < 0) {
        positions.push({
          instrument: p.instrument,
          side: "sell",
          units: Math.abs(shortUnits),
          averagePrice: parseFloat(p.short.averagePrice),
          unrealizedPL: parseFloat(p.short.unrealizedPL),
        });
      }
    }

    return positions;
  }

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    const oandaOrder: Record<string, string> = {
      instrument: order.instrument,
      units: String(order.side === "sell" ? -order.units : order.units),
      type: order.type.toUpperCase(),
      timeInForce: order.type === "market" ? "FOK" : "GTC",
    };

    if (order.price !== undefined) {
      oandaOrder.price = String(order.price);
    }

    const data = await this.client.createOrder(oandaOrder);
    const fill = data.orderFillTransaction;

    if (!fill) {
      throw new Error("Order was not filled");
    }

    return {
      id: fill.id,
      instrument: fill.instrument,
      side: parseFloat(fill.units) > 0 ? "buy" : "sell",
      units: Math.abs(parseFloat(fill.units)),
      filledPrice: parseFloat(fill.price),
      timestamp: new Date(fill.time).getTime(),
    };
  }

  async closePosition(instrument: Instrument): Promise<OrderResult> {
    const positions = await this.getPositions();
    const pos = positions.find((p) => p.instrument === instrument);

    if (!pos) {
      throw new Error(`No open position for ${instrument}`);
    }

    const data = await this.client.closePosition(
      instrument,
      pos.side === "buy" ? "ALL" : undefined,
      pos.side === "sell" ? "ALL" : undefined,
    );

    const fill =
      data.longOrderFillTransaction || data.shortOrderFillTransaction;

    if (!fill) {
      throw new Error("Position close was not filled");
    }

    return {
      id: fill.id,
      instrument: fill.instrument,
      side: parseFloat(fill.units) > 0 ? "buy" : "sell",
      units: Math.abs(parseFloat(fill.units)),
      filledPrice: parseFloat(fill.price),
      timestamp: new Date(fill.time).getTime(),
    };
  }

  async getCandles(
    instrument: Instrument,
    granularity: Granularity,
    count: number,
  ): Promise<Candle[]> {
    return this.client.getCandles(instrument, granularity, count);
  }

  async getCandlesByRange(
    instrument: Instrument,
    granularity: Granularity,
    from: Date,
    to: Date,
  ): Promise<Candle[]> {
    return this.client.getCandlesByRange(instrument, granularity, from, to);
  }

  async getPrice(instrument: Instrument): Promise<Tick> {
    return this.client.getPrice(instrument);
  }

  async streamPrices(
    instruments: Instrument[],
    onTick: (tick: Tick) => void,
  ): Promise<{ close: () => void }> {
    return this.client.streamPrices(instruments, onTick);
  }
}
