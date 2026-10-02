export const DEFAULT_BUILDING_TIME_ZONE = "Europe/Brussels";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Retourne la date civile observée dans le fuseau métier, sans conversion UTC approximative. */
export function localBusinessDate(now = new Date(), timeZone = DEFAULT_BUILDING_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Valide une date civile métier. La révocation, elle, est horodatée séparément. */
export function parseMembershipEndDate(
  value: unknown,
  now = new Date(),
  timeZone = DEFAULT_BUILDING_TIME_ZONE,
): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw new Error("La date de fin est invalide");
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error("La date de fin est invalide");
  }
  if (value > localBusinessDate(now, timeZone)) throw new Error("La date de fin ne peut pas être future");
  return value;
}
