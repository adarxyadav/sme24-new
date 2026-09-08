import { AreaShell } from "@/components/shell/area-shell";
import { requireOnboardedExpert } from "@/features/experts/gate";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

/**
 * The `(shell)` group holds every expert page but `/expert/onboarding`, which renders in the auth
 * frame. The gate runs here rather than per page (spec 0013, AC-4), so a page added later inherits
 * it; it is a render concern only, and every expert action re checks the caller for itself.
 */
export default async function ExpertLayout({ children }: LayoutProps<"/[locale]/expert">) {
  await requireOnboardedExpert();
  return <AreaShell area="expert">{children}</AreaShell>;
}
