import { z } from 'zod';

/**
 * Code d'invitation lisible à voix haute : préfixe fixe + 4 caractères d'un
 * alphabet sans ambiguïté (pas de 0/O ni 1/I). Voir `domain/invite.ts`.
 */
export const InviteCodeSchema = z
  .string()
  .regex(/^BATCH-[A-HJ-NP-Z2-9]{4}$/, "Code d'invitation invalide");

export const HouseholdSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  members: z.array(z.string().min(1)).min(1).max(8),
  inviteCode: InviteCodeSchema.nullable(),
  createdAt: z.number().int(),
  createdBy: z.string().min(1),
});

/** Payload de la callable `joinHousehold`. */
export const JoinHouseholdInputSchema = z.object({
  inviteCode: InviteCodeSchema,
});

export const JoinHouseholdResultSchema = z.object({
  householdId: z.string().min(1),
  name: z.string(),
});

export type Household = z.infer<typeof HouseholdSchema>;
export type InviteCode = z.infer<typeof InviteCodeSchema>;
export type JoinHouseholdInput = z.infer<typeof JoinHouseholdInputSchema>;
export type JoinHouseholdResult = z.infer<typeof JoinHouseholdResultSchema>;
