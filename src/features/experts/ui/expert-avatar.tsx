import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * An expert's photo, or their initials when there is none (spec 0012, AC-6). The photo URL is a
 * short lived signed one minted per render by `photoUrl`, so this component never sees an object
 * path and cannot leak one into the markup.
 *
 * The image carries an empty `alt` and the name is not repeated in it: every place this is used
 * already shows the name as text beside it, so an alt text would make a screen reader say it
 * twice. Server and client components.
 */
export function ExpertAvatar({
  fullName,
  photoUrl,
  className,
}: {
  readonly fullName: string | null;
  readonly photoUrl: string | null;
  readonly className?: string;
}) {
  return (
    <Avatar className={cn("size-12", className)}>
      {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
      <AvatarFallback className="font-medium text-sm">{initials(fullName)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Up to two initials from a name: the first letter of the first and last words. Falls back to a
 * dash rather than an empty circle, because a profile row can exist before the invitee has typed
 * their name. Pure, runs anywhere.
 */
export function initials(fullName: string | null): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "–";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
