import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  accountByEmail,
  createBareClient,
  createConfirmedClient,
  createUnconfirmedClient,
  dbAvailable,
  deleteAccount,
  serviceClient,
} from "./db";
import { SEED_USERS, seedPassword } from "./helpers";
import {
  codeIn,
  confirmLink,
  expireAccessToken,
  linkPath,
  mailAvailable,
  mailIds,
  noMailFor,
  readMail,
  uniqueEmail,
} from "./mail";

/**
 * Auth flows (spec 0005). The email dependent tests read Mailpit and assert rows through the
 * secret key, so they run only against the local stack and skip on a deployment.
 */
const localOnly = !mailAvailable || !dbAvailable;
const PASSWORD = "korrekt-pferd-batterie";

/**
 * Opens a page and waits until the dev server is quiet, so React has hydrated before the test
 * clicks a button whose handler only exists after hydration.
 */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** The app's alert (`data-slot="alert"`); `getByRole("alert")` also matches Next's route announcer. */
function alert(page: Page) {
  return page.locator('[data-slot="alert"]');
}

async function signInWith(page: Page, email: string, password: string, locale = "de") {
  await open(page, `/${locale}/sign-in`);
  await page.getByLabel(locale === "de" ? "E-Mail" : "Email").fill(email);
  await page.getByLabel(locale === "de" ? "Passwort" : "Password").fill(password);
  await page
    .getByRole("button", { name: locale === "de" ? "Anmelden" : "Sign in", exact: true })
    .click();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

/** The organization rows of an account: name, owner membership, consent. */
async function expectOwnerOfOrganization(email: string, organizationName: string) {
  const account = await accountByEmail(email);
  expect(account?.profile?.role).toBe("client");
  expect(account?.profile?.terms_accepted_at).toBeTruthy();
  expect(account?.organization?.name).toBe(organizationName);
  expect(account?.memberships).toEqual([
    { organization_id: account?.organization?.id, role: "owner" },
  ]);
  return account;
}

test.describe("sign up with a password (AC-1, AC-11, AC-12, AC-13)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("confirms through the emailed link in a fresh browser and lands on /app with an organization", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("signup");
    try {
      await open(page, "/de/sign-up");
      await page.getByLabel("Vor- und Nachname").fill("Tina Test");
      await page.getByLabel("Unternehmen").fill("Test AG");
      await page.getByLabel("Geschäftliche E-Mail").fill(email);
      await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
      await page.getByLabel(/Nutzungsbedingungen/).check();
      await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
      await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible();

      const mail = await readMail(email);
      // German above English (spec 0005, templates).
      expect(mail.html).toMatch(/Bestätigen Sie Ihre E-Mail[\s\S]*Confirm your email/);
      const link = confirmLink(mail);
      expect(link).toContain("type=signup");
      expect(decodeURIComponent(link)).toContain("/de/app");

      // The link is verified by its token hash, so any browser works: a fresh context here.
      const context = await browser.newContext();
      const fresh = await context.newPage();
      await fresh.goto(linkPath(link));
      await expect(fresh).toHaveURL(/\/de\/app$/);
      await expect(fresh.getByRole("heading", { level: 1 })).toBeVisible();

      const account = await expectOwnerOfOrganization(email, "Test AG");
      expect(account?.profile?.full_name).toBe("Tina Test");
      expect(account?.profile?.locale).toBe("de");

      // A used link lands on sign in with the expired state and a resend button (AC-12).
      await context.clearCookies();
      await fresh.goto(linkPath(link));
      await expect(fresh).toHaveURL(/\/de\/sign-in\?error=link_expired&type=signup$/);
      await expect(fresh.getByText("abgelaufen oder wurde schon verwendet")).toBeVisible();
      await expect(fresh.getByRole("button", { name: "Neue E-Mail senden" })).toBeVisible();
      await context.close();
    } finally {
      await deleteAccount(email);
    }
  });

  test("a broken link for an unconfirmed account shows the expired state and the resend sends a fresh confirmation (AC-12)", async ({
    page,
  }) => {
    // A confirmed account gets no second confirmation from Supabase, so the resend is proven on an
    // account whose link was never opened (spec 0005 verify.md, reworded 2026-09-05).
    const email = uniqueEmail("broken-link");
    try {
      await open(page, "/de/sign-up");
      await page.getByLabel("Vor- und Nachname").fill("Berta Broken");
      await page.getByLabel("Unternehmen").fill("Broken AG");
      await page.getByLabel("Geschäftliche E-Mail").fill(email);
      await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
      await page.getByLabel(/Nutzungsbedingungen/).check();
      await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
      await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible();
      const first = await readMail(email);
      const broken = linkPath(confirmLink(first)).replace(/token_hash=/, "token_hash=deadbeef");
      const seen = await mailIds(email);

      await page.goto(broken);
      await expect(page).toHaveURL(/\/de\/sign-in\?error=link_expired&type=signup$/);
      await expect(page.getByText("abgelaufen oder wurde schon verwendet")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.getByLabel("E-Mail").fill(email);
      // Supabase refuses a second email within its per address frequency guard right after the
      // sign up mail (the wait message), so the press is repeated until it is accepted.
      await expect(async () => {
        await page.getByRole("button", { name: "Neue E-Mail senden" }).click();
        await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible({
          timeout: 3_000,
        });
      }).toPass({ timeout: 20_000, intervals: [1_500, 2_000, 3_000] });

      const fresh = await readMail(email, { seen });
      expect(fresh.html).toMatch(/Bestätigen Sie Ihre E-Mail/);
      expect(confirmLink(fresh)).not.toBe(confirmLink(first));
    } finally {
      await deleteAccount(email);
    }
  });

  test("an existing email shows the inbox state and sends nothing to the existing account", async ({
    page,
  }) => {
    const seen = await mailIds(SEED_USERS.client);
    await open(page, "/en/sign-up");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Company").fill("Impostor Ltd");
    await page.getByLabel("Work email").fill(SEED_USERS.client);
    await page.getByLabel("Password", { exact: true }).fill("another-password-8");
    await page.getByLabel(/terms of use/).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    expect(await noMailFor(SEED_USERS.client, seen)).toBe(true);
  });

  test("a sign up payload that smuggles a role still yields a client (AC-10)", async () => {
    const email = uniqueEmail("smuggle");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        },
        body: JSON.stringify({
          email,
          password: PASSWORD,
          data: { role: "ops", full_name: "Sly Signup" },
          app_metadata: { role: "ops" },
        }),
      });
      expect(response.ok).toBe(true);
      const account = await accountByEmail(email);
      expect(account?.profile?.role).toBe("client");
      expect(account?.user.app_metadata.role).not.toBe("ops");
    } finally {
      await deleteAccount(email);
    }
  });
});

