import type { PublicUser } from "$lib/server/auth.js";

declare global {
	const __GIT_SHA__: string;

	namespace App {
		interface Locals {
			user: PublicUser | null;
		}
	}
}

export {};
