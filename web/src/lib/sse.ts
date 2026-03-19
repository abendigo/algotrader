/**
 * Client-side SSE helper with auto-reconnect.
 *
 * Usage:
 *   onMount(() => {
 *     return connectSSE("/api/live/stream", (data) => { sessions = data.sessions; });
 *   });
 */

export function connectSSE(
  url: string,
  onMessage: (data: any) => void,
  options?: { onError?: (err: Event) => void },
): () => void {
  let es: EventSource | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  function connect() {
    if (stopped) return;
    es = new EventSource(url);

    es.onopen = () => {
      attempt = 0; // reset backoff on successful connection
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch { /* ignore malformed messages */ }
    };

    es.onerror = (err) => {
      options?.onError?.(err);
      es?.close();
      es = null;
      if (stopped) return;
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      attempt++;
      reconnectTimeout = setTimeout(connect, delay);
    };
  }

  connect();

  // Return cleanup function
  return () => {
    stopped = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    es?.close();
    es = null;
  };
}