test.describe("sign up and sign in with a code (AC-2, AC-4)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("a code sign up needs no password and ends with the organization created", async ({
    page,
  }) => {
    const email = uniqueEmail("code-signup");
    try {
      await open(page, "/de/sign-up");
      await page.getByLabel("Vor- und Nachname").fill("Carla Code");
      await page.getByLabel("Unternehmen").fill("Code GmbH");
      await page.getByLabel("Geschäftliche E-Mail").fill(email);
      await page.getByLabel(/Nutzungsbedingungen/).check();
      await page
        .getByRole("button", { name: "Stattdessen einen Code per E-Mail erhalten" })
        .click();
      await expect(page.getByLabel("Passwort", { exact: true })).toHaveCount(0);
      await page
        .getByRole("button", { name: "Stattdessen einen Code per E-Mail erhalten" })
        .click();
      await expect(page).toHaveURL(/\/de\/verify-code\?email=/);
      await page.waitForLoadState("networkidle");

      // A code request for a new address sends the confirmation template, which prints the code too.
      const mail = await readMail(email);
      expect(mail.html).toMatch(/Bestätigen Sie Ihre E-Mail[\s\S]*Confirm your email/);
      await page.getByLabel("Code").fill(codeIn(mail));
      await page.getByRole("button", { name: "Anmelden", exact: true }).click();
      await expect(page).toHaveURL(/\/de\/app$/);
      await expectOwnerOfOrganization(email, "Code GmbH");
    } finally {
      await deleteAccount(email);
    }
  });

  test("a wrong code shows the one combined message and the right code still signs in (AC-12)", async ({
    page,
  }) => {
    // Supabase answers otp_expired for a wrong and an expired code alike (spec 0005, amendment of
    // 2026-09-05), so the page shows one message for both and offers a new code.
    const email = uniqueEmail("wrong-code");
    try {
      await open(page, "/de/sign-up");
      await page.getByLabel("Vor- und Nachname").fill("Wanda Wrong");
      await page.getByLabel("Unternehmen").fill("Wrong AG");
      await page.getByLabel("Geschäftliche E-Mail").fill(email);
      await page.getByLabel(/Nutzungsbedingungen/).check();
      await page
        .getByRole("button", { name: "Stattdessen einen Code per E-Mail erhalten" })
        .click();
      await page
        .getByRole("button", { name: "Stattdessen einen Code per E-Mail erhalten" })
        .click();
      await expect(page).toHaveURL(/\/de\/verify-code\?email=/);
      await page.waitForLoadState("networkidle");
      const real = codeIn(await readMail(email));
      const wrong = real === "000000" ? "111111" : "000000";

      await page.getByLabel("Code").fill(wrong);
      await page.getByRole("button", { name: "Anmelden", exact: true }).click();
      await expect(alert(page)).toContainText(
        "Der Code ist falsch oder abgelaufen. Fordern Sie einen neuen an.",
      );

      // The OTP field keeps its six digits, so clear it the way a person would before retyping.
      await page.getByLabel("Code").click();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.getByLabel("Code").fill(real);
      await page.getByRole("button", { name: "Anmelden", exact: true }).click();
      await expect(page).toHaveURL(/\/de\/app$/);
    } finally {
      await deleteAccount(email);
    }
  });

  test("a confirmed user signs in with a code; an unknown email gets the same inbox state and no mail", async ({
    page,
  }) => {
    const seen = await mailIds(SEED_USERS.client2);
    await open(page, "/en/sign-in");
    // An empty email field gets the schema's own message, not a bare invalid state (WCAG 3.3.1).
    await page.getByRole("button", { name: "Email me a code instead" }).click();
    await expect(page.locator("#email-error")).not.toBeEmpty();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/en\/sign-in$/);
    await page.getByLabel("Email").fill(SEED_USERS.client2);
    await page.getByRole("button", { name: "Email me a code instead" }).click();
    await expect(page).toHaveURL(/\/en\/verify-code\?email=/);
    await page.waitForLoadState("networkidle");
    const mail = await readMail(SEED_USERS.client2, { seen });
    await page.getByLabel("Code").fill(codeIn(mail));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/app$/);

    const unknown = uniqueEmail("nobody");
    const unknownSeen = await mailIds(unknown);
    const fresh = await page.context().browser()?.newContext();
    const anonymous = await fresh?.newPage();
    if (!anonymous || !fresh) throw new Error("no browser");
    await open(anonymous, "/de/sign-in");
    await anonymous.getByLabel("E-Mail").fill(unknown);
    await anonymous
      .getByRole("button", { name: "Stattdessen einen Code per E-Mail erhalten" })
      .click();
    await expect(anonymous).toHaveURL(/\/de\/verify-code\?email=/);
    expect(await noMailFor(unknown, unknownSeen)).toBe(true);
    await fresh.close();
  });
});

