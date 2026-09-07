"use client";

import { SearchXIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  approvePeer,
  type PeerActionResult,
  rejectPeer,
  rerunPeer,
  researchPeers,
  retirePeer,
} from "@/features/peers/actions";
import { isPeerStatus, type PeerStatus } from "@/features/peers/catalogue";
import type { PeerAdminRow } from "@/features/peers/queries";
import { ALL, type PeerFilters } from "@/features/peers/schema";
import { websiteHost } from "@/features/research/schema";
import { isRunStatus, RunStatusBadge } from "@/features/research/ui/badges";
import { Link } from "@/i18n/navigation";

export type PeersTableProps = {
  readonly rows: readonly PeerAdminRow[];
  readonly filters: PeerFilters;
};

const STATUS_VARIANT: Record<PeerStatus, "outline" | "success" | "secondary" | "warning"> = {
  proposed: "outline",
  approved: "success",
  rejected: "secondary",
  retired: "warning",
};

/**
 * The peer list of `/admin/peers` (spec 0012, AC-2 to AC-4, AC-14): one row per peer with its
 * company, set, status, label, KPI count and refresh state; a checkbox per approved peer feeds
 * the research batch, which asks for an explicit confirm naming the peers and the number of runs
 * before anything starts; per row approve, reject (with a reason), retire and rerun. Every
 * action refreshes the page so the server renders the new state. Browser; the page hands it the
 * `peers`, `benchmark` and `research` messages.
 */
