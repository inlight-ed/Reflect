---
name: Demo localization contract
description: Rules for keeping SHIFT/MARKET interface and demo content fully localized without translating user content.
---

All UI-owned text and API-provided demo copy must have equivalents in Russian, Kazakh, and English before it is rendered. This includes statuses, activity labels, demo insights, connector details, and static demo categories. Names and values entered by a user, such as a newly created campaign name, remain unchanged.

**Why:** A localized shell alone can hide mixed-language demo cards and system states, creating an inconsistent analytics workflow and making demo content look less intentional.

**How to apply:** When adding a UI string or demo API field, pass it through the common translation layer and add all three locale entries. Verify each affected route in Russian, Kazakh, and English, including empty, error, and connector-result states.

When an API-owned status or connector detail has no known translation, show a localized safe generic message rather than the raw response. Keep ordinary translation lookup lossless so known catalog copy and user-entered names are not replaced with a generic label.

**Why:** Source systems can add diagnostics without warning. Showing those strings mixes languages or exposes implementation detail, while applying a generic fallback globally hides valid content that has not yet been catalogued.

**How to apply:** Use the safe localized fallback only at API/system-text rendering boundaries (such as connector status, source detail, and transport errors). Add explicit ru, kk, and en entries for every expected response before release.

Connector details owned by the API must be stable OpenAPI message-key enum values, and their locale catalog must be typed against that enum for Russian, Kazakh, and English.

**Why:** A string field permits a new connector response to ship with untranslated copy even when the UI has a safe fallback. The enum and typed catalog turn an omitted translation into a build and contract-test failure.

**How to apply:** Add the key to the API enum first, regenerate API clients, then add all three catalog entries. Keep the UI boundary on the dedicated connector-message translator so an unknown runtime value still receives a localized safe fallback.

For Kazakh monetary values, normalize the rendered value after `Intl` formatting so the decimal separator and tenge suffix are consistent across browser ICU implementations.

**Why:** Different browser runtimes can produce a prefix with a dot (`₸ 92.40`) for `kk-KZ`, while the product displays Kazakh analytics as `92,40 ₸`. Relying only on the runtime default makes both the UI and browser tests inconsistent.

**How to apply:** Keep the `kk` currency format stable in the shared formatting layer and assert the expected Kazakh presentation in end-to-end coverage rather than depending on the host browser's locale data.