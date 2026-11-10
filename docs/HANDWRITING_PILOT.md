# Handwriting pilot: five testers

A first, small, real-world check of the handwriting engine before inviting more people. It
uses the Handwriting lab (`/admin/handwriting`). The full study design is in
`HANDWRITING_VALIDATION.md`.

**Status: ready to run. No human samples have been collected yet.** Samples recorded by
automated tests use participant codes starting with `TEST` and are excluded from every result.

## What you need

- A staff account with the Curriculum Editor or Super Admin role (`handwriting:validate`).
- About 25 minutes per tester.
- A mix of devices across the five testers. Aim for at least two phones (finger), one tablet
  with a stylus, and one laptop (mouse or trackpad).
- A mix of writers: at least two complete beginners, at least one learner with a year or more
  of study, and if possible one native or heritage writer and one left-handed writer.

## Tester IDs

Use `P01` to `P05`, in the order you meet testers. The lab tracks progress for these codes
(0–36 each). **Never** type a name, email, phone number or initials. If you need to know who
was who (for example to delete someone's samples later), keep that list on paper or in a
private note outside HanziQuest, and destroy it when the study ends.

## Consent (read or give this to the tester before starting)

> We're testing how well HanziQuest's handwriting checker works. We'll ask you to write about
> 36 Chinese characters on this screen. Some you'll write normally, and a few you'll write
> wrong on purpose (we'll tell you how).
>
> We store only the pen strokes you draw (positions and timing), the device type, and a code
> like "P03". We don't record your name, voice, face or anything else about you.
>
> The strokes are used only to test and improve the checker. They may be kept for testing
> future versions. You can stop at any time, and you can ask us to delete your samples later
> by telling us your code.
>
> Is that OK with you?

Only after a clear "yes" do you tick the consent box in the lab. If they say no, don't record.

_This consent text is a draft written for the pilot. It hasn't been reviewed by a lawyer or an
ethics board. If your organisation or country requires review for research with people, get
it before running the pilot._

## Running a session

1. Open `/admin/handwriting`, choose the tester's code (P01–P05) under **Pilot: five
   testers**, and tick the consent box once they agree.
2. Set **Input** to how they'll write (finger, stylus, mouse or trackpad). Screen size,
   browser and OS are captured automatically as coarse facts.
3. The recorder shows the next prompt: the character, and a sentence to **say** to the tester
   (for example "Write it but draw one long stroke backwards"). Show them the character if
   they don't know it, then hide it before they write.
4. Let them write. Don't coach stroke order on the "write it normally" prompts.
5. Press **Record**. The engine's verdict appears; don't share it with the tester until the
   end, so it doesn't change how they write.
6. Repeat until the lab shows 36/36. If a prompt went wrong (interrupted, or they wrote
   something else), press **Clear** and redo it before recording. If something was recorded
   by mistake, note the time in your private notes so it can be removed.
7. Thank them. Optionally ask: "Did any feedback seem wrong or unfair to you?" and note the
   answers (without names) in Admin → Feedback, as kind "Handwriting".

Each tester gets every pilot character written correctly twice (once normally, once small or
fast) plus one deliberate error. The error types rotate per tester, so across five testers
every character gets several different error types.

## After the pilot

1. Run `npm run handwriting:report > docs/handwriting-pilot-YYYY-MM-DD.md` against the
   production database.
2. Check the export (`/api/admin/handwriting/samples?strokes=1`) for odd samples, such as
   blank or clearly mis-labelled ones.
3. Record the results in `docs/PROGRESS.md`: false rejection, structural false acceptance,
   wrong-character acceptance, technique errors judged, and per-device numbers.
4. **Five testers is too few to tune thresholds** (the lab warns below 15 participants and 300
   samples each way). The pilot answers whether anything is badly wrong, for example
   one device type being rejected far more often. Report it as a pilot, not as validation.

### Stop-and-fix signals

- False rejection above 25 % for any device type.
- **Any** wrong character accepted (structural false acceptance on WRONG_CHARACTER).
- Testers report feedback that is clearly wrong (for example "stroke 3 is backwards" when it
  isn't) more than occasionally.
