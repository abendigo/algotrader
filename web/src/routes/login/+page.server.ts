import { fail, redirect } from "@sveltejs/kit";
import { login } from "$lib/server/auth.js";

export const actions = {
  default: async ({ request, cookies }) => {
    const formData = await request.formData();
    const email = formData.get("email")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";

    if (!email || !password) {
      return fail(400, { error: "Email and password are required", email });
    }

    const result = await login(email, password);
    if (!result.success) {
      return fail(400, { error: result.error, email });
    }

    cookies.set("session", result.token!, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
    });

    throw redirect(303, "/dashboard");
  },
};
