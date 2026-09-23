/**
 * PageEmptyState — the mock's `.empty-state`
 * (`creds-design/verified-linkinbio-mock-v3.html` §`#s-page`): a 96pt
 * `.es-art` illustration over a 1.5pt dashed panel, one short title, one
 * sentence, then the actions.
 *
 * The wording rule comes with the shape (mock note A2): an empty list is the
 * normal state of a new account, not an error, so the copy states the next
 * step without nagging.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { EmptyListFeatureArt, WelcomeFeatureArt } from '@/components/decor/CredsFeatureArt';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

/** `.es-art` — 96pt square, 10pt below it. */
const ART_SIZE = 96;

export interface PageEmptyStateAction {
  readonly label: string;
  readonly onPress: () => void;
}

/** Which `#w-feature-*` illustration the panel wears — the mock assigns a
 *  different one per empty state (`#esFields` → 3, `#esBadges` → 2). */
export type PageEmptyStateArt = 'list' | 'attestation';

export interface PageEmptyStateProps {
  readonly art?: PageEmptyStateArt;
  readonly title: string;
  readonly message: string;
  /** Filled `.primary` button — the one thing this page wants you to do. */
  readonly action: ReactNode;
  /** Optional `.ghost` second route (e.g. import from elsewhere). */
  readonly secondaryAction?: PageEmptyStateAction;
}

export function PageEmptyState({
  art = 'list',
  title,
  message,
  action,
  secondaryAction,
}: PageEmptyStateProps): ReactNode {
  return (
    <View
      className="items-center bg-cardBg"
      style={{
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: Colors.divider,
        paddingVertical: 24,
        paddingHorizontal: 18,
      }}>
      <View style={{ marginBottom: 10 }}>
        {art === 'attestation'
          ? <WelcomeFeatureArt size={ART_SIZE} />
          : <EmptyListFeatureArt size={ART_SIZE} />}
      </View>
      <ThemedText variant="bodyMedium" style={{ marginTop: 6, textAlign: 'center' }}>
        {title}
      </ThemedText>
      <ThemedText
        variant="bodySmall"
        tone="secondary"
        style={{ marginTop: 4, marginBottom: 12, textAlign: 'center' }}>
        {message}
      </ThemedText>
      {action}
      {secondaryAction ? (
        <View style={{ alignSelf: 'stretch', marginTop: 10 }}>
          <ThemedButton
            label={secondaryAction.label}
            variant="secondary"
            fullWidth
            onPress={secondaryAction.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}
