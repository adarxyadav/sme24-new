import { z } from "zod";
import { LOCALE_CODE } from "@/i18n/routing";

/** The short codes the database stores, derived from `LOCALE_CODE` so the two lists never drift. */
export const localeCodeSchema = z.enum(Object.values(LOCALE_CODE));

/** Input of the `setLocale` action. */
export const setLocaleSchema = z.object({ locale: localeCodeSchema });

export type SetLocaleInput = z.infer<typeof setLocaleSchema>;
