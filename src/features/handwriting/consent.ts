/**
 * Versions of the written pilot consent form (docs/M12_PILOT_PROTOCOL.md section 4).
 *
 * The signed form stays on paper. The app records which version a participant code accepted
 * and when, and refuses to record samples without a current, unrevoked acceptance.
 *
 * `ownerApproved` is the gate for real participants: while it's false, only TEST rehearsal
 * codes can be given consent, so no real handwriting can be collected. Flipping it is a
 * reviewed code change made only after the owner approves the form (and fills in its blanks).
 */
export interface ConsentFormVersion {
  version: string;
  title: string;
  ownerApproved: boolean;
}

export const PILOT_CONSENT_FORMS: readonly ConsentFormVersion[] = [
  {
    version: "pilot-v0.1",
    title: "HanziQuest handwriting pilot: draft consent form v0.1",
    ownerApproved: false,
  },
];

/** The only version new acceptances may be recorded for. */
export const CURRENT_PILOT_CONSENT_VERSION = "pilot-v0.1";

export function consentForm(version: string) {
  return PILOT_CONSENT_FORMS.find((f) => f.version === version) ?? null;
}

export function currentConsentForm(): ConsentFormVersion {
  const form = consentForm(CURRENT_PILOT_CONSENT_VERSION);
  if (!form) throw new Error(`Unknown current consent version ${CURRENT_PILOT_CONSENT_VERSION}`);
  return form;
}
