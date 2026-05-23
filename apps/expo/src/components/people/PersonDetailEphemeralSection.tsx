/**
 * PersonDetailEphemeralSection — sakura "ephemeral" chat-bubble block shown
 * inside PersonDetailView when an exchanged contact carries an outgoing
 * and/or incoming message. Mirrors solidarity/Views/PeopleViews/
 * PersonDetailView.swift's ephemeralSection.
 *
 * Layout:
 *   "sakura" 14pt label
 *   12pt mutedSurface container
 *     outgoing bubble (right-aligned, accentRose fill, square bottom-right)
 *     incoming bubble (left-aligned, warmCream fill, square bottom-left)
 *     "see more N message(s)" pill (centred)
 *
 * Extracted into a sibling component so apps/expo/app/people/[id].tsx stays
 * under the 500-LOC cap defined in CLAUDE.md.
 */
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  PersonDetailBubble,
  formatIsoDate,
} from '@/components/people/personDetailSupport';
import { Colors } from '@/constants/Colors';
import type { Contact } from '@solidarity/shared';

export function PersonDetailEphemeralSection({
  contact,
}: {
  readonly contact: Contact;
}): ReactNode {
  const mine = contact.myEphemeralMessage?.trim() ?? '';
  const theirs = contact.theirEphemeralMessage?.trim() ?? '';
  const hasMine = mine.length > 0;
  const hasTheirs = theirs.length > 0;
  if (!hasMine && !hasTheirs) return null;

  const count = (hasMine ? 1 : 0) + (hasTheirs ? 1 : 0);

  return (
    <View style={{ paddingHorizontal: 16, rowGap: 8 }}>
      <Text className="text-text1" style={{ fontSize: 14 }}>
        sakura
      </Text>
      <View
        className="bg-mutedSurface"
        style={{
          borderRadius: 12,
          paddingHorizontal: 12,
          paddingVertical: 16,
          rowGap: 12,
        }}
      >
        {hasMine ? (
          <BubbleRow
            text={mine}
            corners="outgoing"
            date={contact.exchangeTimestamp}
          />
        ) : null}
        {hasTheirs ? (
          <BubbleRow
            text={theirs}
            corners="incoming"
            date={contact.exchangeTimestamp}
          />
        ) : null}
        <View style={{ alignSelf: 'center' }}>
          <SeeMorePill count={count} />
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bubble row — text + timestamp, asymmetric-corner background rendered as
// an SVG overlay so the squared corner stays crisp at any width.
// ─────────────────────────────────────────────────────────────────────────────

function BubbleRow({
  text,
  corners,
  date,
}: {
  readonly text: string;
  readonly corners: 'outgoing' | 'incoming';
  readonly date: Date | undefined;
}): ReactNode {
  const [bubbleSize, setBubbleSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const isOutgoing = corners === 'outgoing';
  const fillColor = isOutgoing ? Colors.bubbleOutgoing : Colors.bubbleIncoming;
  const textColor = isOutgoing ? '#FFFFFF' : Colors.bubbleIncomingText;
  return (
    <View
      style={{
        alignSelf: isOutgoing ? 'flex-end' : 'flex-start',
        alignItems: isOutgoing ? 'flex-end' : 'flex-start',
        rowGap: 2,
        maxWidth: '85%',
      }}
    >
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (
            Math.abs(width - bubbleSize.width) > 0.5 ||
            Math.abs(height - bubbleSize.height) > 0.5
          ) {
            setBubbleSize({ width, height });
          }
        }}
        style={{ padding: 12 }}
      >
        {bubbleSize.width > 0 ? (
          <PersonDetailBubble
            width={bubbleSize.width}
            height={bubbleSize.height}
            fillColor={fillColor}
            corners={corners}
          />
        ) : null}
        <Text
          style={{ fontSize: 14, color: textColor, lineHeight: 18, textAlign: 'left' }}
        >
          {text}
        </Text>
      </View>
      {date ? (
        <Text className="text-text2" style={{ fontSize: 10 }}>
          {formatIsoDate(date)}
        </Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "see more N message(s)" pill — pillSurface capsule, chevron.right at tail
// ─────────────────────────────────────────────────────────────────────────────

function SeeMorePill({ count }: { readonly count: number }): ReactNode {
  const label =
    count === 1 ? 'see more 1 message' : `see more ${String(count)} messages`;
  return (
    <View
      className="flex-row items-center bg-pillSurface"
      style={{
        paddingLeft: 8,
        paddingRight: 4,
        paddingVertical: 4,
        borderRadius: 999,
        columnGap: 2,
      }}
    >
      <Text className="text-text2" style={{ fontSize: 10 }}>
        {label}
      </Text>
      <SfIcon name="chevron.right" size={12} color={Colors.text2} />
    </View>
  );
}
