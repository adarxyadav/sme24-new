"use client";

import { AlertCircleIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { type MyRequest, myDataRequests, requestData } from "@/features/legal/actions";
import type { DataRequestKind } from "@/features/legal/schema";
import { useFormAction } from "@/hooks/use-form-action";

/** What the card knows about the viewer: still asking, signed out, or their rows. */
type State =
  | { readonly phase: "loading" }
  | { readonly phase: "anonymous" }
  | { readonly phase: "ready"; readonly rows: readonly MyRequest[] }
  | { readonly phase: "failed" };

/**
 * The data rights card on the cookies page (spec 0015, AC-11): a signed in person files an export
 * or a deletion request for themselves and sees the kind, status and answer deadline of the ones
 * they already filed.
 *
 * It lives on `/cookies` rather than on a route of its own, so a person meets it on the page that
 * is already about their data, reachable from every footer in both languages. That page is
 * statically prerendered (AC-5), so the card must never make it dynamic: it asks a server action
 * for its own state after mount instead of the page reading `cookies()`, exactly as the consent
 * control beside it does. A signed out visitor sees nothing but the explanatory line, because
 * there is no request to make without an account.
 *
 * A second open request of the same kind is refused by the database's own guard, and the typed
 * `already_open` becomes an ordinary sentence rather than an error. Browser.
 */
export function DataRequestsCard() {
  const t = useTranslations("legalPages.dataRequests");
  const format = useFormatter();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [open, setOpen] = useState<DataRequestKind | null>(null);
  const action = useFormAction<Awaited<ReturnType<typeof requestData>>, { kind: DataRequestKind }>(
    requestData,
  );

  const load = useCallback(async () => {
    const result = await myDataRequests();
    if (!result.ok) {
      setState({ phase: "failed" });
      return;
    }
    setState(
      result.data.signedIn ? { phase: "ready", rows: result.data.rows } : { phase: "anonymous" },
    );
  }, []);

  // The one effect here is genuine synchronisation rather than success work: the page is static,
  // so nothing was known about the viewer at build time and the card has to ask once it mounts.
  useEffect(() => {
    void load();
  }, [load]);

  const file = async (kind: DataRequestKind) => {
    const result = await action.submit({ kind });
    // The success work belongs here, in the handler that awaited this one dispatch, not in an
    // effect watching `result`: `useActionState` holds its last value for the life of the
    // component, so an effect would announce the same write again on every later render.
    setOpen(null);
    if (result.ok) {
      toast.success(t(`filed.${result.data.kind}`));
      void load();
    } else if (result.error === "already_open") {
      toast.info(t("errors.already_open"));
    } else {
      toast.error(t(`errors.${result.error}`));
    }
  };

  if (state.phase === "loading") {
    return (
      <div className="flex flex-col gap-4 border p-6">
        <p className="max-w-prose text-muted-foreground text-sm">{t("lead")}</p>
        <Skeleton className="h-9 w-64" />
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>{t("errors.unexpected")}</AlertTitle>
      </Alert>
    );
  }

  if (state.phase === "anonymous") {
    return (
      <div className="flex flex-col gap-4 border p-6">
        <p className="max-w-prose text-muted-foreground text-sm">{t("lead")}</p>
        <p className="max-w-prose text-sm">{t("signedOut")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border p-6">
      <p className="max-w-prose text-muted-foreground text-sm">{t("lead")}</p>

      {state.rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{t(`kinds.${row.kind}`)}</span>
              <Badge variant={row.status === "refused" ? "outline" : "secondary"}>
                {t(`status.${row.status}`)}
              </Badge>
              {row.status === "new" || row.status === "in_progress" ? (
                <span className="text-muted-foreground">
                  {t("dueBy", {
                    date: format.dateTime(new Date(row.dueAt), "dateShort"),
                  })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <RequestButton
          kind="export"
          icon={DownloadIcon}
          open={open}
          setOpen={setOpen}
          pending={action.pending}
          onConfirm={file}
        />
        <RequestButton
          kind="deletion"
          icon={Trash2Icon}
          open={open}
          setOpen={setOpen}
          pending={action.pending}
          onConfirm={file}
        />
      </div>
    </div>
  );
}

type RequestButtonProps = {
  readonly kind: DataRequestKind;
  readonly icon: typeof DownloadIcon;
  readonly open: DataRequestKind | null;
  readonly setOpen: (kind: DataRequestKind | null) => void;
  readonly pending: boolean;
  readonly onConfirm: (kind: DataRequestKind) => void;
};

/**
 * One right, behind a confirmation. Both kinds are confirmed rather than only the deletion: an
 * export starts a thirty day clock for a colleague, so neither is a button worth pressing by
 * accident. Browser.
 */
function RequestButton({
  kind,
  icon: Icon,
  open,
  setOpen,
  pending,
  onConfirm,
}: RequestButtonProps) {
  const t = useTranslations("legalPages.dataRequests");

  return (
    <Dialog open={open === kind} onOpenChange={(next) => setOpen(next ? kind : null)}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Icon data-icon="inline-start" />
          {t(`actions.${kind}`)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`confirm.${kind}.title`)}</DialogTitle>
          <DialogDescription>{t(`confirm.${kind}.body`)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("confirm.cancel")}
            </Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={() => onConfirm(kind)}>
            {pending ? t("confirm.filing") : t(`confirm.${kind}.submit`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
