/**
 * PassportSteps — extracted body of the passport-setup screen so
 * app/passport/index.tsx stays within the 500-line lint budget.
 *
 * Each subview mirrors the matching block in Swift
 * PassportOnboardingFlowView{,+Steps}.swift:
 *   NfcStep         → `nfcStep`
 *   ChipSnapshotCard → `chipSnapshotCard(_:)`
 *   AuthBadge       → `authBadge(_:passed:)`
 *   ProofStep       → `proofStepSection`
 *   ProofResultCard → `proofResultCard(_:)`
 *   PersistStep     → `persistStepSection`
 *
 * They take props rather than reading the view-model directly so the
 * page-level reducer remains the single source of truth.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { BulletGuaranteeRow } from '@/components/passport/BulletGuaranteeRow';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  credentialTrustDisplayFor,
  passportTrustLevelFromProof,
  type TrustDisplayTone,
} from '@/credentials/trustDisplay';
import { useTranslation } from '@/i18n';
import type {
  PassportChipSnapshot,
  PassportProofResult,
} from '@/passport/pipeline';
import { DEFAULT_DISCLOSURE_POLICY } from '@/passport/zkInputs';

export function NfcStep({
  busy,
  progress,
  progressPercent,
  progressPhase,
  chip,
  developerMode,
  onRead,
}: {
  readonly busy: boolean;
  readonly progress: string;
  /** 0..100 from the native NfcReadProgress callback. */
  readonly progressPercent: number;
  /**
   * Coarse phase. Used to colour the bar and to skip the determinate
   * fill on `connecting` (where we don't actually know how long the user
   * will take to tap the chip).
   */
  readonly progressPhase:
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'reading-dg'
    | 'verifying'
    | 'done'
    | 'error';
  readonly chip: PassportChipSnapshot | null;
  readonly developerMode: boolean;
  readonly onRead: () => void;
}) {
  const { t } = useTranslation();
  const status = chip
    ? developerMode
      ? 'Chip read successfully.'
      : t('passportSetup.nfc.readComplete')
    : busy
      ? developerMode
        ? 'Hold steady — reading chip…'
        : t('passportSetup.nfc.reading')
      : developerMode
        ? 'Bring your passport close to the device to read NFC chip data.'
        : t('passportSetup.nfc.ready');
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <NfcVisual busy={busy} success={chip !== null} />
      <Text className="text-text2 px-6 text-center text-[15px]">{status}</Text>
      {busy ? (
        <View className="items-center gap-2">
          <NfcProgressBar percent={progressPercent} phase={progressPhase} />
          <Text className="text-text3 text-[12px]">
            {developerMode ? progress : t('passportSetup.nfc.reading')}
          </Text>
        </View>
      ) : null}
      {chip ? <ChipSnapshotCard chip={chip} developerMode={developerMode} /> : null}
      <ThemedButton
        label={
          developerMode
            ? chip
              ? 'Chip Read ✓'
              : 'Read NFC Chip'
            : chip
              ? t('passportSetup.nfc.complete')
              : t('passportSetup.nfc.read')
        }
        fullWidth
        disabled={busy || chip !== null}
        onPress={onRead}
      />
    </View>
  );
}

/**
 * Horizontal progress bar driven by native NfcReadProgress events.
 *
 *   `connecting`        → indeterminate spinner (we don't know when the
 *                          user will tap the chip)
 *   `authenticating`/   → determinate fill, terminalGreen
 *   `reading-dg`/
 *   `verifying`
 *   `done`              → filled, terminalGreen
 *   `error`             → filled, warning amber so a failed read doesn't
 *                          silently zero the bar
 *
 * Width animates via the React render path (low frequency — at most a
 * handful of updates per read), so a SharedValue is overkill here.
 */