test.describe("password sign in states (AC-3, AC-12)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("an unconfirmed user with the right password sees the resend offer, with a wrong one the generic message", async ({
    page,
  }) => {
    const email = uniqueEmail("unconfirmed");
    try {
      await createUnconfirmedClient(email, PASSWORD);
      await signInWith(page, email, "falsches-passwort");
      await expect(alert(page)).toContainText("E-Mail oder Passwort ist falsch.");
      await expect(page.getByRole("button", { name: "Bestätigung erneut senden" })).toHaveCount(0);

      await signInWith(page, email, PASSWORD);
      await expect(alert(page)).toContainText("E-Mail noch nicht bestätigt");
      const seen = await mailIds(email);
      await page.getByRole("button", { name: "Bestätigung erneut senden" }).click();
      await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible();
      const mail = await readMail(email, { seen });
      expect(confirmLink(mail)).toContain("type=signup");
    } finally {
      await deleteAccount(email);
    }
  });

  test("a confirmed sign up creates its organization on the first sign in and honours next inside the locale", async ({
    page,
  }) => {
    const email = uniqueEmail("first-signin");
    try {
      await createConfirmedClient(email, PASSWORD, "Erste AG");
      await open(page, "/de/sign-in?next=%2Fde%2Fapp");
      await page.getByLabel("E-Mail").fill(email);
      await page.getByLabel("Passwort").fill(PASSWORD);
      await page.getByRole("button", { name: "Anmelden", exact: true }).click();
      await expect(page).toHaveURL(/\/de\/app$/);
      await expectOwnerOfOrganization(email, "Erste AG");
    } finally {
      await deleteAccount(email);
    }
  });
});

