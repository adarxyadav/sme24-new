"use client";

import { UnlockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell } from "@/components/ui/table";
import { useFormAction } from "@/hooks/use-form-action";
import { Link } from "@/i18n/navigation";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { type RevealContactError, type RevealContactResult, revealContact } from "../actions";
import { useDirectoryBalance } from "./directory-context";

export type UnlockCellProps = {
  readonly contactId: string;
  /** The masked values the server rendered; replaced by the raw ones once revealed. */
  readonly emailMasked: string;
  readonly phoneMasked: string | null;
  readonly mobileMasked: string | null;
  /** True when the caller already paid: the raw values arrive from the server and no button shows. */
  readonly unlocked: boolean;
  readonly email: string | null;
  readonly phone: string | null;
  readonly mobile: string | null;
  /** "1 credit, CHF 1.99", formatted by the server so one ICU build renders every amount. */
  readonly priceLabel: string;
};

type Revealed = {
  readonly email: string;
  readonly phone: string | null;
  readonly mobile: string | null;
};

/**
 * The three cells of one result row that change on an unlock (spec 0018, AC-12): the email, the
 * phones and the control. Rendered as a fragment of table cells so the server component owns
 * the table and this component owns only the state that moves. The revealed values and the new
 * balance are set in the click handler that awaited the action, never in an effect on `result`.
 * Browser.
 */
export function UnlockCell({
  contactId,
  emailMasked,
  phoneMasked,
  mobileMasked,
  unlocked,
  email,
  phone,
  mobile,
  priceLabel,
}: UnlockCellProps) {
  const t = useTranslations("directory.results");
  const locale = resolveLocale(useLocale());
  const { setBalance } = useDirectoryBalance();
  const [revealed, setRevealed] = useState<Revealed | null>(
    unlocked && email ? { email, phone, mobile } : null,
  );
  const [failure, setFailure] = useState<RevealContactError | null>(null);
  const reveal = useFormAction<RevealContactResult, { contactId: string; locale: string }>(
    revealContact,
  );

  async function unlock() {
    setFailure(null);
    const outcome = await reveal.submit({ contactId, locale: LOCALE_CODE[locale] });
    if (!outcome.ok) {
      setFailure(outcome.error);
      return;
    }
    setRevealed({
      email: outcome.data.contact.email,
      phone: outcome.data.contact.phone,
      mobile: outcome.data.contact.mobile,
    });
    setBalance(outcome.data.balance);
  }

  const primaryPhone = revealed
    ? (revealed.phone ?? revealed.mobile)
    : (phoneMasked ?? mobileMasked);
  const secondaryPhone = revealed
    ? revealed.phone && revealed.mobile
      ? revealed.mobile
      : null
    : phoneMasked && mobileMasked
      ? mobileMasked
      : null;

  return (
    <>
      <TableCell className="font-mono text-xs" translate="no">
        {revealed ? revealed.email : emailMasked}
      </TableCell>
      <TableCell className="font-mono text-xs" translate="no">
        <span className="flex flex-col gap-0.5">
          <span>{primaryPhone ?? t("none")}</span>
          {secondaryPhone ? <span className="text-muted-foreground">{secondaryPhone}</span> : null}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {revealed ? (
          <Badge variant="success">{t("unlocked")}</Badge>
        ) : (
          <span className="flex flex-col items-end gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={unlock}
              disabled={reveal.pending}
              aria-busy={reveal.pending || undefined}
            >
              <UnlockIcon aria-hidden="true" data-icon="inline-start" />
              {reveal.pending ? t("unlocking") : t("unlock", { price: priceLabel })}
            </Button>
            {failure ? (
              <span role="alert" className="max-w-56 text-right text-destructive text-xs">
                {failure === "insufficient_credits" ? (
                  <>
                    {t("errors.insufficient_credits")}{" "}
                    <Link href="/expert/directory/credits" className="underline underline-offset-4">
                      {t("errors.buy")}
                    </Link>
                  </>
                ) : (
                  t(`errors.${failure}`)
                )}
              </span>
            ) : null}
          </span>
        )}
      </TableCell>
    </>
  );
}
