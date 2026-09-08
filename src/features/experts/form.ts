import { EXPERT_CATALOGUE, type ExpertListName } from "./catalogue";
import type { ExpertProfile } from "./queries";
import type { ExpertProfileInput } from "./schema";

/**
 * The stored values of one list column, narrowed to the codes the catalogue still knows. A stored
 * code that has since been retired is dropped rather than carried into the form: the schema would
 * reject it on submit and the expert would face an error on a field they never touched. Pure.
 */
function codes<N extends ExpertListName>(
  name: N,
  stored: readonly string[],
): ExpertProfileInput[N] {
  const known = EXPERT_CATALOGUE[name] as readonly string[];
  return stored.filter((code) => known.includes(code)) as ExpertProfileInput[N];
}

/**
 * The stored row as the profile form's default values (spec 0013, AC-5). One function rather than
 * two inline mappings, because the expert's page and the ops page prefill the same form and a
 * field that drifted between them would show one caller a value the other never sees.
 *
 * Every nullable column becomes an empty string: a form field holds a string, and the schema's
 * own `emptyToNull` turns it back into null on the way out, so a field left alone round trips to
 * exactly the value it started as. Pure, runs anywhere.
 */
export function profileFormDefaults(profile: ExpertProfile): ExpertProfileInput {
  return {
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    competencies: codes("competencies", profile.competencies),
    industries: codes("industries", profile.industries),
    standards: codes("standards", profile.standards),
    languages: codes("languages", profile.languages),
    regions: codes("regions", profile.regions),
    availability: profile.availability as ExpertProfileInput["availability"],
    availableFrom: profile.available_from ?? "",
    availabilityNote: profile.availability_note ?? "",
    // A number field wants a string too; a null years count is an empty box, not a zero.
    yearsExperience: profile.years_experience === null ? "" : String(profile.years_experience),
    phone: profile.phone ?? "",
  };
}
