/**
 * The prompt that drafts the German of the questionnaire content (spec 0019, AC-1). Run by
 * `pnpm questionnaires:build` through `structuredOutput`; never at request time. Alias free on
 * purpose, so the hand run script imports it by relative `.ts` path. Pure.
 */

/** Bumped by hand when the prompt text changes; recorded in the build script's log line. */
export const PROMPT_VERSION = "questionnaire-translation@1";

/**
 * The official German clause titles of ISO 45001:2018 (DIN ISO 45001), with the standard's
 * abbreviation SGA (Sicherheit und Gesundheit bei der Arbeit) written as OH&S, the abbreviation
 * the product keeps in both languages.
 */
export const ISO_CLAUSE_TITLES_DE: { readonly [label: string]: string } = {
  "4.1": "Verstehen der Organisation und ihres Kontextes",
  "4.2":
    "Verstehen der Erfordernisse und Erwartungen der Beschäftigten und anderer interessierter Parteien",
  "4.3": "Festlegen des Anwendungsbereichs des OH&S-Managementsystems",
  "4.4": "OH&S-Managementsystem und seine Prozesse",
  "5.1": "Führung und Verpflichtung / Allgemeines",
  "5.2": "OH&S-Politik",
  "5.3": "Rollen, Verantwortlichkeiten und Befugnisse in der Organisation",
  "5.4": "Konsultation und Beteiligung der Beschäftigten",
  "6.1.1": "Massnahmen zum Umgang mit Risiken und Chancen / Allgemeines",
  "6.1.2.1": "Ermittlung von Gefährdungen",
  "6.1.3": "Bestimmen von rechtlichen Verpflichtungen und anderen Anforderungen",
  "6.1.4": "Planen von Massnahmen",
  "6.2.1": "OH&S-Ziele und Planung zu deren Erreichung",
  "7.2": "Kompetenz",
  "7.3": "Bewusstsein",
  "7.4": "Kommunikation",
  "7.5": "Dokumentierte Information / Allgemeines",
  "8.1.2": "Beseitigung von Gefährdungen und Minderung von OH&S-Risiken",
  "8.1.3": "Änderungsmanagement",
  "8.1.4": "Beschaffung, Allgemeines und Auftragnehmer 8.1.4.2 und Ausgliederung 8.1.4.3",
  "9.1.1": "Überwachung, Messung, Analyse und Leistungsbewertung / Allgemeines",
  "9.1.2": "Bewertung der Einhaltung von Verpflichtungen",
  "9.2": "Internes Audit",
  "9.3": "Managementbewertung",
  "10.1": "Verbesserung / Allgemeines",
  "10.2": "Vorfall, Nichtkonformität und Korrekturmassnahmen",
  "10.3": "Fortlaufende Verbesserung",
};

/** The OH&S terms the German must use, English to German. */
export const GLOSSARY_DE: readonly (readonly [en: string, de: string])[] = [
  ["OH&S", "OH&S (Arbeitssicherheit und Gesundheitsschutz); the abbreviation stays OH&S"],
  ["OH&S management system", "OH&S-Managementsystem"],
  ["OH&S policy", "OH&S-Politik"],
  ["OH&S objectives", "OH&S-Ziele"],
  ["OH&S performance", "OH&S-Leistung"],
  ["OH&S risks and opportunities", "OH&S-Risiken und -Chancen"],
  ["hazard identification", "Ermittlung von Gefährdungen"],
  ["interested parties", "interessierte Parteien"],
  ["workers", "Beschäftigte"],
  ["workers' representatives", "Beschäftigtenvertreter"],
  ["top management", "oberste Leitung"],
  ["documented information", "dokumentierte Information"],
  [
    "legal requirements and other requirements",
    "rechtliche Verpflichtungen und andere Anforderungen",
  ],
  ["nonconformity", "Nichtkonformität"],
  ["corrective action", "Korrekturmassnahme"],
  ["continual improvement", "fortlaufende Verbesserung"],
  ["management review", "Managementbewertung"],
  ["internal audit", "internes Audit"],
  ["compliance", "Einhaltung (of requirements); Compliance when it names the questionnaire"],
  ["hierarchy of controls", "Massnahmenhierarchie"],
  ["permit to work", "Arbeitsfreigabe (Permit)"],
  ["hot work", "Heissarbeiten"],
  ["line breaking", "Öffnen von Leitungen (Line Breaking)"],
  ["confined space", "enger Raum (Confined Space)"],
  ["lockout tagout (LOTO)", "Lockout Tagout (LOTO)"],
  ["management of change (MOC)", "Änderungsmanagement (MOC)"],
  ["pre-startup safety review (PSSR)", "Sicherheitsprüfung vor Inbetriebnahme (PSSR)"],
  ["personal protective equipment (PPE)", "persönliche Schutzausrüstung (PSA)"],
  ["contractor", "Auftragnehmer"],
  ["Look for:", "Achten Sie auf:"],
];

