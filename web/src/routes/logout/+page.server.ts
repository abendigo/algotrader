import { redirect } from "@sveltejs/kit";
import { logout } from "$lib/server/auth.js";

export function load({ cookies }) {
  const token = cookies.get("session");
  if (token) {
    logout(token);
    cookies.delete("session", { path: "/" });
  }
  throw redirect(303, "/");
}
