# Legal and policy items for the owner

The privacy notice (`/privacy`), beta terms (`/terms`), handwriting-pilot consent script
(`docs/HANDWRITING_PILOT.md`) and beta guide are **drafts written by the development team. They
have not been reviewed by a lawyer.** They make no claim of compliance with any law (GDPR,
CCPA, PIPL, COPPA or others). Before public launch, the operator should have them reviewed for
the countries where HanziQuest will be offered.

Each page shows a visible "draft" notice. Learners accept version `LEGAL_VERSION`
(`src/features/legal/version.ts`). Bump it when the documents change materially; learners are
then asked to accept again (the prompt is shown in the app, and acceptance is audited).

## Placeholders to fill (search for `[` in the pages)

- Operator name and address, contact, privacy and security contact emails
- Hosting, database and error-reporting providers and the data region (see `docs/HOSTING.md`)
- Retention periods: audit/security logs, feedback, backups
- Rights and complaint routes for the operator's jurisdiction
- Minimum age and parental consent
- Limitation-of-liability wording and governing law

## Decisions the owner should make

1. **Age:** what is the minimum age? Children's data rules may need parental consent flows,
   which aren't built.
2. **Data export:** there is no self-service export. Decide whether to build one or handle
   requests by hand.
3. **Audit log retention:** IP addresses and user agents are stored in audit entries. Choose a
   retention period and schedule the deletion (not automated yet).
4. **Handwriting samples:** decide whether pilot participants sign a written consent form
   instead of the spoken consent recorded by staff.
5. **Processor agreements:** sign the data processing agreements offered by the chosen hosting
   and database providers.
6. **Cross-border transfers:** if learners are in a different region from the database,
   check what disclosures are needed.

Until these are done, keep the beta **invite-only** (share the link with known testers rather
than advertising it).
