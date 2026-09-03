import { AreaShell } from "@/components/area-shell";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: LayoutProps<"/[locale]/admin">) {
  return <AreaShell area="admin">{children}</AreaShell>;
}
