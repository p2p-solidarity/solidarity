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
import type {
  PassportChipSnapshot,
  PassportProofResult,
} from '@/passport/pipeline';

export function NfcStep({
  busy,
  progress,
  chip,
  onRead,
}: {
  readonly busy: boolean;
  readonly progress: string;
  readonly chip: PassportChipSnapshot | null;
  readonly onRead: () => void;
}) {
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <NfcVisual busy={busy} success={chip !== null} />
      <Text className="text-text2 px-6 text-center text-[15px]">
        {chip
          ? 'Chip read successfully.'
          : busy
          ? 'Hold steady — reading chip…'
          : 'Bring your passport close to the device to read NFC chip data.'}
      </Text>
      {busy ? (
        <View className="items-center gap-2">
          <ActivityIndicator color={Colors.terminalGreen} />
          <Text className="text-text3 text-[12px]">{progress}</Text>
        </View>
      ) : null}
      {chip ? <ChipSnapshotCard chip={chip} /> : null}
      <ThemedButton
        label={chip ? 'Chip Read ✓' : 'Read NFC Chip'}
        fullWidth
        disabled={busy || chip !== null}
        onPress={onRead}
      />
    </View>
  );
}

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

function ChipSnapshotCard({ chip }: { chip: PassportChipSnapshot }) {
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
  onGenerate,
}: {
  readonly busy: boolean;
  readonly progress: string;
  readonly proof: PassportProofResult | null;
  readonly disabled: boolean;
  readonly onGenerate: () => void;
}) {
  return (
    <View className="gap-12 pt-8">
      <View className="items-center gap-4">
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="checkmark.shield" size={48} color={Colors.terminalGreen} />
        </View>
        <View className="items-center gap-2">
          <Text className="text-text1 text-center text-[16px] font-medium">
            Create Privacy Proof
          </Text>
          <Text className="text-text2 px-8 text-center text-[14px]" style={{ lineHeight: 22 }}>
            Securely generate a proof from your passport to verify your identity — without sharing
            raw data.
          </Text>
        </View>
      </View>

      <View className="gap-8">
        <View className="gap-2 px-4">
          <Text className="text-text1 text-[14px]">Selective Disclosures</Text>
          <View className="gap-2">
            <BulletGuaranteeRow text="Runs entirely on your device" />
            <BulletGuaranteeRow text="No personal data is uploaded" />
          </View>
        </View>

        {busy ? (
          <View className="items-center gap-2">
            <ActivityIndicator color={Colors.terminalGreen} />
            <Text className="text-text3 text-[12px]">{progress}</Text>
          </View>
        ) : null}

        {proof ? <ProofResultCard proof={proof} /> : null}

        <View className="px-4">
          <ThemedButton
            label="Generate Proof"
            fullWidth
            disabled={busy || disabled}
            onPress={onGenerate}
          />
        </View>
      </View>
    </View>
  );
}

function ProofResultCard({ proof }: { proof: PassportProofResult }) {
  const failed = proof.generationFailed;
  // Demo proofs are real ZK proofs but built from upstream test-vector
  // bytes, not the user's actual DSC. Surface as amber-with-checkmark so
  // it's clearly distinct from a true-attestation green ZK proof and from
  // an orange SD-JWT fallback (rule 8 — never imply we know more than we do).
  const isDemo = proof.proofType === 'mopro-noir-demo';
  const accent = failed || isDemo ? '#FF9500' : Colors.terminalGreen;
  const title = failed
    ? 'Fallback (SD-JWT)'
    : isDemo
      ? 'Demo ZK proof (synthetic witness)'
      : 'ZK proof ready';
  const iconName = failed
    ? 'exclamationmark.triangle'
    : isDemo
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
          {proof.trustLevel.toUpperCase()}
        </Text>
      </View>
      <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
        {`Type: ${proof.proofType}`}
      </Text>
    </View>
  );
}

export function PersistStep({
  proof,
  busy,
  onSave,
}: {
  readonly proof: PassportProofResult | null;
  readonly busy: boolean;
  readonly onSave: () => void;
}) {
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <Text className="text-text2 text-center text-[15px]">
        Credential is ready. Save it to your identity wallet.
      </Text>
      <ThemedButton
        label="Save Passport Credential"
        fullWidth
        disabled={proof === null || busy}
        onPress={onSave}
      />
    </View>
  );
}
