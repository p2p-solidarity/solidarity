/**
 * ConnectGroupInvitePopup — 1:1 port of ConnectGroupInvitePopupView.swift.
 *
 * Accept/decline modal for a nearby group invite. The actual join logic
 * lives in the groups domain (SemaphoreIdentityManager equivalent will
 * land later); this view just collects user consent and forwards via
 * `onAccept`.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SfIcon } from '@/components/icons/SfIcon';
import { ON_DARK, ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';

export interface GroupInvitePayload {
  readonly groupName: string;
  readonly groupRoot?: string;
}

export interface ConnectGroupInvitePopupProps {
  readonly invite: GroupInvitePayload;
  readonly fromPeerName: string;
  readonly visible: boolean;
  readonly autoDismissOnSuccess?: boolean;
  readonly onAccept: () => Promise<void> | void;
  readonly onDismiss: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'accepting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export function ConnectGroupInvitePopup({
  invite,
  fromPeerName,
  visible,
  autoDismissOnSuccess = true,
  onAccept,
  onDismiss,
}: ConnectGroupInvitePopupProps): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const accept = async (): Promise<void> => {
    setPhase({ kind: 'accepting' });
    try {
      await onAccept();
      setPhase({ kind: 'success' });
      if (autoDismissOnSuccess) {
        setTimeout(onDismiss, 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invite failed';
      setPhase({ kind: 'error', message });
    }
  };

  const canDismissOutside = phase.kind !== 'accepting';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {
      if (canDismissOutside) onDismiss();
    }}>
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          if (canDismissOutside) onDismiss();
        }}
      >
        <Pressable onPress={() => { /* swallow tap-through */ }} style={styles.card}>
          <Header invite={invite} fromPeerName={fromPeerName} />
          <Details phase={phase} />
          <Actions
            phase={phase}
            onDismiss={onDismiss}
            onAccept={() => { void accept(); }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Header({
  invite,
  fromPeerName,
}: {
  readonly invite: GroupInvitePayload;
  readonly fromPeerName: string;
}): ReactNode {
  return (
    <View style={styles.headerRow}>
      <LinearGradient
        colors={[Colors.dustyMauve, Colors.primaryBlue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.iconCircle}
      >
        <SfIcon name="person.3.fill" size={22} color={ON_DARK} />
      </LinearGradient>
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={1}>{invite.groupName}</Text>
        <Text style={styles.headerSub} numberOfLines={1}>{`Invite from ${fromPeerName}`}</Text>
        {invite.groupRoot && invite.groupRoot.length > 0 ? (
          <Text style={styles.headerCaption} numberOfLines={1}>{`Root: ${invite.groupRoot}`}</Text>
        ) : null}
      </View>
      <SfIcon name="link.badge.plus" size={18} color={Colors.featureAccent} />
    </View>
  );
}

function Details({ phase }: { readonly phase: Phase }): ReactNode {
  if (phase.kind === 'idle') {
    return (
      <Text style={styles.body}>
        Accept to join this group. Your identity commitment will be sent to the inviter.
      </Text>
    );
  }
  if (phase.kind === 'accepting') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={Colors.featureAccent} />
        <Text style={styles.body}>Sending join response...</Text>
      </View>
    );
  }
  if (phase.kind === 'success') {
    return (
      <View style={styles.row}>
        <SfIcon name="checkmark.seal.fill" size={18} color={Colors.terminalGreen} />
        <Text style={styles.body}>Joined. Your card was created.</Text>
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <SfIcon name="exclamationmark.triangle.fill" size={18} color={Colors.warning} />
        <Text style={styles.bodyStrong}>Invite failed</Text>
      </View>
      <Text style={styles.bodyCenter}>{phase.message}</Text>
    </View>
  );
}

function Actions({
  phase,
  onDismiss,
  onAccept,
}: {
  readonly phase: Phase;
  readonly onDismiss: () => void;
  readonly onAccept: () => void;
}): ReactNode {
  if (phase.kind === 'idle') {
    return (
      <View style={styles.actions}>
        <View style={styles.flex}>
          <ThemedButton fullWidth variant="secondary" label="Decline" onPress={onDismiss} />
        </View>
        <View style={styles.flex}>
          <ThemedButton
            fullWidth
            label="Accept"
            leadingIcon={<SfIcon name="hand.thumbsup.fill" size={14} color={ON_DARK} />}
            onPress={onAccept}
          />
        </View>
      </View>
    );
  }
  if (phase.kind === 'accepting') {
    return <ThemedButton fullWidth variant="secondary" label="Hide" onPress={onDismiss} />;
  }
  if (phase.kind === 'success') {
    return <ThemedButton fullWidth label="Done" onPress={onDismiss} />;
  }
  return <ThemedButton fullWidth variant="secondary" label="Close" onPress={onDismiss} />;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayBg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.popupSurface,
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 6 },
  headerName: { color: Colors.text1, fontSize: 17, fontWeight: '600' },
  headerSub: { color: Colors.featureAccent, fontSize: 12 },
  headerCaption: { color: Colors.text2, fontSize: 11 },
  body: { color: Colors.text2, fontSize: 15 },
  bodyCenter: { color: Colors.text2, fontSize: 12, textAlign: 'center' },
  bodyStrong: { color: Colors.text1, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  block: { gap: 8, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
