# wp3 — login integration and fallback order

Four files change. After this phase `ocx login meta-muse` can complete a device grant,
and an existing user's login behaves exactly as it does today.

**MODIFY** `src/oauth/types.ts` — the credential field
**MODIFY** `src/oauth/meta-muse.ts` — selection order, refresh metadata preservation
**MODIFY** `src/oauth/index.ts` — registration
**MODIFY** `src/providers/registry.ts` — the user-visible note

## The selection order, and why

| Invocation | Order |
|---|---|
| Plain `ocx login meta-muse` | Keychain import (darwin, if a credential is there) -> device grant -> manual paste |
| Add-account or reauth (`forceLogin`) | Device grant -> manual paste. **Never** import |

Import stays first for a plain login for two reasons, and both are about not making things
worse. A user who already ran `muse login` gets the current zero-interaction path. And a
device grant ends in a mint call against a rate-limited endpoint (`001` §B), so starting
one when a working credential is already on disk spends a request to arrive at the same key.

`forceLogin` must skip import, because reimporting is how an add-account silently
re-adds the account the user already has. That is not a new rule: `src/oauth/index.ts:220`
applies exactly this mapping to `command-code`, and
`src/oauth/command-code.ts:25-31` documents the reason.

Device now precedes paste on every platform, which is the real user-visible win: a Windows
or Linux host currently has no login at all, only a paste field
(`src/oauth/meta-muse.ts` non-darwin branch).

## `src/oauth/types.ts`

Add beside `KiroOAuthMetadata`, whose role this mirrors (`002` §A):

```ts
/**
 * Account-scoped Muse Code data that is NOT the request bearer.
 *
 * The Model API is authenticated by the `LLM|` key in `access`; this token authenticates
 * the Meta ACCOUNT and exists only to mint that key and to read subscription usage
 * (devlog/_plan/260912_muse_device_oauth/002 §A). Keeping it out of `access` is what lets
 * every request path stay unchanged.
 */
export interface MuseOAuthMetadata {
  /** Meta account access token from the device grant. Never sent to api.meta.ai/v1. */
  oauthAccessToken: string;
  /** Epoch ms of the mint that produced the stored key. */
  mintedAt?: number;
  /** Subscription tier label as Meta reported it. Display only. */
  tierName?: string;
}
```

and on `OAuthCredentials`, directly after the `kiro` field:

```ts
  /** Never returned by management APIs; persisted only inside the protected auth-store boundary. */
  muse?: MuseOAuthMetadata;
```

**Verify before writing:** `kiro` is described with that same sentence at
`src/oauth/types.ts:52-53`. wp3's first step is to confirm the projection path that makes
it true — `rg -n "\\bkiro\\b" src/oauth/health.ts src/server/management/oauth-account-routes.ts`
— and to follow it for `muse`. If `kiro` turns out to be redacted by an allowlist rather
than by omission, `muse` joins the same allowlist and this doc is amended.

## `src/oauth/meta-muse.ts`

### 1. Header comment

The module docstring currently opens "Meta Muse Code credential import." It becomes
"Meta Muse Code login: device grant, CLI import, or pasted key." Its two measured facts
stay; a third is added, pointing at `001` for the grant and at `002` §A for why the
account token is stored separately.

### 2. Consent warning

`CONSENT_WARNING` gains one sentence, and it is the sentence that must not be softened:

```ts
  "A device login authenticates as Meta's own Muse Code client, which is a stronger claim than reusing a key your CLI already minted.",
```

It is inserted as the second element, before the "Using it here is UNSUPPORTED" line, so
the CLI prints it before any credential is read. The existing test that the warning fires
before the first read (`tests/providers/meta-muse-oauth.test.ts:115-123`) keeps passing
unchanged.

### 3. Deps

```ts
export interface MuseImportDeps {
  platform?: string;
  readPointer?: () => Promise<string | null>;
  readKeychain?: (signal?: AbortSignal) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Injected so login tests exercise the order without running a grant. */
  loginDevice?: (ctrl: OAuthController) => Promise<OAuthCredentials>;
}
```

### 4. `loginMetaMuse` options and body

Signature gains a third parameter rather than changing the first two, so every existing
caller and test compiles unchanged:

```ts
export interface MuseLoginOptions {
  /** `"off"` skips the Keychain import; add-account and reauth pass it. */
  importLocal?: "fallback" | "off";
}

export async function loginMetaMuse(
  ctrl: OAuthController = {},
  deps: MuseImportDeps = {},
  options: MuseLoginOptions = {},
): Promise<OAuthCredentials> {
```

Body changes, in order:

```
  ctrl.onProgress?.(CONSENT_WARNING);                     // unchanged, still first
  const platform = deps.platform ?? process.platform;

+ const importAllowed = options.importLocal !== "off" && platform === "darwin";
+ if (importAllowed) {
+   const imported = await importFromKeychain(ctrl, deps);   // extracted, see below
+   if (imported) return imported;
+ }
+
+ const device = deps.loginDevice ?? (c => loginMetaMuseDevice(c));
+ try {
+   ctrl.onProgress?.("Starting the Meta device login...");
+   return await device(ctrl);
+ } catch (error) {
+   if (isCancellation(error)) throw error;
+   const reason = deviceFailureReason(error);
+   const pasted = await manualKeyCredential(ctrl, reason);
+   if (pasted === null) throw error;
+   return await validatedMetaMuseCredential(pasted, ctrl, deps, undefined, "manual");
+ }
```

