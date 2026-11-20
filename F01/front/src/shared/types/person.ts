/**
 * Frontend role constants.
 * Provides a single source of truth for role string values used in API calls and UI.
 */
export const PersonRole = {
  CONSUMER: 'CONSUMER' as const,
  VENDOR: 'VENDOR' as const,
  ADMIN: 'ADMIN' as const,
} as const;

export type PersonRole = typeof PersonRole[keyof typeof PersonRole];