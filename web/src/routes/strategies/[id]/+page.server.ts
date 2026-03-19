import { redirect } from "@sveltejs/kit";

export function load({ params }) {
  throw redirect(303, `/strategies/${params.id}/editor`);
}
