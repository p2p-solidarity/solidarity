import { useRef, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { STAGGER_MS } from '@/feedback/motion';
import type { ProfileRecord } from '@solidarity/shared';

import { IdentityCredentialRows } from './IdentityCredentialRows';
import { ProfileBadgeChips } from './ProfileBadgeChips';
import { ProfileHero } from './ProfileHero';
import { ProfileLinksList } from './ProfileLinksList';
import { ProfileShareSurface } from './ProfileShareSurface';

const ENTRANCE_DURATION_MS = 240;

export interface MeProfilePageProps {
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly bottomInset: number;
  readonly onEdit: () => void;
  readonly onOpenIdentity: () => void;
  readonly onOpenBindings: () => void;
  readonly onOpenCredentials: () => void;
  readonly onOpenShareSettings: () => void;
}

export function MeProfilePage({
  record,
  jws,
  bottomInset,
  onEdit,
  onOpenIdentity,
  onOpenBindings,
  onOpenCredentials,
  onOpenShareSettings,
}: MeProfilePageProps): ReactNode {
  const scrollRef = useRef<ScrollView>(null);
  const bindingsY = useRef(0);
  const entrance = (delay: number) => FadeInDown.duration(ENTRANCE_DURATION_MS).delay(delay);

  const focusBindings = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, bindingsY.current - 12), animated: false });
  };

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerStyle={{ paddingTop: 20, paddingBottom: bottomInset + 100, gap: 24 }}>
      <Animated.View entering={entrance(0)}>
        <ProfileHero record={record} onEdit={onEdit} onOpenIdentity={onOpenIdentity} />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS)}>
        <ProfileBadgeChips record={record} jws={jws} onManageBindings={focusBindings} />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 2)}>
        <ProfileLinksList links={record.links} onEdit={onEdit} />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 2)}>
        <ProfileShareSurface record={record} jws={jws} onOpenShareSettings={onOpenShareSettings} />
      </Animated.View>

      <Animated.View
        entering={entrance(STAGGER_MS * 2)}
        onLayout={(event) => {
          bindingsY.current = event.nativeEvent.layout.y;
        }}>
        <IdentityCredentialRows
          record={record}
          onOpenBindings={onOpenBindings}
          onOpenCredentials={onOpenCredentials}
        />
      </Animated.View>
    </ScrollView>
  );
}