export function PeersTable({ rows, filters }: PeersTableProps) {
  const t = useTranslations("peers");
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const locale = useLocale();
  const filtered = filters.section !== ALL || filters.sizeBand !== ALL || filters.status !== ALL;
  const selectable = rows.filter((row) => row.status === "approved" && row.openRun === null);
  const chosen = selectable.filter((row) => selected.has(row.id));

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const research = () =>
    startTransition(async () => {
      const result = await researchPeers(null, { peerIds: chosen.map((row) => row.id), locale });
      setConfirming(false);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      const skipped = result.data.skipped.map((skip) => {
        const row = rows.find((entry) => entry.id === skip.peerId);
        return `${row?.company.name ?? skip.peerId} (${t(`research.skipReasons.${skip.reason}`)})`;
      });
      toast.success(
        [
          t("research.started", { triggered: result.data.triggered, skipped: skipped.length }),
          skipped.length > 0 ? t("research.skipped", { list: skipped.join(", ") }) : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setSelected(new Set());
      router.refresh();
    });

  return (
    <section
      aria-labelledby="peers-heading"
      className="flex flex-col gap-3"
      data-peers={rows.length}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="peers-heading" className="font-semibold text-lg">
          {t("table.heading")}{" "}
          <span className="font-normal text-muted-foreground text-sm">
            {t("table.count", { count: rows.length })}
          </span>
        </h2>
        <Button
          type="button"
          disabled={chosen.length === 0 || pending}
          onClick={() => setConfirming(true)}
          data-research-selected
        >
          {t("research.selected", { count: chosen.length })}
        </Button>
      </div>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title={t("noResults.title")}
            description={t("noResults.description")}
            action={
              <Button asChild variant="outline">
                <Link href="/admin/peers">{t("filters.reset")}</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={UsersIcon}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">{t("columns.select")}</span>
                </TableHead>
                <TableHead>{t("columns.company")}</TableHead>
                <TableHead>{t("columns.set")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.label")}</TableHead>
                <TableHead className="text-right">{t("columns.kpis")}</TableHead>
                <TableHead>{t("columns.researched")}</TableHead>
                <TableHead>{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <PeerRow
                  key={row.id}
                  row={row}
                  selectable={selectable.includes(row)}
                  selected={selected.has(row.id)}
                  onToggle={(checked) => toggle(row.id, checked)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent data-research-dialog>
          <DialogHeader>
            <DialogTitle>{t("research.dialogTitle", { count: chosen.length })}</DialogTitle>
            <DialogDescription>{t("research.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto text-sm">
            {chosen.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3">
                <span>{row.company.name}</span>
                <span className="text-muted-foreground text-xs">{row.display_label}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t("research.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={research}
              disabled={pending || chosen.length === 0}
              data-research-confirm
            >
              {t("research.confirm", { count: chosen.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type PeerRowProps = {
  readonly row: PeerAdminRow;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly onToggle: (checked: boolean) => void;
};

function PeerRow({ row, selectable, selected, onToggle }: PeerRowProps) {
  const t = useTranslations("peers");
  const b = useTranslations("benchmark");
  const format = useFormatter();
  const status = isPeerStatus(row.status) ? row.status : "proposed";
  const host = websiteHost(row.company.website);
  const proposal = row.proposal as { reason?: unknown } | null;
  const reason = typeof proposal?.reason === "string" ? proposal.reason : null;
  const band = row.size_band as "all";
  const checkboxId = `select-peer-${row.id}`;

  return (
    <TableRow
      data-peer-id={row.id}
      data-peer-status={status}
      data-peer-label={row.display_label ?? ""}
    >
      <TableCell>
        {selectable ? (
          <>
            <Checkbox
              id={checkboxId}
              checked={selected}
              onCheckedChange={(checked) => onToggle(checked === true)}
              aria-label={`${t("columns.select")}: ${row.company.name}`}
            />
            <label htmlFor={checkboxId} className="sr-only">
              {row.company.name}
            </label>
          </>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.company.name}</span>
          {row.company.legal_name || host ? (
            <span className="text-muted-foreground text-xs">
              {[row.company.legal_name, host].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          {reason ? (
            <span className="max-w-prose text-muted-foreground text-xs">
              {t("table.reason", { reason })}
            </span>
          ) : null}
          {row.rejection_reason ? (
            <span className="max-w-prose text-muted-foreground text-xs">
              {t("table.rejectionReason", { reason: row.rejection_reason })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span title={b(`noga.sections.${row.industry_section as "A"}`)}>
          {row.industry_section} · {b(`sizeBands.${band}`)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[status]} data-status={status}>
            {t(`status.${status}`)}
          </Badge>
          {row.flagged ? (
            <Badge variant="destructive" data-flagged>
              {t("table.flagged")}
            </Badge>
          ) : null}
        </div>
        <span className="block text-muted-foreground text-xs">
          {row.proposed_by === "ai" ? t("table.proposedByAi") : t("table.proposedByOps")}
        </span>
      </TableCell>
      <TableCell>
        {row.display_label ?? <span className="text-muted-foreground">{t("table.noLabel")}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums" data-numeric>
        {format.number(row.kpiCount, "integer")}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="tabular-nums" data-numeric>
            {row.researched_at ? (
              <time dateTime={row.researched_at}>
                {format.dateTime(new Date(row.researched_at), "dateShort")}
              </time>
            ) : (
              t("table.never")
            )}
          </span>
          {row.openRun ? (
            <span className="flex items-center gap-1 text-xs">
              <RunStatusBadge status={row.openRun.status} />
            </span>
          ) : row.lastRun && isRunStatus(row.lastRun.status) ? (
            <span className="flex items-center gap-1 text-xs">
              <RunStatusBadge status={row.lastRun.status} />
            </span>
          ) : null}
          {row.failed_refreshes > 0 ? (
            <span className="text-muted-foreground text-xs">
              {t("table.failures", { count: row.failed_refreshes })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <PeerRowActions row={row} status={status} />
      </TableCell>
    </TableRow>
  );
}

function PeerRowActions({
  row,
  status,
}: {
  readonly row: PeerAdminRow;
  readonly status: PeerStatus;
}) {
  const t = useTranslations("peers");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = <Data,>(
    call: () => Promise<PeerActionResult<Data> | { ok: false; error: string }>,
    success: (data: Data) => string,
  ) =>
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.success(success(result.data));
        setRejecting(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${result.error as "unexpected"}`));
      }
    });

  return (
    <div className="flex flex-wrap gap-1">
      {status === "proposed" || status === "retired" ? (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => approvePeer(null, { peerId: row.id, locale }),
              (data) => t("actions.approved", { label: data.displayLabel }),
            )
          }
          data-action="approve"
        >
          {t("actions.approve")}
        </Button>
      ) : null}
      {status === "proposed" ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setRejecting(true)}
            data-action="reject"
          >
            {t("actions.reject")}
          </Button>
          <Dialog open={rejecting} onOpenChange={setRejecting}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("actions.rejectTitle")}</DialogTitle>
                <DialogDescription>{t("actions.rejectDescription")}</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor={`reject-reason-${row.id}`}>
                  {t("actions.rejectReason")}
                </FieldLabel>
                <Textarea
                  id={`reject-reason-${row.id}`}
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={pending}>
                    {t("actions.cancel")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => rejectPeer(null, { peerId: row.id, reason, locale }),
                      () => t("actions.rejected"),
                    )
                  }
                  data-action="confirm-reject"
                >
                  {t("actions.confirmReject")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
      {status === "approved" ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || row.openRun !== null}
            onClick={() =>
              run(
                () => rerunPeer(null, { peerId: row.id, locale }),
                () => t("actions.rerunStarted"),
              )
            }
            data-action="rerun"
          >
            {t("actions.rerun")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(
                () => retirePeer(null, { peerId: row.id, locale }),
                () => t("actions.retired"),
              )
            }
            data-action="retire"
          >
            {t("actions.retire")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
