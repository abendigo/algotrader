import type { PublicUser } from "$lib/server/auth.js";

declare global {
	namespace App {
		interface Locals {
			user: PublicUser | null;
		}
	}
}

export {};
