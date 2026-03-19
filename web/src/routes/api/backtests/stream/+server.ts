import type { RequestHandler } from "./$types.js";
import { eventBus } from "$lib/server/event-bus.js";

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });

  const userId = locals.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const unsub = eventBus.subscribe(`backtest:${userId}`, (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { unsub(); }
      });

      // Keepalive every 30s
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          unsub();
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(keepalive);
        unsub();
      };

      // Store cleanup for cancel
      (controller as any)._cleanup = cleanup;
    },
    cancel(controller: any) {
      controller?._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
};
