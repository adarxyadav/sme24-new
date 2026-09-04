import { AreaShell } from "@/components/shell/area-shell";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: LayoutProps<"/[locale]/app">) {
  return <AreaShell area="app">{children}</AreaShell>;
}