/** The system prompt: the job, the register, the glossary and the output rules. Pure. */
export function questionnaireTranslationSystemPrompt(): string {
  const clauseTitles = Object.entries(ISO_CLAUSE_TITLES_DE)
    .map(([label, title]) => `- ${label}: ${title}`)
    .join("\n");
  const glossary = GLOSSARY_DE.map(([en, de]) => `- ${en} → ${de}`).join("\n");
  return [
    "You translate the English texts of an occupational health and safety assessment checklist into German for Swiss EHS experts.",
    "Translate; do not paraphrase, shorten, extend or explain. Keep every bullet, line break, numbering, parenthesis, abbreviation and clause reference exactly where it is.",
    "",
    "Register:",
    "- Swiss Standard German: write ss, never ß.",
    "- Formal Sie where a question addresses the reader; the checklist is a professional tool.",
    "- The register of an audit checklist: precise, sober, the wording of the German edition of ISO 45001 where it exists.",
    "- Keep 'OH&S' as the abbreviation in German (it stands for Arbeitssicherheit und Gesundheitsschutz); write 'Managementsystem', never 'Qualitätsmanagementsystem'.",
    "- Keep the English acronyms the industry uses (LOTO, MOC, PSSR, GFCI, EHS, KPI, NDA) and add the German term where the glossary gives one.",
    "",
    "When a text is the title of an ISO 45001 clause, use the official German title:",
    clauseTitles,
    "",
    "Glossary:",
    glossary,
    "",
    "Output rules:",
    "- Return every id you received exactly once with its German text; never drop, merge or add an entry.",
    "- Never leave a text in English, never return an empty text.",
  ].join("\n");
}

export type TranslationEntry = {
  /** Round trips unchanged; the caller matches the answer by it. */
  readonly id: string;
  /** What the text is (a clause title, a requirement, a question, a section title), for the register. */
  readonly kind: string;
  /** The display number of the item the text belongs to, so a clause title finds its official German. */
  readonly label: string | null;
  readonly en: string;
};

/** The user prompt: the questionnaire and section for context, then every entry to translate. Pure. */
export function questionnaireTranslationPrompt(
  context: { readonly questionnaire: string; readonly section: string | null },
  entries: readonly TranslationEntry[],
): string {
  const lines = entries.map((entry) => {
    const where = entry.label === null ? entry.kind : `${entry.kind} of item ${entry.label}`;
    return [`id: ${entry.id}`, `kind: ${where}`, `en: ${JSON.stringify(entry.en)}`].join("\n");
  });
  return [
    `Questionnaire: ${context.questionnaire}`,
    context.section === null ? "Section: (titles of the outline)" : `Section: ${context.section}`,
    "",
    `Entries (${entries.length}):`,
    ...lines.map((block) => `${block}\n`),
  ].join("\n");
}