test.describe("onboarding for a client without an organization (AC-5 local half, AC-8, AC-11)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("is the only /app page until the company is named, and a double submit creates one organization", async ({
    page,
  }) => {
    const email = uniqueEmail("onboarding");
    try {
      await createBareClient(email, PASSWORD);
      await signInWith(page, email, PASSWORD, "en");
      await expect(page).toHaveURL(/\/en\/app\/onboarding$/);
      await page.goto("/en/app");
      await expect(page).toHaveURL(/\/en\/app\/onboarding$/);
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page);

      await page.getByLabel("Company").fill("Provider Ltd");
      await page.getByLabel(/terms of use/).check();
      const submit = page.getByRole("button", { name: "Continue" });
      await submit.click();
      await submit.click({ force: true, noWaitAfter: true }).catch(() => undefined);
      await expect(page).toHaveURL(/\/en\/app$/);

      const account = await expectOwnerOfOrganization(email, "Provider Ltd");
      expect(account?.profile?.full_name).toBe("Pia Provider");
      expect(account?.profile?.locale).toBe("en");

      // With the organization claim on the session, onboarding sends the client back to /app.
      await page.goto("/en/app/onboarding");
      await expect(page).toHaveURL(/\/en\/app$/);
    } finally {
      await deleteAccount(email);
    }
  });

  test("two concurrent onboarding submits from two tabs create exactly one organization", async ({
    browser,
  }) => {
    // The disabled button only guards one tab; the database lock in create_organization is what
    // keeps one organization per user (review of 2026-09-05).
    const email = uniqueEmail("race");
    const contexts = [await browser.newContext(), await browser.newContext()];
    try {
      await createBareClient(email, PASSWORD);
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      for (const tab of pages) {
        await signInWith(tab, email, PASSWORD, "en");
        await expect(tab).toHaveURL(/\/en\/app\/onboarding$/);
        await tab.waitForLoadState("networkidle");
        await tab.getByLabel("Company").fill("Race Ltd");
        await tab.getByLabel(/terms of use/).check();
      }
      await Promise.all(pages.map((tab) => tab.getByRole("button", { name: "Continue" }).click()));
      for (const tab of pages) await expect(tab).toHaveURL(/\/en\/app$/);

      const account = await expectOwnerOfOrganization(email, "Race Ltd");
      const { data: created } = await serviceClient()
        .from("organizations")
        .select("id")
        .eq("created_by", account?.user.id ?? "");
      expect(created).toHaveLength(1);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await deleteAccount(email);
    }
  });
});

test.describe("password reset (AC-6)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("the emailed link sets a new password, signs in and revokes the other session", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("reset");
    const other = await browser.newContext();
    try {
      await createConfirmedClient(email, PASSWORD, "Reset AG");
      const otherPage = await other.newPage();
      await signInWith(otherPage, email, PASSWORD);
      await expect(otherPage).toHaveURL(/\/de\/app$/);

      await open(page, "/de/forgot-password");
      await expectNoAxeViolations(page);
      await page.getByLabel("E-Mail").fill(email);
      await page.getByRole("button", { name: "Link senden" }).click();
      await expect(page.getByText("Prüfen Sie Ihren Posteingang")).toBeVisible();

      const mail = await readMail(email);
      expect(mail.html).toMatch(/Passwort zurücksetzen[\s\S]*Reset your password/);
      await page.goto(linkPath(confirmLink(mail)));
      await expect(page).toHaveURL(/\/de\/reset-password$/);
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page);
      await page.getByLabel("Neues Passwort").fill("neues-pferd-batterie");
      await page.getByRole("button", { name: "Passwort speichern" }).click();
      await expect(page).toHaveURL(/\/de\/app$/);

      // The other session is gone: its next request cannot refresh and lands on sign in.
      await expireAccessToken(other);
      await otherPage.goto("/de/app");
      await expect(otherPage).toHaveURL(/\/de\/sign-in\?next=%2Fde%2Fapp$/);

      // The new password works, the old one does not.
      const fresh = await browser.newContext();
      const freshPage = await fresh.newPage();
      await signInWith(freshPage, email, PASSWORD);
      await expect(alert(freshPage)).toContainText("E-Mail oder Passwort ist falsch.");
      await signInWith(freshPage, email, "neues-pferd-batterie");
      await expect(freshPage).toHaveURL(/\/de\/app$/);
      await fresh.close();
    } finally {
      await other.close();
      await deleteAccount(email);
    }
  });

  test("forgot password shows the inbox state for an unknown address and sends nothing", async ({
    page,
  }) => {
    const unknown = uniqueEmail("nobody");
    const seen = await mailIds(unknown);
    await open(page, "/en/forgot-password");
    await page.getByLabel("Email").fill(unknown);
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    expect(await noMailFor(unknown, seen)).toBe(true);
  });
});

