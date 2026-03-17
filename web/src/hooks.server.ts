import { redirect, type Handle } from "@sveltejs/kit";
import { validateSession } from "$lib/server/auth.js";

const PUBLIC_PATHS = ["/", "/login", "/register", "/logout"];

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get("session");
  const user = validateSession(token);

  // Attach user to locals for use in pages
  event.locals.user = user ? { id: user.id, email: user.email } : null;

  // Protect non-public routes
  const isPublic = PUBLIC_PATHS.some(
    (p) => event.url.pathname === p || event.url.pathname.startsWith("/api/auth/"),
  );

  if (!isPublic && !user) {
    throw redirect(303, "/login");
  }

  return resolve(event);
};
