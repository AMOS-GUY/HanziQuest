import type { FieldSpec } from "@/components/admin/admin-form";

const LICENSE = ["UNKNOWN", "OPEN_LICENSE", "LICENSED", "ORIGINAL", "PUBLIC_FACT"].map((v) => ({
  value: v,
  label: v.replace("_", " ").toLowerCase(),
}));
const VERIFICATION = [
  { value: "PROVISIONAL", label: "Provisional" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "VERIFIED", label: "Verified (shown as official)" },
];

type Values = { [key: string]: unknown };

export function characterFields(values: Values = {}, isNew = false): FieldSpec[] {
  const v = values as Record<string, string | null | undefined>;
  return [
    ...(isNew
      ? [
          {
            name: "hanzi",
            label: "Character",
            required: true,
            hanzi: true,
            help: "Stroke data is added automatically when the open dataset has it.",
          },
        ]
      : []),
    {
      name: "pinyin",
      label: "Pinyin",
      required: true,
      defaultValue: v.pinyin,
      help: "Tone marks, e.g. nǐ",
    },
    {
      name: "pinyinAlternatives",
      label: "Other readings",
      defaultValue: v.pinyinAlternatives,
      help: "Comma separated",
    },
    { name: "meaning", label: "Meaning", required: true, defaultValue: v.meaning, wide: true },
    { name: "traditional", label: "Traditional form", defaultValue: v.traditional, hanzi: true },
    { name: "radical", label: "Radical", defaultValue: v.radical, hanzi: true },
    {
      name: "source",
      label: "Source",
      required: true,
      defaultValue: v.source ?? "HanziQuest editors",
      wide: true,
    },
    {
      name: "licenseStatus",
      label: "License",
      type: "select",
      options: LICENSE,
      defaultValue: v.licenseStatus ?? "ORIGINAL",
    },
    {
      name: "verification",
      label: "Verification",
      type: "select",
      options: VERIFICATION,
      defaultValue: v.verification ?? "PROVISIONAL",
    },
  ];
}

export function vocabularyFields(values: Values = {}, isNew = false): FieldSpec[] {
  const v = values as Record<string, string | null | undefined>;
  return [
    ...(isNew
      ? [
          { name: "simplified", label: "Word (simplified)", required: true, hanzi: true },
          { name: "pinyin", label: "Pinyin", required: true, help: "Tone marks, e.g. nǐ hǎo" },
        ]
      : []),
    { name: "meaning", label: "Meaning", required: true, defaultValue: v.meaning, wide: true },
    { name: "traditional", label: "Traditional", defaultValue: v.traditional, hanzi: true },
    { name: "partOfSpeech", label: "Part of speech", defaultValue: v.partOfSpeech },
    {
      name: "exampleZh",
      label: "Example (Chinese)",
      defaultValue: v.exampleZh,
      hanzi: true,
      wide: true,
    },
    { name: "examplePinyin", label: "Example (pinyin)", defaultValue: v.examplePinyin, wide: true },
    { name: "exampleEn", label: "Example (English)", defaultValue: v.exampleEn, wide: true },
    {
      name: "source",
      label: "Source",
      required: true,
      defaultValue: v.source ?? "HanziQuest editors",
      wide: true,
    },
    {
      name: "licenseStatus",
      label: "License",
      type: "select",
      options: LICENSE,
      defaultValue: v.licenseStatus ?? "ORIGINAL",
    },
    {
      name: "verification",
      label: "Verification",
      type: "select",
      options: VERIFICATION,
      defaultValue: v.verification ?? "PROVISIONAL",
    },
  ];
}
