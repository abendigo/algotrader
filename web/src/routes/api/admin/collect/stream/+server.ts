import type { RequestHandler } from "./$types.js";
import { eventBus } from "$lib/server/event-bus.js";

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user || locals.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const unsub = eventBus.subscribe("collect", (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { unsub(); }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          unsub();
        }
      }, 30_000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        unsub();
      };
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
