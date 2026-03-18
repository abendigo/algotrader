/**
 * StreamManager — single OANDA streaming connection shared across all strategies.
 *
 * Maintains one price stream with the union of all strategies' instrument sets.
 * Reconnects automatically on failure with exponential backoff.
 * Dispatches ticks to registered session callbacks.
 */

import { OandaClient } from "../brokers/oanda/client.js";
import type { Config } from "../core/config.js";
import type { Tick } from "../core/types.js";
export type { Config };

interface StreamListener {
  sessionId: string;
  instruments: Set<string>;
  onTick: (tick: Tick) => void;
}

export class StreamManager {
  private client: OandaClient | null = null;
  private listeners = new Map<string, StreamListener>();
  private stream: { close: () => void } | null = null;
  private currentInstruments = new Set<string>();
  private backoffMs = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickTime = 0;
  private _connected = false;
  private _ticksReceived = 0;
  private closing = false;

  /** Watchdog timeout — reconnect if no tick received within this period */
  private static WATCHDOG_TIMEOUT_MS = 120_000;
  private static MAX_BACKOFF_MS = 60_000;

  /**
   * Set (or update) the OANDA config used for the stream connection.
   * Must be called with a real account ID before the first stream connects.
   */
  setConfig(config: Config): void {
    this.client = new OandaClient(config);
  }

  get connected(): boolean {
    return this._connected;
  }

  get ticksReceived(): number {
    return this._ticksReceived;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Register a session to receive ticks for the given instruments.
   * Triggers a stream restart if the instrument set changes.
   */
  addListener(
    sessionId: string,
    instruments: string[],
    onTick: (tick: Tick) => void,
  ): void {
    this.listeners.set(sessionId, {
      sessionId,
      instruments: new Set(instruments),
      onTick,
    });
    this.updateStream();
  }

  /**
   * Remove a session's listener.
   * Triggers a stream restart if the instrument set changes, or disconnects if no listeners remain.
   */
  removeListener(sessionId: string): void {
    this.listeners.delete(sessionId);
    this.updateStream();
  }

  /** Shut down the stream and all timers. */
  close(): void {
    this.closing = true;
    this.clearTimers();
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
    this._connected = false;
  }

  /** Compute the union of all listeners' instrument sets. */
  private computeInstrumentUnion(): Set<string> {
    const union = new Set<string>();
    for (const listener of this.listeners.values()) {
      for (const inst of listener.instruments) {
        union.add(inst);
      }
    }
    return union;
  }

  /** Check if the instrument set changed and reconnect if needed. */
  private updateStream(): void {
    const needed = this.computeInstrumentUnion();

    if (needed.size === 0) {
      // No listeners — disconnect
      if (this.stream) {
        this.stream.close();
        this.stream = null;
      }
      this.clearTimers();
      this._connected = false;
      this.currentInstruments.clear();
      return;
    }

    // Check if instrument set changed
    const sameSet =
      needed.size === this.currentInstruments.size &&
      [...needed].every((i) => this.currentInstruments.has(i));

    if (sameSet && this.stream) return; // no change needed

    // Instrument set changed — restart stream
    this.currentInstruments = needed;
    this.connect();
  }

  /** Connect (or reconnect) to the OANDA stream. */
  private connect(): void {
    if (this.closing) return;
    if (!this.client) {
      console.error("[StreamManager] Cannot connect: no OANDA config set. Call setConfig() first.");
      return;
    }

    // Close existing stream
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
    this.clearTimers();

    if (this.currentInstruments.size === 0) return;

    const instruments = [...this.currentInstruments];
    console.log(`[StreamManager] Connecting stream for ${instruments.length} instruments: ${instruments.join(", ")}`);

    this.stream = this.client.streamPrices(instruments, (tick: Tick) => {
      this.lastTickTime = Date.now();
      this._ticksReceived++;
      this._connected = true;
      this.backoffMs = 2000; // Reset backoff on successful tick

      // Dispatch to all listeners interested in this instrument
      for (const listener of this.listeners.values()) {
        if (listener.instruments.has(tick.instrument)) {
          listener.onTick(tick);
        }
      }
    });

    this.lastTickTime = Date.now();
    this.startWatchdog();
  }

  /** Reconnect with exponential backoff. */
  private reconnect(): void {
    if (this.closing) return;
    this._connected = false;

    console.log(`[StreamManager] Reconnecting in ${this.backoffMs}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, StreamManager.MAX_BACKOFF_MS);
      this.connect();
    }, this.backoffMs);
  }

  /** Watchdog: triggers reconnect if no tick received within timeout. */
  private startWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);

    this.watchdogTimer = setInterval(() => {
      if (this.closing) return;
      const elapsed = Date.now() - this.lastTickTime;
      if (elapsed > StreamManager.WATCHDOG_TIMEOUT_MS) {
        console.log(`[StreamManager] Watchdog: no tick in ${Math.round(elapsed / 1000)}s, reconnecting...`);
        this.reconnect();
      }
    }, 30_000); // Check every 30s
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
