"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Every overlay with an open trigger (AC-6): focus is trapped and returned by Radix. Browser. */
export function OverlaysSection() {
  const t = useTranslations("gallery.overlays");
  return (
    <Example label={t("label")}>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">{t("dialog.open")}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button variant="destructive">{t("dialog.confirm")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">{t("sheet.open")}</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("sheet.title")}</SheetTitle>
            <SheetDescription>{t("sheet.description")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 px-4 text-sm">{t("sheet.body")}</div>
          <SheetFooter>
            <SheetClose asChild>
              <Button>{t("close")}</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">{t("menu.open")}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("menu.label")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>{t("menu.edit")}</DropdownMenuItem>
            <DropdownMenuItem>{t("menu.duplicate")}</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive">{t("menu.delete")}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">{t("popover.open")}</Button>
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>{t("popover.title")}</PopoverTitle>
            <PopoverDescription>{t("popover.description")}</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("tooltip.label")}>
            <InfoIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("tooltip.text")}</TooltipContent>
      </Tooltip>
    </Example>
  );
}
