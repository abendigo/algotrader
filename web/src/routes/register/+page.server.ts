import { fail, redirect } from "@sveltejs/kit";
import { register, login } from "$lib/server/auth.js";

export const actions = {
  default: async ({ request, cookies }) => {
    const formData = await request.formData();
    const email = formData.get("email")?.toString() ?? "";
    const password = formData.get("password")?.toString() ?? "";
    const confirm = formData.get("confirm")?.toString() ?? "";

    if (!email || !password) {
      return fail(400, { error: "Email and password are required", email });
    }

    if (password !== confirm) {
      return fail(400, { error: "Passwords do not match", email });
    }

    const result = await register(email, password);
    if (!result.success) {
      return fail(400, { error: result.error, email });
    }

    // Auto-login after registration
    const loginResult = await login(email, password);
    if (loginResult.success && loginResult.token) {
      cookies.set("session", loginResult.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    throw redirect(303, "/dashboard");
  },
};
