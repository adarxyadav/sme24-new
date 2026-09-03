import { AreaShell } from "@/components/area-shell";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

export default function ExpertLayout({ children }: LayoutProps<"/[locale]/expert">) {
  return <AreaShell area="expert">{children}</AreaShell>;
}
