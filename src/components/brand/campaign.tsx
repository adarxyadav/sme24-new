import Image, { type StaticImageData } from "next/image";
import { Signature } from "@/components/brand/signature";
import { Statement } from "@/components/brand/statement";
import { cn } from "@/lib/utils";

/*
 * The campaign format (Kampagnen deck): one object cut out on pure white, a statement closed by
 * the square stop, an optional parenthetical subline, the signature bottom left. Pieces are
 * artifacts, so they stay white with jet ink in both themes. Compose: CampaignPiece holds the
 * statement; CampaignFrame holds one image (or an empty frame, the "AI" joke); CampaignGrid puts
 * frames side by side (pairs, contrasts, the four panel strip); CampaignWall tiles pieces on a
 * marketing page. All server components; feature 13 supplies the photography.
 */

export type CampaignPieceProps = {
  /** "Geschäftsessen." or "No slides. Results." Each sentence becomes a line. */
  readonly statement: string;
  /** The small aside under the statement: "(Auch vegan)." */
  readonly subline?: string;
  readonly as?: "h1" | "h2" | "h3" | "p";
  /** Hide the signature when the piece sits inside a wall that signs once. */
  readonly signature?: boolean;
  /** The object: a `CampaignFrame`, a `CampaignGrid`, or nothing for a type only piece. */
  readonly children?: React.ReactNode;
  readonly className?: string;
};

/** One campaign piece: object, statement, subline, signature. White ground in both themes. */
export function CampaignPiece({
  statement,
  subline,
  as = "h2",
  signature = true,
  children,
  className,
}: CampaignPieceProps) {
  return (
    <article
      data-slot="campaign-piece"
      className={cn(
        "flex w-full flex-col bg-pure-white text-center text-jet",
        signature ? "min-h-[24rem]" : "",
        className,
      )}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pt-10 pb-8 sm:px-10">
        {children ? (
          <div className="flex w-full flex-1 items-center justify-center">{children}</div>
        ) : null}
        <div className="flex flex-col items-center gap-2">
          <Statement
            as={as}
            text={statement}
            className={
              children ? "text-display-sm md:text-display" : "text-display md:text-display-lg"
            }
          />
          {subline ? <p className="text-jet/60 text-sm italic">{subline}</p> : null}
        </div>
      </div>
      {signature ? (
        <div className="flex items-center px-6 pb-6 sm:px-10">
          <Signature />
        </div>
      ) : null}
    </article>
  );
}

const ASPECT = {
  square: "aspect-square",
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
  wide: "aspect-video",
} as const;

export type CampaignFrameProps = {
  /** The statement above a frame in a pair: "Graue Haare." or the bare "AI". */
  readonly caption?: string;
  readonly aspect?: keyof typeof ASPECT;
  /** A deliberately blank, hairlined frame (the empty "AI" column). */
  readonly empty?: boolean;
  /** Development placeholder text shown in a dashed frame when there is no image yet. */
  readonly placeholder?: string;
  /** Usually a `CampaignImage`; any absolutely positioned node fits. */
  readonly children?: React.ReactNode;
  readonly className?: string;
};

/** One object slot with an optional caption statement above it. */
export function CampaignFrame({
  caption,
  aspect = "square",
  empty = false,
  placeholder,
  children,
  className,
}: CampaignFrameProps) {
  return (
    <figure
      data-slot="campaign-frame"
      className={cn("flex min-w-0 flex-1 flex-col items-center gap-4", className)}
    >
      {caption ? <Statement as="h3" text={caption} className="text-display-sm" /> : null}
      <div
        aria-hidden={empty || (!children && Boolean(placeholder)) ? true : undefined}
        className={cn(
          "relative flex w-full items-center justify-center overflow-hidden",
          ASPECT[aspect],
          empty ? "border border-jet" : "",
          !children && placeholder ? "border border-jet/30 border-dashed" : "",
        )}
      >
        {children}
        {!children && placeholder ? (
          <span className="eyebrow px-4 text-center text-jet/50">{placeholder}</span>
        ) : null}
      </div>
    </figure>
  );
}

export type CampaignImageProps = {
  readonly src: string | StaticImageData;
  readonly alt: string;
  /** Photographs of people and places are black and white per the imagery rule; objects keep their color. */
  readonly grayscale?: boolean;
  readonly sizes?: string;
  readonly priority?: boolean;
};

/** The object image, cut out on white, filling its `CampaignFrame`. */
export function CampaignImage({
  src,
  alt,
  grayscale = false,
  sizes = "(min-width: 768px) 50vw, 100vw",
  priority,
}: CampaignImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn("object-contain", grayscale ? "grayscale" : "")}
    />
  );
}

const COLUMNS = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

export type CampaignGridProps = {
  readonly columns?: keyof typeof COLUMNS;
  readonly children: React.ReactNode;
  readonly className?: string;
};

/** Frames side by side: a pair, a contrast, or four panels (two columns, two rows). */
export function CampaignGrid({ columns = 2, children, className }: CampaignGridProps) {
  return (
    <div
      data-slot="campaign-grid"
      className={cn("grid w-full gap-6 sm:gap-8", COLUMNS[columns], className)}
    >
      {children}
    </div>
  );
}

export type CampaignWallProps = {
  readonly children: React.ReactNode;
  readonly className?: string;
};

/** Pieces tiled with hairlines between them, for a marketing page section. */
export function CampaignWall({ children, className }: CampaignWallProps) {
  return (
    <div
      data-slot="campaign-wall"
      className={cn("grid w-full gap-px border bg-border sm:grid-cols-2", className)}
    >
      {children}
    </div>
  );
}
