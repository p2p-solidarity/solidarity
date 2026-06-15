/**
 * GroupCredentialService — TS port of
 * solidarity/Services/Identity/GroupCredentialService.swift's issuance
 * path. The group owner signs an ES256 VC JWT binding a member DID to the
 * group's current Merkle root and persists the result to the receiver's
 * identity data store so the credential surfaces in the Me tab.
 *
 * Claim layout mirrors Swift's `GroupCredentialContext.GroupCredentialInfo`
 * plus an embedded `verifiableCredential` body so existing VC pipelines
 * (verifyVcJwt, proofVerifier) accept the JWT without a schema bump.
 */
import {
  err,
  ok,
  type CardError,
  type Result,
} from '@solidarity/shared';

import { signJwt } from '@/keychain/signingKey';
import { useIdentityCoordinator } from '@/identity/coordinator';
import { useIdentityData } from '@/identity/dataStore';
import type { IdentityCardEntity, TrustLevel } from '@/identity/entities';

import {
  CURRENT_USER_RECORD_ID,
  canIssueCredentials,
  type GroupModel,
} from './store';

export type IdentityError = CardError;

const GROUP_VC_TYPE = 'GroupMembershipCredential';

interface GroupCredentialPayload {
  readonly iss: string;
  readonly sub: string;
  readonly iat: number;
  readonly nbf: number;
  readonly vc: {
    readonly '@context': readonly string[];
    readonly type: readonly ['VerifiableCredential', typeof GROUP_VC_TYPE];
    readonly credentialSubject: {
      readonly id: string;
      readonly groupId: string;
      readonly groupName: string;
      readonly merkleRoot: string;
      readonly issuedBy: string;
      readonly issuedAt: string;
      readonly proofRequired: boolean;
      readonly trustLevel: TrustLevel;
      readonly claims: Record<string, unknown>;
    };
  };
  readonly trustLevel: TrustLevel;
}

function uuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function issueGroupCredential(opts: {
  readonly group: GroupModel;
  readonly memberDid: string;
  readonly trustLevel: TrustLevel;
  readonly claims: Record<string, unknown>;
}): Promise<Result<IdentityCardEntity>> {
  if (!canIssueCredentials(opts.group)) {
    return err<IdentityError>({
      type: 'unauthorized',
      message: 'Current user is not allowed to issue credentials for this group',
    });
  }
  if (!opts.group.merkleRoot) {
    return err<IdentityError>({
      type: 'validationError',
      message: 'Group is missing Merkle root',
    });
  }

  const issuerDid = useIdentityCoordinator.getState().profile.activeDID?.did;
  if (!issuerDid) {
    return err<IdentityError>({
      type: 'keyManagementError',
      message: 'Active issuer DID not available',
    });
  }

  try {
    const issuedAt = new Date();
    const iat = Math.floor(issuedAt.getTime() / 1000);
    const payload: GroupCredentialPayload = {
      iss: issuerDid,
      sub: opts.memberDid,
      iat,
      nbf: iat,
      vc: {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiableCredential', GROUP_VC_TYPE],
        credentialSubject: {
          id: opts.memberDid,
          groupId: opts.group.id,
          groupName: opts.group.name,
          merkleRoot: opts.group.merkleRoot,
          issuedBy: CURRENT_USER_RECORD_ID,
          issuedAt: issuedAt.toISOString(),
          proofRequired: true,
          trustLevel: opts.trustLevel,
          claims: opts.claims,
        },
      },
      trustLevel: opts.trustLevel,
    };

    const jwt = await signJwt(
      { alg: 'ES256', typ: 'JWT', kid: `${issuerDid}#keys-1` },
      payload as unknown as Record<string, unknown>
    );

    const card: IdentityCardEntity = {
      id: uuidV4(),
      type: GROUP_VC_TYPE,
      issuerType: 'group',
      trustLevel: opts.trustLevel,
      title: opts.group.name,
      issuerDid,
      holderDid: opts.memberDid,
      issuedAt,
      status: 'verified',
      sourceReference: opts.group.id,
      rawCredentialJWT: jwt,
      metadataTags: ['group', opts.group.id],
      createdAt: issuedAt,
      updatedAt: issuedAt,
    };

    await useIdentityData.getState().upsertIdentityCard(card);
    return ok(card);
  } catch (error) {
    return err<IdentityError>({
      type: 'cryptographicError',
      message: `Failed to issue group credential: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
