"use client";

import { useSearchParams } from "next/navigation";
import { ENQUIRY_TOPICS, type EnquiryTopic } from "@/features/marketing/schema";
import { EnquiryForm, type EnquiryFormProps } from "./enquiry-form";

/**
 * Reads the `topic` query parameter on the client (spec 0009, AC-8): the pricing page links to
 * `/contact?topic=retainer`, and the page stays prerendered because the read happens inside a
 * `Suspense` boundary whose fallback is the complete form with `general` selected. Browser.
 */
export function EnquiryFormFromQuery(props: Omit<EnquiryFormProps, "defaultTopic">) {
  const topic = useSearchParams().get("topic");
  return <EnquiryForm {...props} defaultTopic={isTopic(topic) ? topic : "general"} />;
}

function isTopic(value: string | null): value is EnquiryTopic {
  return value !== null && (ENQUIRY_TOPICS as readonly string[]).includes(value);
}
