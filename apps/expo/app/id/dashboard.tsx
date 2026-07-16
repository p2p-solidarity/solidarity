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
import { ScrollView, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { IDNavBar } from '@/components/id';
import { GroupPanel } from '@/components/id/panels/GroupPanel';
import { EMPTY_PERSONAL_STATE, PersonalPanel } from '@/components/id/panels/PersonalPanel';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
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
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('identityDashboard.refresh')}
            hitSlop={8}
            onPress={onRefresh}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name="arrow.clockwise" size={18} color={Colors.text1} />
          </PressableScale>
        }
      />

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
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

function IdentitySummary({ t }: { readonly t: (key: string) => string }): React.JSX.Element {
  return (
    <ThemedSurface
      variant="card"
      className="rounded-none"
      style={{
        padding: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <SfIcon name="clock" size={14} color={Colors.text2} />
        <ThemedText variant="caption" tone="secondary">
          {t('identityDashboard.noEvents')}
        </ThemedText>
      </View>
    </ThemedSurface>
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
          <PressableScale
            key={s.id}
            fill
            onPress={() => {
              onSelect(s.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={t(s.titleKey)}>
            <ThemedSurface
              variant="card"
              className="flex-row items-center justify-center gap-1.5 rounded-none py-2"
              style={{
                backgroundColor: isActive ? `${Colors.accentRose}26` : Colors.cardBg,
                borderColor: isActive ? Colors.accentRose : Colors.divider,
              }}>
              <SfIcon name={s.icon} size={14} color={isActive ? Colors.accentRose : Colors.text2} />
              <ThemedText
                variant="label"
                style={{ color: isActive ? Colors.accentRose : Colors.text2 }}>
                {t(s.titleKey)}
              </ThemedText>
            </ThemedSurface>
          </PressableScale>
        );
      })}
    </View>
  );
}