function NfcProgressBar({
  percent,
  phase,
}: {
  readonly percent: number;
  readonly phase:
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'reading-dg'
    | 'verifying'
    | 'done'
    | 'error';
}) {
  if (phase === 'connecting' || phase === 'idle') {
    return <ActivityIndicator color={Colors.terminalGreen} />;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const tint = phase === 'error' ? Colors.warning : Colors.terminalGreen;
  return (
    <View style={progressStyles.track}>
      <View
        style={[
          progressStyles.fill,
          { width: `${clamped}%`, backgroundColor: tint },
        ]}
      />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    width: '85%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});

/**
 * NfcVisual — animated waveform above an iPhone outline.
 *
 *   • idle    → 3 concentric arcs pulse outward at 1.8s/cycle, staggered
 *                so the effect reads as a continuous ripple
 *   • busy    → same arcs, sped to 1.1s + tinted terminalGreen so the
 *                user can tell at a glance the chip read is in flight
 *   • success → arcs disappear, a single checkmark scale-ins from 0
 *                with a small bounce so the success moment lands
 *
 * Everything runs on the Reanimated UI thread (SharedValues + worklets);
 * the React render only fires on the three discrete state transitions.
 */
function NfcVisual({ busy, success }: { busy: boolean; success: boolean }) {
  if (success) {
    return (
      <View style={nfcStyles.container}>
        <SuccessCheck />
      </View>
    );
  }
  const duration = busy ? 1100 : 1800;
  const tint = busy ? Colors.terminalGreen : Colors.text2;
  return (
    <View style={nfcStyles.container}>
      <View style={nfcStyles.waveStack} pointerEvents="none">
        <NfcWaveArc delay={0} duration={duration} color={tint} />
        <NfcWaveArc delay={duration / 3} duration={duration} color={tint} />
        <NfcWaveArc delay={(2 * duration) / 3} duration={duration} color={tint} />
      </View>
      <View style={nfcStyles.phoneSlot}>
        <SfIcon name="iphone" size={56} color={Colors.text2} />
      </View>
    </View>
  );
}

const ARC_VIEWBOX = 100;
const ARC_RADIUS = 40;

function NfcWaveArc({
  delay,
  duration,
  color,
}: {
  delay: number;
  duration: number;
  color: string;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = 0;
    t.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
  }, [delay, duration, t]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.4 + t.value * 1.0 }],
    opacity: 1 - t.value,
  }));

  return (
    <Animated.View style={[nfcStyles.arc, animatedStyle]}>
      <Svg width={ARC_VIEWBOX} height={ARC_VIEWBOX / 2} viewBox={`0 0 ${ARC_VIEWBOX} ${ARC_VIEWBOX / 2}`}>
        <Path
          d={`M ${ARC_VIEWBOX / 2 - ARC_RADIUS} ${ARC_VIEWBOX / 2} A ${ARC_RADIUS} ${ARC_RADIUS} 0 0 1 ${ARC_VIEWBOX / 2 + ARC_RADIUS} ${ARC_VIEWBOX / 2}`}
          stroke={color}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

function SuccessCheck() {
  const scale = useSharedValue(0);
  useEffect(() => {
    scale.value = withTiming(1, {
      duration: 400,
      // Slight overshoot so the check "lands" with intent.
      easing: Easing.out(Easing.back(1.5)),
    });
  }, [scale]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={animatedStyle}>
      <SfIcon name="checkmark.seal.fill" size={56} color={Colors.terminalGreen} />
    </Animated.View>
  );
}

const nfcStyles = StyleSheet.create({
  container: { height: 130, alignItems: 'center', justifyContent: 'flex-end' },
  waveStack: {
    position: 'absolute',
    top: 0,
    width: ARC_VIEWBOX,
    height: ARC_VIEWBOX / 2 + 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  arc: {
    position: 'absolute',
    bottom: 0,
    width: ARC_VIEWBOX,
    height: ARC_VIEWBOX / 2,
  },
  phoneSlot: { marginTop: 4 },
});

function ChipSnapshotCard({
  chip,
  developerMode,
}: {
  readonly chip: PassportChipSnapshot;
  readonly developerMode: boolean;
}) {
  const { t } = useTranslation();
  if (!developerMode) {
    return (
      <View className="rounded-xl p-3" style={{ backgroundColor: Colors.mutedSurface, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SfIcon name="checkmark.circle.fill" size={14} color={Colors.terminalGreen} />
          <Text style={{ color: Colors.terminalGreen, fontSize: 12, fontWeight: '600' }}>
            {t('passportSetup.nfc.readComplete')}
          </Text>
        </View>
        <Text className="text-text3" style={{ fontSize: 12 }}>
          {t('passportSetup.nfc.readyToContinue')}
        </Text>
      </View>
    );
  }

  return (
    <View className="rounded-xl p-3" style={{ backgroundColor: Colors.mutedSurface, gap: 8 }}>
      {chip.isSimulated ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SfIcon name="exclamationmark.triangle.fill" size={14} color="#FF9500" />
          <Text style={{ color: '#FF9500', fontSize: 12, fontWeight: '600' }}>Simulated</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Text className="text-text3" style={{ fontSize: 10 }}>Nationality</Text>
          <Text className="text-text1" style={{ fontSize: 15, fontWeight: '600' }}>
            {chip.nationalityCode}
          </Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text className="text-text3" style={{ fontSize: 10 }}>Document</Text>
          <Text className="text-text1" style={{ fontSize: 15, fontFamily: 'Menlo' }}>
            {chip.maskedDocNumber}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <AuthBadge label="BAC" passed={chip.bacVerified} />
        <AuthBadge label="PACE" passed={chip.paceVerified} />
        <AuthBadge label="PA" passed={chip.passiveAuthPassed} />
      </View>

      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Text className="text-text3" style={{ fontSize: 10, fontWeight: '600' }}>DGs:</Text>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {chip.dataGroupsRead.join(', ')}
        </Text>
      </View>

      <View style={{ gap: 2 }}>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {`Doc hash: ${chip.documentHash.slice(0, 16)}...`}
        </Text>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {`MRZ digest: ${chip.mrzDigest.slice(0, 16)}...`}
        </Text>
      </View>
    </View>
  );
}

function AuthBadge({ label, passed }: { label: string; passed: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <SfIcon
        name={passed ? 'checkmark.circle.fill' : 'xmark.circle'}
        size={11}
        color={passed ? Colors.terminalGreen : Colors.text3}
      />
      <Text
        style={{
          color: passed ? Colors.terminalGreen : Colors.text3,
          fontSize: 10,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function ProofStep({
  busy,
  progress,
  proof,
  disabled,
  developerMode,
  onGenerate,
}: {
  readonly busy: boolean;
  readonly progress: string;
  readonly proof: PassportProofResult | null;
  readonly disabled: boolean;
  readonly developerMode: boolean;
  readonly onGenerate: () => void;
}) {
  const { t } = useTranslation();
  // Real disclosure decisions from the policy that actually runs in
  // `onGenerateProof` — not a fabricated list. Disclosed fields earn a
  // green check; hidden fields (e.g. Name under DEFAULT_DISCLOSURE_POLICY)
  // render a hollow badge so the screen never claims to share what it hides.
  const policyRows: readonly { text: string; checked: boolean }[] = [
    {
      text: t('passportProof.discloseNationality'),
      checked: DEFAULT_DISCLOSURE_POLICY.discloseNationality,
    },
    {
      text: t('passportProof.discloseAgeOver18'),
      checked: DEFAULT_DISCLOSURE_POLICY.discloseOlderThan,
    },
    {
      text: t('passportProof.discloseName'),
      checked: DEFAULT_DISCLOSURE_POLICY.discloseName,
    },
  ];
  return (
    <View className="gap-12 pt-8">
      <View className="items-center gap-4">
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="checkmark.shield" size={48} color={Colors.terminalGreen} />
        </View>
        <View className="items-center gap-2">
          <Text className="text-text1 text-center text-[16px] font-medium">
            {developerMode ? 'Create Privacy Proof' : t('passportSetup.proof.title')}
          </Text>
          <Text className="text-text2 px-8 text-center text-[14px]" style={{ lineHeight: 22 }}>
            {developerMode
              ? 'Securely generate a proof from your passport to verify your identity — without sharing raw data.'
              : t('passportSetup.proof.subtitle')}
          </Text>
        </View>
      </View>

      <View className="gap-8">
        <View className="gap-2 px-4">
          <Text className="text-text1 text-[14px]">
            {t('passportProof.selectiveDisclosures')}
          </Text>
          <View className="gap-2">
            <BulletGuaranteeRow text={t('passportProof.runsOnDevice')} />
            <BulletGuaranteeRow text={t('passportProof.noDataUploaded')} />
            {/* Real policy-derived rows — what DEFAULT_DISCLOSURE_POLICY
                actually shares vs hides for this proof. */}
            {policyRows.map((row) => (
              <BulletGuaranteeRow
                key={row.text}
                text={row.text}
                checked={row.checked}
              />
            ))}
          </View>
        </View>

        {busy ? (
          <View className="items-center gap-2">
            <ActivityIndicator color={Colors.terminalGreen} />
            <Text className="text-text3 text-[12px]">
              {developerMode ? progress : t('passportSetup.proof.preparing')}
            </Text>
          </View>
        ) : null}

        {proof ? <ProofResultCard proof={proof} developerMode={developerMode} /> : null}

        <View className="px-4">
          <ThemedButton
            label={developerMode ? 'Generate Proof' : t('passportSetup.proof.button')}
            fullWidth
            disabled={busy || disabled}
            onPress={onGenerate}
          />
        </View>
      </View>
    </View>
  );
}

function ProofResultCard({
  proof,
  developerMode,
}: {
  readonly proof: PassportProofResult;
  readonly developerMode: boolean;
}) {
  const { t } = useTranslation();
  if (!developerMode) {
    const unavailable = proof.generationFailed;
    return (
      <View
        className="mx-4 rounded-xl p-3"
        style={{ backgroundColor: Colors.mutedSurface, gap: 4 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SfIcon
            name={unavailable ? 'exclamationmark.triangle.fill' : 'checkmark.seal.fill'}
            size={14}
            color={unavailable ? Colors.warning : Colors.terminalGreen}
          />
          <Text
            style={{
              color: unavailable ? Colors.warning : Colors.terminalGreen,
              fontSize: 12,
              fontWeight: '600',
            }}
          >
            {unavailable ? t('passportSetup.proof.unavailable') : t('passportSetup.proof.ready')}
          </Text>
        </View>
        <Text className="text-text3" style={{ fontSize: 12 }}>
          {unavailable
            ? t('passportSetup.proof.unavailableBody')
            : t('passportSetup.proof.readyBody')}
        </Text>
      </View>
    );
  }

  const failed = proof.generationFailed;
  const storedTrustLevel = passportTrustLevelFromProof(proof.trustLevel);
  const trustDisplay = credentialTrustDisplayFor({
    type: 'passport',
    trustLevel: storedTrustLevel,
    metadataTags:
      proof.trustLevel === 'blue'
        ? ['passport-openac-v3', 'passport-openac-v3-no-aa']
        : proof.trustLevel === 'green'
          ? ['passport-openac-v3']
          : ['fallback'],
  });
  const accent = levelColorForTone(trustDisplay.tone);
  const title = failed
    ? 'Fallback / Non-ZK proof'
    : proof.proofType === 'mopro-noir-disclosure'
      ? trustDisplay.level === 'L1'
        ? 'ZK disclosure proof (synthetic MRZ)'
        : 'ZK disclosure proof'
      : trustDisplay.level === 'L3+'
        ? 'Passport ZK + AA proof ready'
        : trustDisplay.level === 'L3'
          ? 'Passport ZK proof ready (no AA)'
          : 'Fallback / Non-ZK proof';
  const iconName = failed
    ? 'exclamationmark.triangle'
    : trustDisplay.level === 'L1'
      ? 'checkmark.seal'
      : 'checkmark.seal.fill';
  return (
    <View
      className="mx-4 rounded-xl p-3"
      style={{ backgroundColor: Colors.mutedSurface, gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SfIcon name={iconName} size={14} color={accent} />
        <Text style={{ color: accent, fontSize: 12, fontWeight: '600', flex: 1 }}>
          {title}
        </Text>
        <Text
          style={{
            color: accent,
            fontSize: 10,
            fontFamily: 'Menlo',
            fontWeight: '700',
            paddingHorizontal: 6,
            paddingVertical: 2,
            backgroundColor: `${accent}26`,
            borderRadius: 4,
          }}
        >
          {trustDisplay.level}
        </Text>
      </View>
      <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
        {`Type: ${proof.proofType}`}
      </Text>
      {proof.disclosure ? <DisclosureRows disclosure={proof.disclosure} /> : null}
    </View>
  );
}

function levelColorForTone(tone: TrustDisplayTone): string {
  switch (tone) {
    case 'green':
      return Colors.terminalGreen;
    case 'blue':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}

/**
 * v3 disclosure circuit's public outputs, rendered alongside the proof so
 * the user — and any downstream verifier UI — sees exactly which MRZ
 * attributes were committed. Hidden attributes show "— hidden" rather
 * than leaving the row empty, so the user can audit the policy that ran.
 */
function DisclosureRows({ disclosure }: { disclosure: NonNullable<PassportProofResult['disclosure']> }) {
  return (
    <View style={{ gap: 2, paddingTop: 4 }}>
      <DisclosureRow
        label="Nationality"
        value={disclosure.nationality ?? '— hidden'}
        hidden={disclosure.nationality === null}
      />
      <DisclosureRow
        label={`Age ≥ ${String(disclosure.ageThreshold)}`}
        value={
          disclosure.isOlder === null
            ? '— hidden'
            : disclosure.isOlder
              ? 'verified'
              : 'not met'
        }
        hidden={disclosure.isOlder === null}
      />
      <DisclosureRow
        label="Name"
        value={disclosure.name ?? '— hidden'}
        hidden={disclosure.name === null}
      />
      <Text
        className="text-text3"
        style={{ fontSize: 10, fontFamily: 'Menlo', paddingTop: 2 }}
      >
        {`MRZ hash: ${disclosure.mrzHashHex.slice(0, 16)}…`}
      </Text>
    </View>
  );
}

function DisclosureRow({
  label,
  value,
  hidden,
}: {
  label: string;
  value: string;
  hidden: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Text
        className="text-text3"
        style={{ fontSize: 10, fontWeight: '600', width: 84 }}
      >
        {label}
      </Text>
      <Text
        className={hidden ? 'text-text3' : 'text-text2'}
        style={{ fontSize: 10, fontFamily: 'Menlo', flex: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}

export function PersistStep({
  proof,
  busy,
  developerMode,
  onSave,
}: {
  readonly proof: PassportProofResult | null;
  readonly busy: boolean;
  readonly developerMode: boolean;
  readonly onSave: () => void;
}) {
  const { t } = useTranslation();
  const fallback = proof?.generationFailed === true;
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <Text className="text-text2 text-center text-[15px]">
        {developerMode
          ? 'Credential is ready. Save it to your identity wallet.'
          : fallback
            ? t('passportSetup.persist.fallback')
            : t('passportSetup.persist.ready')}
      </Text>
      <ThemedButton
        label={
          developerMode
            ? 'Save Passport Credential'
            : fallback
              ? t('passportSetup.persist.saveFallback')
              : t('passportSetup.persist.save')
        }
        fullWidth
        disabled={proof === null || busy}
        onPress={onSave}
      />
    </View>
  );
}
