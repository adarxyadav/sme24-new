import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Who bought an order, for the alerts and the ops list (spec 0018, AC-10). An order carries one
 * of two buyer shapes (spec 0011's client organization, or the expert of a credit pack), and
 * every place that used to read `organizations.name` by `organization_id` now goes through this
 * one helper, so an expert order never reads as "Unknown organization". Server only: it takes
 * the service client of a task or an authorised action.
 */

type Service = SupabaseClient<Database>;

export type BuyerShape = {
  readonly organization_id: string | null;
  readonly buyer_expert_id: string | null;
};

/** The label of a buyer with no name on file. */
export const UNKNOWN_ORGANIZATION = "Unknown organization";
export const EXPERT_BUYER_PREFIX = "Expert: ";
export const UNNAMED_EXPERT = "Expert";

/**
 * `organizations.name` for a client order, `'Expert: ' || profiles.full_name` for an expert order
 * (falling back to `'Expert'` when the profile has no name). Server only (service client).
 */
export async function buyerLabel(service: Service, order: BuyerShape): Promise<string> {
  if (order.buyer_expert_id) {
    const { data } = await service
      .from("profiles")
      .select("full_name")
      .eq("id", order.buyer_expert_id)
      .maybeSingle();
    const name = data?.full_name?.trim();
    return name ? `${EXPERT_BUYER_PREFIX}${name}` : UNNAMED_EXPERT;
  }
  if (order.organization_id) {
    const { data } = await service
      .from("organizations")
      .select("name")
      .eq("id", order.organization_id)
      .maybeSingle();
    return data?.name ?? UNKNOWN_ORGANIZATION;
  }
  return UNKNOWN_ORGANIZATION;
}

/** True for a credit pack order: an expert buyer with frozen credits. Pure. */
export function isCreditOrder(order: BuyerShape & { readonly credits: number | null }): boolean {
  return order.buyer_expert_id !== null && order.credits !== null;
}
