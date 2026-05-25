/**
 * Developer settings — gates dev-only tools and inlines the DID-first
 * extension playground (formerly app/settings/dev-sandbox.tsx).
 *
 * HARD SCOPE (docs/dev-sandbox-identity-graph.md line 1):
 *   Every Lab on this screen lives behind `usePreferences.developerMode`.
 *   The v1.3.1 public surface is frozen by Swift parity. Promotion to
 *   public goes through the graduation criteria in docs §11.
 */
import { router } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { pushToast } from '@/feedback/toast';
import { usePreferences } from '@/settings/preferences';

const LAB_STUB_TOAST =
  'Lab not implemented yet — see apps/expo/docs/dev-sandbox-identity-graph.md';

export default function DeveloperSettings() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const setPref = usePreferences((s) => s.set);
  const reset = usePreferences((s) => s.reset);

  const stub = (): void => {
    pushToast(LAB_STUB_TOAST, 'info', 2500);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Developer" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              Unsupported tools — proceed at your own risk.
            </Text>
          </View>

          <SettingsBlockSection
            title="Mode"
            footer={developerMode
              ? 'DID-first extension playground. Every Lab is something your active DID can already do — but the public surface does not expose. Public surface stays frozen at Swift v1.3.1 parity.'
              : 'Enable Developer Mode to reveal the DID-first extension playground (P2P, Identity Tree, DAG, Nostr Bridge, Common Friends).'}
          >
            <SettingsBlockToggleRow
              icon="hammer"
              title="Developer mode"
              value={developerMode}
              onValueChange={(v) => { setPref('developerMode', v); }}
            />
          </SettingsBlockSection>

          {developerMode ? (
            <>
              <SettingsBlockSection
                title="P2P (headline)"
                footer="BLE L2CAP signaling → WebRTC LAN data channel. Backend-less. Works offline when both devices share Wi-Fi; BLE-only path works in airplane mode + BT on. UWB Bump turns the existing radar exchange into a tap-your-phones gesture (NFC/NameDrop feel) — the state machine is already typed in src/components/share/UwbStatusPill.tsx but the driver in session.ts is not wired yet."
              >
                <SettingsBlockRow
                  icon="dot.radiowaves.left.and.right"
                  title="P2P Lab"
                  subtitle="Stub — docs §3.3"
                  onPress={stub}
                />
                <SettingsBlockRow
                  icon="hand.tap"
                  title="UWB Bump Exchange"
                  subtitle="Stub — docs §3.3.1 (the NFC-tap-feel upgrade)"
                  onPress={stub}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title="Identity"
                footer="Read-only projection: your DID as root, with leaves drawn from the existing cards, contacts, groups, and event stores. No new data — a different angle on the state your DID already owns."
              >
                <SettingsBlockRow
                  icon="person.text.rectangle"
                  title="Identity Tree"
                  subtitle="Stub — docs §3.1"
                  onPress={stub}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title="DAG"
                footer="Append-only event chain. Every node is signed by your DID's sandbox secp256k1 dev-key. Same identity, new substrate. Replays into state, exports to Nostr."
              >
                <SettingsBlockRow
                  icon="square.and.arrow.up"
                  title="DAG Lab"
                  subtitle="Stub — docs §3.2"
                  onPress={stub}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title="Nostr Bridge"
                footer="Projects your DID's sandbox secp256k1 key onto a Nostr event envelope. Any relay carries the DAG. No default relay list — relays come from your input only."
              >
                <SettingsBlockRow
                  icon="arrow.triangle.2.circlepath"
                  title="Nostr Bridge Lab"
                  subtitle="Stub — docs §3.4"
                  onPress={stub}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title="Social Graph"
                footer="Common-friend discovery via DAG diff. Replaces the Swift SocialGraphIntersectionService hash-of-name PSI, which leaks ordering and is dictionary-attackable."
              >
                <SettingsBlockRow
                  icon="qrcode"
                  title="Common Friends"
                  subtitle="Stub — docs §3.5"
                  onPress={stub}
                />
              </SettingsBlockSection>

              <View className="gap-3">
                <SettingsBlockSectionHeader title="Danger Zone" />
                <View className="px-4 gap-2">
                  <SettingsBlockDangerRow
                    icon="arrow.counterclockwise"
                    title="Reset all preferences"
                    subtitle="Restores every preference to defaults"
                    onPress={() => { reset(); }}
                  />
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
