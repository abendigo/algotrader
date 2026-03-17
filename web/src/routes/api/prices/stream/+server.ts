import type { RequestHandler } from "./$types.js";
import { getApiKey, discoverAccounts } from "$lib/server/auth.js";

const INSTRUMENTS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CAD", "USD_CHF", "AUD_USD", "NZD_USD",
];

export const GET: RequestHandler = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey = getApiKey(user.id);
  if (!apiKey) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "No OANDA API key configured" })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  // Find any accessible account to use for the price stream
  const { accounts } = await discoverAccounts(apiKey);
  if (accounts.length === 0) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "No accessible OANDA accounts" })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  const accountId = accounts[0].id;
  const baseUrl = "https://api-fxpractice.oanda.com";
  const streamUrl = baseUrl.replace("api-", "stream-");
  const url = `${streamUrl}/v3/accounts/${accountId}/pricing/stream?instruments=${INSTRUMENTS.join(",")}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
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
};
