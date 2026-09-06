import { DEFAULT_LOCALE, LOCALE_CODE } from "@/i18n/routing";
import type { AlertView } from "./registry";

/** The Slack incoming webhook body: a fallback text plus Block Kit blocks. */
export type SlackMessage = {
  readonly text: string;
  readonly blocks: ReadonlyArray<Record<string, unknown>>;
};

/** The locale prefix of the admin links in the ops channel: the app default (English). */
const ADMIN_LOCALE = LOCALE_CODE[DEFAULT_LOCALE];

export type SlackMessageLinks = {
  /** A bare app path; prefixed with the app URL and the admin locale. */
  readonly link?: string | undefined;
  /** An absolute https link outside the app (spec 0007, AC-10); used when `link` is not set. */
  readonly externalUrl?: string | undefined;
  readonly appUrl: string;
};

/**
 * Builds the Block Kit payload of one alert (spec 0006, AC-2, AC-11; spec 0007, AC-10): a header,
 * a two column section of label and value pairs, and one button when a link is given (`link`
 * into the app when set, else `externalUrl`, else no button). The fallback text carries the title
 * and the first value for notifications. Pure.
 */
export function buildSlackMessage(
  view: AlertView,
  { link, externalUrl, appUrl }: SlackMessageLinks,
): SlackMessage {
  const first = view.fields[0];
  const text = first ? `${view.title}: ${first[1]}` : view.title;
  const url = link ? `${appUrl.replace(/\/$/, "")}/${ADMIN_LOCALE}${link}` : (externalUrl ?? null);
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: view.title, emoji: false } },
      {
        type: "section",
        fields: view.fields.slice(0, 10).map(([label, value]) => ({
          type: "mrkdwn",
          text: `*${escapeMrkdwn(label)}*\n${escapeMrkdwn(value)}`.slice(0, 2000),
        })),
      },
      ...(url
        ? [
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: view.buttonLabel, emoji: false },
                  url,
                },
              ],
            },
          ]
        : []),
    ],
  };
}

/** Slack's mrkdwn escapes: the three characters it reads as control sequences. */
function escapeMrkdwn(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
