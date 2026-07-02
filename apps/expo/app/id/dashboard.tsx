/**
 * Identity Dashboard — 1:1 port of Swift IdentityDashboardView
 *   (solidarity/Views/IDViews/IdentityDashboardView.swift).
 *
 * Layout (Swift parity):
 *   • Nav title "Identity Center" + trailing arrow.clockwise toolbar item
 *   • identitySummary card (clock + summary text — shown verbatim from the
 *     coordinator's lastImportEvent or as an empty-state hint)
 *   • tabSwitcher — segmented pills (Personal / Group / Selective).
 *     Selected pill uses accentRose at 15% bg + accentRose text;
 *     deselected uses cardBg + secondary text.
 *   • Active panel — Personal / Group / Selective. Swift uses a paged
 *     TabView; the Expo port renders the active panel directly under the
 *     switcher so behaviour matches without re-implementing a horizontal
 *     pager (Reanimated 4 pager can land in a follow-up).
 *
 * TODO(android): port SelectiveDisclosureSettingsView; until then the
 * Selective tab follows Swift's `supportsSelective == false` branch (hidden).
 * TODO(android): wire IdentityCoordinator.refreshIdentity() once ported.
 */
import type { SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { IDNavBar } from '@/components/id';
import { GroupPanel } from '@/components/id/panels/GroupPanel';
import {
  EMPTY_PERSONAL_STATE,
  PersonalPanel,
} from '@/components/id/panels/PersonalPanel';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';

type DashboardSection = 'personal' | 'group';

interface SectionDef {
  readonly id: DashboardSection;
  readonly titleKey: string;
  readonly icon: SFSymbol;
}

const SECTIONS: readonly SectionDef[] = [
  { id: 'personal', titleKey: 'identityDashboard.tabPersonal', icon: 'person.circle' },
  { id: 'group', titleKey: 'identityDashboard.tabGroup', icon: 'person.3' },
];

export default function IdentityDashboard(): React.JSX.Element {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<DashboardSection>('personal');

  const onRefresh = (): void => {
    pushToast(t('identityDashboard.refreshPending'), 'info');
  };

  const onClearError = (): void => {
    pushToast(t('identityDashboard.errorCleared'), 'success');
  };

  return (
    <View className="flex-1 bg-pageBg">
      <IDNavBar
        title={t('identityDashboard.title')}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('identityDashboard.refresh')}
            hitSlop={8}
            className="active:opacity-60"
            onPress={onRefresh}
          >
            <SfIcon name="arrow.clockwise" size={18} color={Colors.text1} />
          </Pressable>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <View className="gap-5">
          <IdentitySummary t={t} />
          <TabSwitcher selection={selection} onSelect={setSelection} t={t} />
          {selection === 'personal' ? (
            <PersonalPanel
              state={EMPTY_PERSONAL_STATE}
              onRefresh={onRefresh}
              onClearError={onClearError}
            />
          ) : (
            <GroupPanel />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function IdentitySummary({
  t,
}: {
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View
      className="bg-cardBg rounded-2xl"
      style={{
        padding: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <SfIcon name="clock" size={14} color={Colors.text2} />
        <Text className="text-text2 text-[12px]">{t('identityDashboard.noEvents')}</Text>
      </View>
    </View>
  );
}

function TabSwitcher({
  selection,
  onSelect,
  t,
}: {
  readonly selection: DashboardSection;
  readonly onSelect: (s: DashboardSection) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View className="flex-row" style={{ gap: 10 }}>
      {SECTIONS.map((s) => {
        const isActive = s.id === selection;
        return (
          <Pressable
            key={s.id}
            onPress={() => { onSelect(s.id); }}
            accessibilityRole="button"
            accessibilityLabel={t(s.titleKey)}
            style={{
              flex: 1,
              borderRadius: 12,
              paddingVertical: 8,
              backgroundColor: isActive
                ? `${Colors.accentRose}26`
                : Colors.cardBg,
              borderWidth: 1,
              borderColor: isActive ? Colors.accentRose : Colors.divider,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
          >
            <SfIcon
              name={s.icon}
              size={14}
              color={isActive ? Colors.accentRose : Colors.text2}
            />
            <Text
              style={{
                color: isActive ? Colors.accentRose : Colors.text2,
                fontSize: 14,
                fontWeight: '600',
              }}
            >
              {t(s.titleKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
