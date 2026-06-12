/**
 * Holder-side flow hook for `passport_show_v1` presentations (spec:
 * docs/superpowers/specs/2026-06-12-passport-show-presentation-design.md).
 *
 * One reducer-shaped state machine per CLAUDE.md Rule 9 (a single feature
 * hook owns the async resource):
 *
 *   idle ──beginChallengeScan──→ scanning-challenge ──onChallengeScanned──→
 *   proving ──→ ready | error          idle ──presentTimeBucket──→ proving …
 *
 * Proving = load vaulted witness → swap nonce/today/disclosure →
 * Face-ID-gated device signature → openac_show proof → sce1 + sqc1 pages.
 */
import { useCallback, useRef, useState } from 'react';

import { utf8ToBytes, base64Decode } from '@solidarity/shared';

import { compressForQR } from '@/cards/qrCompression';
import { signOpenAcDeviceBindingDigest } from '@/keychain';
import {
  buildPresentationQrPages,
  type PresentationQRPage,
} from '@/me/presentationQrPages';
import { loadPassportNitroModules } from '@/passport/nitroModules';
import { arrayBufferToBase64 } from '@/passport/pipeline';
import {
  createProofStageTimer,
  withTimedProver,
  withTimedSigner,
} from '@/passport/proofTiming';
import {
  PASSPORT_SHOW_LINK_SCOPE,
  derivePassportShowBucketNonceHash,
  generatePassportShowPresentation,
  parsePassportShowChallengeJson,
  type PassportShowDisclosure,
  type PassportShowFreshness,
  type PassportShowToday,
} from '@/passport/showPresentation';
import { loadPassportShowWitness } from '@/passport/showWitnessVault';
import {
  filterPassportShowPresentationClaims,
  passportShowSelectedClaimTypes,
} from '@/passport/presentationClaims';
import type { ProvableClaimEntity } from '@/identity/entities';

export type PassportShowFlowState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'scanning-challenge' }
  | { readonly phase: 'proving'; readonly message: string }
  | {
      readonly phase: 'ready';
      readonly pages: readonly PresentationQRPage[];
      readonly freshness: PassportShowFreshness;
    }
  | { readonly phase: 'error'; readonly message: string };

export interface UsePassportShowPresentationArgs {
  readonly credentialId: string;
  readonly holderDid: string;
  readonly selectedClaims: readonly ProvableClaimEntity[];
}

export interface PassportShowPresentationFlow {
  readonly state: PassportShowFlowState;
  readonly beginChallengeScan: () => void;
  readonly cancelChallengeScan: () => void;
  readonly onChallengeScanned: (payload: string) => void;
  readonly presentTimeBucket: () => void;
  readonly reset: () => void;
}

function disclosureFromClaims(
  claims: readonly ProvableClaimEntity[]
): PassportShowDisclosure {
  return {
    discloseAge: claims.some((claim) => claim.claimType === 'age_over_18'),
    discloseNationality: claims.some(
      (claim) => claim.claimType === 'nationality'
    ),
  };
}

function utcToday(): PassportShowToday {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

export function usePassportShowPresentation(
  args: UsePassportShowPresentationArgs
): PassportShowPresentationFlow {
  const [state, setState] = useState<PassportShowFlowState>({ phase: 'idle' });
  const proving = useRef(false);

  const prove = useCallback(
    (nonceHash: Uint8Array, freshness: PassportShowFreshness) => {
      if (proving.current) return;
      proving.current = true;
      setState({ phase: 'proving', message: 'Preparing witness…' });
      void (async () => {
        const timer = createProofStageTimer('show');
        try {
          const witnessBundleJson = await loadPassportShowWitness(
            args.credentialId
          );
          timer.mark('witness-load');
          if (witnessBundleJson === null) {
            throw new Error(
              'No show witness stored for this credential — re-scan the passport once to enable fresh presentations.'
            );
          }
          const zk = loadPassportNitroModules().zk;
          timer.mark('nitro-load');
          if (zk === null) {
            throw new Error('ZK prover is not linked on this build.');
          }
          setState({
            phase: 'proving',
            message: 'Generating fresh presentation proof…',
          });
          const showClaims = filterPassportShowPresentationClaims(args.selectedClaims);
          const { envelopeJson } = await generatePassportShowPresentation({
            witnessBundleJson,
            nonceHash,
            today: utcToday(),
            disclosure: disclosureFromClaims(showClaims),
            freshness,
            holderDid: args.holderDid,
            selectedClaims: passportShowSelectedClaimTypes(showClaims),
            signDeviceDigest: withTimedSigner(signOpenAcDeviceBindingDigest, timer),
            prover: withTimedProver(zk, timer),
            encodeProofBytes: arrayBufferToBase64,
            selfVerify: typeof __DEV__ !== 'undefined' ? __DEV__ : true,
          });
          const payload = compressForQR(utf8ToBytes(envelopeJson)) ?? envelopeJson;
          const pages = buildPresentationQrPages(payload);
          timer.mark('compress+qr-pages');
          console.log(
            `[zk:timing] flow=show stage=total ms=${String(timer.totalMs())}`
          );
          setState({
            phase: 'ready',
            pages,
            freshness,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setState({ phase: 'error', message });
        } finally {
          proving.current = false;
        }
      })();
    },
    [args.credentialId, args.holderDid, args.selectedClaims]
  );

  const onChallengeScanned = useCallback(
    (payload: string) => {
      const challenge = parsePassportShowChallengeJson(payload);
      if (challenge === null) {
        setState({
          phase: 'error',
          message: 'Scanned QR is not a verifier challenge.',
        });
        return;
      }
      if (challenge.scope !== PASSPORT_SHOW_LINK_SCOPE) {
        setState({
          phase: 'error',
          message: 'Challenge scope does not match this credential.',
        });
        return;
      }
      prove(base64Decode(challenge.nonceHashB64), 'challenge');
    },
    [prove]
  );

  const presentTimeBucket = useCallback(() => {
    prove(
      derivePassportShowBucketNonceHash(PASSPORT_SHOW_LINK_SCOPE, new Date()),
      'time-bucket'
    );
  }, [prove]);

  const beginChallengeScan = useCallback(() => {
    setState({ phase: 'scanning-challenge' });
  }, []);
  const cancelChallengeScan = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);
  const reset = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

  return {
    state,
    beginChallengeScan,
    cancelChallengeScan,
    onChallengeScanned,
    presentTimeBucket,
    reset,
  };
}
