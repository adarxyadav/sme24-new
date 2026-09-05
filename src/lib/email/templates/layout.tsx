import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { EMAIL_THEME } from "./theme";

const { colors, fontFamily, radius, width } = EMAIL_THEME;

const styles = {
  body: {
    margin: 0,
    padding: "32px 16px",
    backgroundColor: colors.ground,
    fontFamily,
    color: colors.jet,
  },
  container: {
    maxWidth: `${width}px`,
    margin: "0 auto",
    backgroundColor: colors.pureWhite,
    border: `1px solid ${colors.hairline}`,
    borderRadius: radius,
  },
  header: { padding: "28px 32px 20px" },
  wordmark: {
    margin: 0,
    fontSize: "22px",
    lineHeight: "28px",
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: colors.jet,
  },
  descriptor: {
    margin: "2px 0 0",
    fontSize: "11px",
    lineHeight: "16px",
    fontWeight: 500,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: colors.muted,
  },
  hairline: { margin: 0, borderTop: `1px solid ${colors.hairline}`, borderBottom: "none" },
  content: { padding: "28px 32px 8px" },
  heading: {
    margin: "0 0 16px",
    fontSize: "24px",
    lineHeight: "32px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: colors.jet,
  },
  text: { margin: "0 0 16px", fontSize: "15px", lineHeight: "24px", color: colors.obsidian },
  buttonRow: { padding: "8px 32px 32px" },
  button: {
    display: "inline-block",
    boxSizing: "border-box" as const,
    padding: "12px 20px",
    backgroundColor: colors.jet,
    color: colors.pureWhite,
    borderRadius: radius,
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: 600,
    textDecoration: "none",
  },
  footer: { padding: "20px 32px 28px" },
  footerText: { margin: "0 0 6px", fontSize: "12px", lineHeight: "18px", color: colors.muted },
} as const;

export type EmailLayoutProps = {
  readonly locale: "de" | "en";
  /** The wordmark and its descriptor (`common.appName`, `brand.descriptor`). */
  readonly brand: { readonly name: string; readonly descriptor: string };
  readonly preview: string;
  readonly heading: string;
  /** The one primary action of the email. */
  readonly button: { readonly label: string; readonly href: string };
  readonly footer: {
    readonly legal: string;
    readonly address: string;
    readonly replyHint: string;
  };
  readonly children: ReactNode;
};

/**
 * The shared frame of every SME24 email (spec 0006, AC-14): the wordmark and descriptor, jet on
 * white with hairlines, one heading, the body paragraphs, one primary button and the legal footer
 * with the reply hint. Every string comes from the caller, so the layout holds no prose. Rendered
 * by the send-email task, the ops preview and the React Email preview server.
 */
export function EmailLayout({
  locale,
  brand,
  preview,
  heading,
  button,
  footer,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang={locale}>
      <Head />
      <Body style={styles.body}>
        <Preview>{preview}</Preview>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.wordmark}>{brand.name}</Text>
            <Text style={styles.descriptor}>{brand.descriptor}</Text>
          </Section>
          <Hr style={styles.hairline} />
          <Section style={styles.content}>
            <Text style={styles.heading}>{heading}</Text>
            {children}
          </Section>
          <Section style={styles.buttonRow}>
            <Button href={button.href} style={styles.button}>
              {button.label}
            </Button>
          </Section>
          <Hr style={styles.hairline} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>{footer.replyHint}</Text>
            <Text style={styles.footerText}>{footer.legal}</Text>
            <Text style={styles.footerText}>{footer.address}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** A body paragraph in the email's type scale. */
export function EmailText({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.text}>{children}</Text>;
}
