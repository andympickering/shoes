import { parseArticleSearch } from "@/lib/article-search";

export type AlertTimeSpan = "today" | "last_3_days" | "last_week";
export type AlertFrequency = "daily" | "weekly" | "monthly";

export interface AlertSettings {
  searchTerms: string;
  timeSpan: AlertTimeSpan;
  frequency: AlertFrequency;
  deliveryTimeUtc: string;
  emails: string[];
}

const timeSpans: AlertTimeSpan[] = ["today", "last_3_days", "last_week"];
const frequencies: AlertFrequency[] = ["daily", "weekly", "monthly"];
const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAlertSettings(value: unknown) {
  if (!isRecord(value)) {
    return { error: "Invalid alert details." } as const;
  }

  const searchTerms =
    typeof value.searchTerms === "string" ? value.searchTerms.trim() : "";
  if (!searchTerms || searchTerms.length > 200) {
    return { error: "Search terms must be between 1 and 200 characters." } as const;
  }
  try {
    parseArticleSearch(searchTerms);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid search expression.",
    } as const;
  }

  const timeSpan = value.timeSpan;
  if (typeof timeSpan !== "string" || !timeSpans.includes(timeSpan as AlertTimeSpan)) {
    return { error: "Choose a valid alert timespan." } as const;
  }
  const frequency = value.frequency;
  if (typeof frequency !== "string" || !frequencies.includes(frequency as AlertFrequency)) {
    return { error: "Choose a valid delivery frequency." } as const;
  }

  const deliveryTimeUtc =
    typeof value.deliveryTimeUtc === "string" ? value.deliveryTimeUtc : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTimeUtc)) {
    return { error: "Enter a valid UTC delivery time." } as const;
  }

  if (value.consent !== true) {
    return {
      error: "Confirm that the listed recipients agreed to receive alerts.",
    } as const;
  }

  if (typeof value.emails !== "string") {
    return {
      error: "Enter 1 to 10 valid email addresses, separated by semicolons.",
    } as const;
  }
  const suppliedEmails = value.emails
    .split(";")
    .map((email) => email.trim())
    .filter(Boolean);
  const emails = Array.from(
    new Map(suppliedEmails.map((email) => [email.toLowerCase(), email])).values()
  );
  if (
    emails.length < 1 ||
    emails.length > 10 ||
    emails.some((email) => email.length > 254 || !emailPattern.test(email))
  ) {
    return {
      error: "Enter 1 to 10 valid email addresses, separated by semicolons.",
    } as const;
  }

  return {
    settings: {
      searchTerms,
      timeSpan: timeSpan as AlertTimeSpan,
      frequency: frequency as AlertFrequency,
      deliveryTimeUtc,
      emails,
    } satisfies AlertSettings,
  } as const;
}
