import { handleResendWebhook } from "@/lib/email/webhook";

export const dynamic = "force-dynamic";

/** Resend delivery events (spec 0006, AC-8): signature checked, status moved forward by rank. */
export async function POST(request: Request): Promise<Response> {
  return handleResendWebhook(request);
}