test.describe("sign out and sessions (AC-7, AC-9)", () => {
  test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

  test("sign out from the user menu clears the cookies and the next /app visit asks to sign in", async ({
    page,
  }) => {
    await signInWith(page, SEED_USERS.client, seedPassword as string);
    await expect(page).toHaveURL(/\/de\/app$/);
    await page.getByRole("button", { name: "Benutzermenü" }).click();
    await page.getByRole("menuitem", { name: "Abmelden" }).click();
    await expect(page).toHaveURL(/\/de$/);
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => cookie.name.startsWith("sb-"))).toEqual([]);
    await page.goto("/de/app");
    await expect(page).toHaveURL(/\/de\/sign-in\?next=%2Fde%2Fapp$/);
  });

  test("a session survives a reload, a new tab and an expired access token", async ({ page }) => {
    await signInWith(page, SEED_USERS.client, seedPassword as string);
    await expect(page).toHaveURL(/\/de\/app$/);
    await page.reload();
    await expect(page).toHaveURL(/\/de\/app$/);
    const tab = await page.context().newPage();
    await tab.goto("/de/app");
    await expect(tab).toHaveURL(/\/de\/app$/);

    const before = (await page.context().cookies()).find((cookie) =>
      /^sb-.*-auth-token/.test(cookie.name),
    );
    await expireAccessToken(page.context());
    await page.goto("/de/app");
    await expect(page).toHaveURL(/\/de\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const after = (await page.context().cookies()).find((cookie) =>
      /^sb-.*-auth-token/.test(cookie.name),
    );
    expect(after?.value).not.toBe(before?.value);
    // The rotated refresh token was persisted: a second navigation right after still renders.
    await page.goto("/de/app");
    await expect(page).toHaveURL(/\/de\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("staff invitation (AC-10)", () => {
  test.skip(localOnly, "needs the local stack: Mailpit and the Supabase secret key");

  test("pnpm user:invite creates the expert, the invite link sets a password and lands on /expert", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("invite");
    try {
      const output = execFileSync(
        "node",
        ["scripts/invite-user.mts", "--email", email, "--role", "expert", "--name", "Erika Expert"],
        {
          env: process.env,
          encoding: "utf8",
        },
      );
      expect(output).toContain(`invited ${email} as expert`);
      const account = await accountByEmail(email);
      expect(account?.profile?.role).toBe("expert");
      expect(account?.user.app_metadata.role).toBe("expert");

      const mail = await readMail(email);
      expect(mail.html).toMatch(/Ihre Einladung zu SME24[\s\S]*Your invitation to SME24/);
      const link = confirmLink(mail);
      expect(link).toContain("type=invite");

      const context = await browser.newContext();
      const fresh = await context.newPage();
      await fresh.goto(linkPath(link));
      await expect(fresh).toHaveURL(/\/de\/reset-password$/);
      await fresh.waitForLoadState("networkidle");
      await fresh.getByLabel("Neues Passwort").fill(PASSWORD);
      await fresh.getByRole("button", { name: "Passwort speichern" }).click();
      await expect(fresh).toHaveURL(/\/de\/expert$/);
      await context.close();

      // An expired invite offers no resend, only the note to ask the administrator.
      await page.goto(linkPath(link));
      await expect(page).toHaveURL(/\/de\/sign-in\?error=link_expired&type=invite$/);
      await expect(page.getByText(/Administratorin oder Ihren Administrator/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Neue E-Mail senden" })).toHaveCount(0);
    } finally {
      await deleteAccount(email);
    }
  });
});

test.describe("auth pages render in both languages without axe violations (AC-13)", () => {
  for (const path of [
    "/de/sign-up",
    "/en/sign-up",
    "/de/sign-in",
    "/en/sign-in",
    "/de/sign-in?error=link_expired&type=signup",
    "/de/verify-code?email=someone%40example.test",
    "/en/verify-code",
    "/de/forgot-password",
    "/en/forgot-password",
    "/de/reset-password",
    "/en/reset-password",
  ]) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
