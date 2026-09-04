export type GallerySectionProps = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
};

/** One gallery block with its own `h2`, so axe and screen readers can navigate the page. Server. */
export function GallerySection({ id, title, description, children }: GallerySectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="font-semibold text-lg">
          {title}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** A labelled example inside a section: caption above, the primitive below. Server. */
export function Example({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </figure>
  );
}
