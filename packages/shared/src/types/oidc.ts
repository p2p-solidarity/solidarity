/**
 * OIDC / OID4VP / OID4VCI schemas — mirror solidarity/Models/OIDC/OIDCScope.swift.
 *
 * Wire format: snake_case per OAuth/OIDC convention; Zod schemas accept the
 * wire shape directly so URL queryparam → object parse is one step.
 */
import { z } from 'zod';

export const oidcScopeSchema = z.enum([
  'backup_write',
  'backup_read',
  'preferences',
  'age_over_18',
  'decrypt_content',
  'config_sync',
]);
export type OIDCScope = z.infer<typeof oidcScopeSchema>;

export const oidcRiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type OIDCRiskLevel = z.infer<typeof oidcRiskLevelSchema>;

const RISK_BY_SCOPE: Readonly<Record<OIDCScope, OIDCRiskLevel>> = {
  backup_read: 'low',
  preferences: 'low',
  age_over_18: 'medium',
  config_sync: 'medium',
  backup_write: 'high',
  decrypt_content: 'high',
};
export const riskLevel = (s: OIDCScope): OIDCRiskLevel => RISK_BY_SCOPE[s];

export const inputDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  purpose: z.string().optional(),
});
export type InputDescriptor = z.infer<typeof inputDescriptorSchema>;

export const presentationDefinitionSchema = z.object({
  id: z.string().min(1),
  input_descriptors: z.array(inputDescriptorSchema),
});
export type PresentationDefinition = z.infer<typeof presentationDefinitionSchema>;

export const oidcAuthRequestSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  state: z.string().min(1),
  nonce: z.string().min(1),
  scope: z.string().transform((s) =>
    s.split(/\s+/u).filter(Boolean).map((tok) => oidcScopeSchema.parse(tok))
  ),
  response_type: z.string().default('vp_token id_token'),
  response_mode: z.enum(['direct_post', 'fragment', 'query']).default('direct_post'),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
  presentation_definition: presentationDefinitionSchema.optional(),
  client_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type OIDCAuthRequest = z.infer<typeof oidcAuthRequestSchema>;

export const oidcAuthResponseSchema = z.object({
  state: z.string().min(1),
  code: z.string().optional(),
  id_token: z.string().optional(),
  vp_token: z.union([z.string(), z.array(z.string())]).optional(),
  presentation_submission: z.unknown().optional(),
});
export type OIDCAuthResponse = z.infer<typeof oidcAuthResponseSchema>;

export const oidcClientInfoSchema = z.object({
  client_id: z.string().min(1),
  display_name: z.string().optional(),
  icon_url: z.url().optional(),
  trusted: z.boolean().default(false),
  last_used: z.coerce.date().optional(),
});
export type OIDCClientInfo = z.infer<typeof oidcClientInfoSchema>;
