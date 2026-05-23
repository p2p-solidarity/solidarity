/**
 * Passport pipeline — mirrors Swift PassportPipelineService.swift.
 *
 * Orchestrates: MRZ scan → NFC read → ZK proof gen → VC issuance.
 * Each stage emits a `PassportStep` so the UI (PassportOnboardingFlowView
 * port) can render progress without polling.
 *
 * The pipeline is a pure async function with onStep callback rather than a
 * Zustand store; consumers wrap it in a hook that mirrors progress into a
 * SharedValue (per aniseekr-expo rule 9 — high-frequency state stays off
 * the React render path).
 */
import type { PassportMRZ, PassportReadResult } from '@solidarity/nitro-nfc-passport';

export type PassportStep =
  | { readonly type: 'mrzScanned'; readonly mrz: PassportMRZ }
  | { readonly type: 'nfcReading' }
  | { readonly type: 'nfcRead'; readonly result: PassportReadResult }
  | { readonly type: 'proofGenerating' }
  | { readonly type: 'proofGenerated'; readonly proof: ArrayBuffer }
  | { readonly type: 'vcIssued'; readonly jwt: string }
  | { readonly type: 'error'; readonly message: string };

export interface PassportPipelineDeps {
  /** Reads the chip via the nfc-passport Nitro module. */
  readonly readChip: (mrz: PassportMRZ) => Promise<PassportReadResult>;
  /** Generates the ZK proof via the passport-zk Nitro module. */
  readonly generateProof: (chipData: PassportReadResult) => Promise<ArrayBuffer>;
  /** Mints + signs the W3C VC for the verified passport claims. */
  readonly issueVc: (
    chipData: PassportReadResult,
    proof: ArrayBuffer
  ) => Promise<string>;
}

/**
 * Run the full pipeline. `onStep` fires for every intermediate stage so the
 * UI can render granular progress. Throws on hard failures (NFC error,
 * proof generation failure) so the caller can render a retry sheet.
 */
export async function runPassportPipeline(
  mrz: PassportMRZ,
  deps: PassportPipelineDeps,
  onStep: (step: PassportStep) => void
): Promise<string> {
  onStep({ type: 'mrzScanned', mrz });

  onStep({ type: 'nfcReading' });
  const chip = await deps.readChip(mrz);
  onStep({ type: 'nfcRead', result: chip });

  onStep({ type: 'proofGenerating' });
  const proof = await deps.generateProof(chip);
  onStep({ type: 'proofGenerated', proof });

  const vcJwt = await deps.issueVc(chip, proof);
  onStep({ type: 'vcIssued', jwt: vcJwt });
  return vcJwt;
}
