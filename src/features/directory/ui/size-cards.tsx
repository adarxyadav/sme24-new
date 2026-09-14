import { Building2Icon, ContactIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import type { DirectorySize } from "@/features/directory/queries";

type Props = {
  readonly size: DirectorySize;
};

/**
 * The size of the directory as two figures above the search form (spec 0018, AC-5): how many
 * companies and how many contacts a search runs against, so the reader knows the reach before
 * they type. Live counts from `directory_size`, never a stored or written figure, and formatted
 * on the server: an ICU grouped figure renders a different apostrophe on Node than in the
 * browser, which would break hydration inside a client component. Deliberately not a `dl`: a
 * description list wants its `dt` and `dd` as direct children of the list or of one `div`, and
 * the card's own wrapper puts them two levels down, which axe reads as orphaned. Server component.
 */
export async function DirectorySizeCards({ size }: Props) {
  const [t, format] = await Promise.all([getTranslations("directory.size"), getFormatter()]);
  const figures = [
    { key: "companies", value: size.companies, icon: Building2Icon },
    { key: "contacts", value: size.contacts, icon: ContactIcon },
  ] as const;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {figures.map(({ key, value, icon: Icon }) => (
        <Card key={key}>
          <CardContent className="flex items-center gap-4">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground"
              aria-hidden="true"
            >
              <Icon className="size-5" />
            </span>
            <p className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-sm">{t(key)}</span>
              <span className="font-semibold text-2xl tabular-nums tracking-headline">
                {format.number(value)}
              </span>
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
