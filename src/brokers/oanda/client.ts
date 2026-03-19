import type { Config } from "../../core/config.js";
import type {
  Candle,
  Granularity,
  Instrument,
  Tick,
} from "../../core/types.js";

/** Low-level OANDA v20 REST API client */
export class OandaClient {
  private baseUrl: string;
  private accountId: string;
  private headers: Record<string, string>;

  constructor(config: Config) {
    this.baseUrl = config.OANDA_BASE_URL;
    this.accountId = config.OANDA_ACCOUNT_ID;
    this.headers = {
      Authorization: `Bearer ${config.OANDA_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: { ...this.headers, ...init?.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OANDA API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async getAccountSummary() {
    return this.request<OandaAccountSummary>(
      `/v3/accounts/${this.accountId}/summary`,
    );
  }

  async getOpenPositions() {
    return this.request<OandaPositionsResponse>(
      `/v3/accounts/${this.accountId}/openPositions`,
    );
  }

  async getCandles(
    instrument: Instrument,
    granularity: Granularity,
    count: number,
  ): Promise<Candle[]> {
    const params = new URLSearchParams({
      granularity,
      count: String(count),
      price: "M", // midpoint
    });

    const data = await this.request<OandaCandlesResponse>(
      `/v3/instruments/${instrument}/candles?${params}`,
    );

    return data.candles
      .filter((c) => c.complete)
      .map(parseCandle);
  }

  async getCandlesByRange(
    instrument: Instrument,
    granularity: Granularity,
    from: Date,
    to: Date,
  ): Promise<Candle[]> {
    const params = new URLSearchParams({
      granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      price: "M",
    });

    const data = await this.request<OandaCandlesResponse>(
      `/v3/instruments/${instrument}/candles?${params}`,
    );

    return data.candles
      .filter((c) => c.complete)
      .map(parseCandle);
  }

  async getPrice(instrument: Instrument): Promise<Tick> {
    const data = await this.request<OandaPricingResponse>(
      `/v3/accounts/${this.accountId}/pricing?instruments=${instrument}`,
    );

    const price = data.prices[0];
    return {
      instrument: price.instrument,
      timestamp: new Date(price.time).getTime(),
      bid: parseFloat(price.bids[0].price),
      ask: parseFloat(price.asks[0].price),
    };
  }

  async createOrder(body: object) {
    return this.request<OandaOrderResponse>(
      `/v3/accounts/${this.accountId}/orders`,
      {
        method: "POST",
        body: JSON.stringify({ order: body }),
      },
    );
  }

  async closePosition(instrument: Instrument, longUnits?: string, shortUnits?: string) {
    const body: Record<string, string> = {};
    if (longUnits) body.longUnits = longUnits;
    if (shortUnits) body.shortUnits = shortUnits;

    return this.request<OandaClosePositionResponse>(
      `/v3/accounts/${this.accountId}/positions/${instrument}/close`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
  }

  streamPrices(
    instruments: Instrument[],
    onTick: (tick: Tick) => void,
  ): { close: () => void } {
    const streamUrl = this.baseUrl.replace("api-", "stream-");
    const url = `${streamUrl}/v3/accounts/${this.accountId}/pricing/stream?instruments=${instruments.join(",")}`;

    const controller = new AbortController();

    (async () => {
      const res = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`OANDA stream error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "PRICE") {
              onTick({
                instrument: msg.instrument,
                timestamp: new Date(msg.time).getTime(),
                bid: parseFloat(msg.bids[0].price),
                ask: parseFloat(msg.asks[0].price),
              });
            }
          } catch {
            // skip heartbeats and malformed lines
          }
        }
      }
    })().catch((err) => {
      if (err.name !== "AbortError") {
        console.error("OANDA stream error:", err);
      }
    });

    return { close: () => controller.abort() };
  }
}

// --- OANDA response types ---

function parseCandle(c: OandaCandle): Candle {
  return {
    timestamp: new Date(c.time).getTime(),
    open: parseFloat(c.mid.o),
    high: parseFloat(c.mid.h),
    low: parseFloat(c.mid.l),
    close: parseFloat(c.mid.c),
    volume: c.volume,
  };
}

interface OandaCandle {
  time: string;
  mid: { o: string; h: string; l: string; c: string };
  volume: number;
  complete: boolean;
}

interface OandaCandlesResponse {
  candles: OandaCandle[];
}

interface OandaPricingResponse {
  prices: Array<{
    instrument: string;
    time: string;
    bids: Array<{ price: string }>;
    asks: Array<{ price: string }>;
  }>;
}

interface OandaAccountSummary {
  account: {
    balance: string;
    unrealizedPL: string;
    currency: string;
    openPositionCount: number;
    hedgingEnabled?: boolean;
  };
}

interface OandaPositionsResponse {
  positions: Array<{
    instrument: string;
    long: { units: string; averagePrice: string; unrealizedPL: string };
    short: { units: string; averagePrice: string; unrealizedPL: string };
  }>;
}

interface OandaFillTransaction {
  id: string;
  instrument: string;
  units: string;
  price: string;
  time: string;
  pl?: string;
  financing?: string;
  accountBalance?: string;
}

interface OandaOrderResponse {
  orderFillTransaction?: OandaFillTransaction;
}

interface OandaClosePositionResponse {
  longOrderFillTransaction?: OandaFillTransaction;
  shortOrderFillTransaction?: OandaFillTransaction;
}
