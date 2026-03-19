/**
 * Server-side event bus for broadcasting real-time updates to SSE clients.
 *
 * Channels:
 *   - backtest:{userId}  — backtest progress and completion
 *   - collect            — data collection job progress
 *   - live:{userId}      — live/paper trading session updates
 */

type Listener = (data: unknown) => void;

class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(channel: string, listener: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(listener);
    return () => {
      this.listeners.get(channel)?.delete(listener);
      if (this.listeners.get(channel)?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  emit(channel: string, data: unknown): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch { /* don't let one listener break others */ }
    }
  }

  /** Check if any clients are listening on a channel */
  hasListeners(channel: string): boolean {
    return (this.listeners.get(channel)?.size ?? 0) > 0;
  }
}

export const eventBus = new EventBus();
