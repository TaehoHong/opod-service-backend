export type CharacterSocialActivityClaim = {
  id: bigint;
  characterId: string;
  leaseToken: string;
  attemptCount: number;
};

export type CharacterActivityContext = {
  status: string;
  timezone: string | null;
  validTimezone: boolean;
  localTime: string | null;
  dayStart: Date | null;
  dayEnd: Date | null;
  interests: string[];
};
