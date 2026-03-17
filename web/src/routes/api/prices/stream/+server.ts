import { getOandaConfig } from "$lib/server/oanda.js";

const INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
];

export function GET() {
  const config = getOandaConfig();
  const streamUrl = config.baseUrl.replace("api-", "stream-");
  const url = `${streamUrl}/v3/accounts/${config.accountId}/pricing/stream?instruments=${INSTRUMENTS.join(",")}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        });

        if (!res.ok || !res.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `OANDA stream error ${res.status}` })}\n\n`));
          controller.close();
          return;
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
                const tick = {
                  instrument: msg.instrument,
                  timestamp: new Date(msg.time).getTime(),
                  bid: parseFloat(msg.bids[0].price),
                  ask: parseFloat(msg.asks[0].price),
                  spread: parseFloat(msg.asks[0].price) - parseFloat(msg.bids[0].price),
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(tick)}\n\n`));
              }
            } catch {
              // skip heartbeats
            }
          }
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