The existing non-darwin and pointer/Keychain branches are not deleted. They move into
`importFromKeychain`, which returns `null` — rather than throwing — for the three
"nothing to import" conditions that are now a fallthrough instead of a dead end:

| Condition | Today | After |
|---|---|---|
| No pointer file | throws `Muse Code CLI credential not found` | returns `null`, device grant runs |
| Pointer has no signed-in Meta account | throws | returns `null`, device grant runs |
| Keychain read times out | throws | returns `null`, device grant runs |
| Pointer is not valid JSON | throws | **still throws** — a corrupt file is a real fault, not an absence |
| Unsupported storage backend | throws | **still throws** — an unmeasured shape must not be guessed past |
| Keychain entry carries no usable key | throws | **still throws** — the import found a credential and it was bad |

`isCancellation` returns true for `MuseDeviceLoginError` with `kind === "cancelled"`, for
`AbortError`, and for `ctrl.signal?.aborted`. A cancelled login must not be answered with
a paste prompt.

`deviceFailureReason` maps an error kind to the one-line reason `manualKeyCredential`
already renders (`src/oauth/meta-muse.ts` `manualKeyCredential`), so the paste field says
why it appeared:

| kind | Reason shown above the paste field |
|---|---|
| `subscription-inactive` | "This Meta account has no active Muse Code subscription." |
| `entitlement-required` | The message, including Meta's action URL |
| `mint-rate-limited` | "Meta rate-limited the key request." |
| `device-denied` | "The browser approval was denied." |
| `device-expired` | "The device code expired before approval." |
| anything else | "The Meta device login did not complete." |

### 5. `refreshMetaMuseToken`

It must stop dropping the account token. Refresh writes into the slot it refreshes, so a
refresh that returns no `muse` field silently removes the on-demand quota capability
(`030`) from a device-logged-in account:

```
  return {
    access: apiKey,
    refresh: apiKey,
    expires: Number.MAX_SAFE_INTEGER,
-   source: credential?.source === "manual" ? "manual" : "local-cli",
+   // Preserve the provenance the slot already recorded. A device login is "oauth";
+   // relabelling it "local-cli" would misreport where the credential came from, which
+   // is the same failure this function's existing comment warns about for "manual".
+   source: credential?.source === "manual" || credential?.source === "oauth"
+     ? credential.source
+     : "local-cli",
+   // The account token is not re-derivable: there is no refresh grant (001 §A). Losing
+   // it here would cost the quota probe with no way back except a full re-login.
+   ...(credential?.muse ? { muse: credential.muse } : {}),
  };
```

## `src/oauth/index.ts`

```
  "meta-muse": {
-   login: ctrl => loginMetaMuse(ctrl),
+   // Add-account/reauth must not reimport the credential already on disk; it starts the
+   // device grant instead, the same mapping command-code uses above.
+   login: (ctrl, opts) => loginMetaMuse(ctrl, {}, { importLocal: opts?.forceLogin ? "off" : "fallback" }),
    refresh: refreshMetaMuseToken,
    providerConfig: oauthConfig("meta-muse"),
    defaultModel: oauthDefaultModel("meta-muse"),
    defaultRefreshPolicy: "disabled",
  },
```

`defaultRefreshPolicy: "disabled"` and its comment stay exactly as they are. The device
grant does not change the posture: there is still no refresh endpoint, and unattended
traffic on a vendor-restricted credential is still the thing we refuse to generate.

## `src/providers/registry.ts`

The `meta-muse` `note` (`registry.ts:1746-1764`) currently opens by describing the provider
as macOS-only and CLI-dependent. Two of its clauses become false in this phase and must
change with the code:

| Current clause | Replacement |
|---|---|
| "Reuses the API key the Muse Code CLI stores after `muse login` (macOS only; requires the CLI installed and signed in)." | "Signs in to Meta with a browser device code on any platform, then mints the Muse Code subscription key. If the Muse Code CLI is already signed in on macOS, the existing key is imported instead of starting a new grant." |
| "Meta ships no native Windows CLI and the Linux credential storage has not been measured, so on those platforms OpenCodex asks you to paste the Muse Code API key..." | "A pasted key from https://dev.meta.ai still works as a fallback if the device login cannot complete, and faces the same format check and live validation." |

The UNSUPPORTED-use paragraph and the billing warning are kept verbatim, plus one added
sentence: "A device login authenticates as Meta's own Muse Code client." The quota
sentence is rewritten in `030`, not here, because that is the phase that makes it false.

## Verification for this phase

`bun run test tests/providers/meta-muse-oauth.test.ts tests/providers/meta-muse-device.test.ts`
plus the order assertions listed in `040` §B. The existing 351-line test file must pass
**unmodified except for additions** — if an existing case needs editing, the no-regression
claim is false and that is a wp3 blocker, not a test to adjust.
