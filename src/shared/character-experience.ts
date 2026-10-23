import type { messages } from "../core/database/schema";

/** The persisted public shape is owned by the canonical schema and its admin mirror. */
export type CharacterExperience = NonNullable<
  typeof messages.$inferSelect.experience
>;

function publicText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function publicPhotoUrl(value: unknown): value is string {
  if (!publicText(value, 2048)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Copy only validated public fields; invalid optional parts never discard a reply. */
export function parseCharacterExperience(
  value: unknown,
): CharacterExperience | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as {
    thought?: unknown;
    photo?: unknown;
    relationship?: unknown;
  };
  const experience: CharacterExperience = {};
  if (publicText(input.thought, 120)) experience.thought = input.thought;
  const photo = input.photo as
    | Partial<Record<keyof NonNullable<CharacterExperience["photo"]>, unknown>>
    | null
    | undefined;
  if (
    typeof photo === "object" &&
    photo !== null &&
    !Array.isArray(photo) &&
    publicText(photo.id, 128) &&
    publicPhotoUrl(photo.url) &&
    publicText(photo.alt, 500) &&
    typeof photo.isMock === "boolean"
  ) {
    experience.photo = {
      id: photo.id,
      url: photo.url,
      alt: photo.alt,
      isMock: photo.isMock,
    };
  }
  const relationship = input.relationship as
    | Partial<
        Record<keyof NonNullable<CharacterExperience["relationship"]>, unknown>
      >
    | null
    | undefined;
  if (
    typeof relationship === "object" &&
    relationship !== null &&
    !Array.isArray(relationship) &&
    typeof relationship.level === "number" &&
    Number.isInteger(relationship.level) &&
    relationship.level >= 1 &&
    relationship.level <= 5 &&
    publicText(relationship.label, 100) &&
    typeof relationship.progress === "number" &&
    Number.isFinite(relationship.progress) &&
    relationship.progress >= 0 &&
    relationship.progress <= 1 &&
    (relationship.level !== 5 || relationship.progress === 1) &&
    (relationship.change === "closer" ||
      relationship.change === "steady" ||
      relationship.change === "distant")
  ) {
    experience.relationship = {
      level: relationship.level,
      label: relationship.label,
      progress: relationship.progress,
      change: relationship.change,
    };
  }
  return Object.keys(experience).length ? experience : undefined;
}
