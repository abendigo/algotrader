import { redirect, type Handle } from "@sveltejs/kit";
import { validateSession } from "$lib/server/auth.js";

const PUBLIC_PATHS = ["/", "/login", "/register", "/logout"];

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get("session");
  const user = validateSession(token);

  event.locals.user = user
    ? {
        id: user.id,
        email: user.email,
        role: user.role,
        hasApiKey: !!user.oandaApiKey,
      }
    : null;

  const isPublic = PUBLIC_PATHS.some(
    (p) => event.url.pathname === p || event.url.pathname.startsWith("/api/auth/"),
  );

  if (!isPublic && !user) {
    throw redirect(303, "/login");
  }

  // Admin routes require admin role
  if (event.url.pathname.startsWith("/admin") && user?.role !== "admin") {
    throw redirect(303, "/dashboard");
  }

  return resolve(event);
};
