"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type PhotoResult, removeExpertPhoto, uploadExpertPhoto } from "@/features/experts/actions";
import { PHOTO_TYPES } from "@/features/experts/catalogue";
import { ExpertAvatar } from "./expert-avatar";

export type ExpertPhotoFieldProps = {
  readonly fullName: string | null;
  /** A signed URL minted on the server this render, or null when there is no photo. */
  readonly photoUrl: string | null;
  readonly hasPhoto: boolean;
};

/** The `accept` attribute, built from the same map the upload action validates against. */
const ACCEPT = Object.keys(PHOTO_TYPES).join(",");

/**
 * The expert's own photo control (spec 0013, AC-6): the current photo or their initials, a file
 * picker that uploads at once and a button that removes it.
 *
 * The upload takes a `FormData` rather than a parsed value, because a `File` is what the action
 * needs and only `FormData` carries one across the boundary; it is therefore called directly in a
 * transition rather than through `useFormAction`, whose payload is a plain object. Browser.
 */
export function ExpertPhotoField({ fullName, photoUrl, hasPhoto }: ExpertPhotoFieldProps) {
  const t = useTranslations("experts.photo");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);

  const settle = (result: PhotoResult, success: string) => {
    if (result.ok) {
      setFailure(null);
      toast.success(success);
      router.refresh();
      return;
    }
    setFailure(t(`errors.${result.error}`));
  };

  const upload = (file: File) => {
    const body = new FormData();
    body.set("photo", file);
    startTransition(async () => {
      settle(await uploadExpertPhoto(body), t("uploaded"));
      // Cleared whatever the answer was, so choosing the same file again re fires the change event.
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div className="flex flex-col gap-4" data-expert-photo>
      {failure ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{failure}</AlertTitle>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <ExpertAvatar fullName={fullName} photoUrl={photoUrl} className="size-20 shrink-0" />
        <div className="flex flex-1 flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="expert-photo">{t("label")}</FieldLabel>
            <Input
              id="expert-photo"
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              disabled={pending}
              aria-describedby="expert-photo-hint"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <FieldDescription id="expert-photo-hint">{t("hint")}</FieldDescription>
          </Field>
          {hasPhoto ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    settle(await removeExpertPhoto(null, null), t("removed"));
                  })
                }
              >
                {t("remove")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
