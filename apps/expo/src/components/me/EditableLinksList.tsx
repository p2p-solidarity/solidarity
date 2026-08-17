import type { ReactNode } from 'react';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import {
  displayLinkText,
  linkInputModelFor,
  linkPresetForEditableUrl,
} from '@/profile/linkUrl';
import { linkIconNameFor } from '@/profile/linkPresentation';

import type { LinkSheetValue } from './AddLinkSheet';

export interface EditableLinkListItem extends LinkSheetValue {
  readonly id: string;
}

export interface EditableLinksListProps {
  readonly links: readonly EditableLinkListItem[];
  readonly onAdd: () => void;
  readonly onEdit: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onImportLinktree: () => void;
}

function linkSummary(link: EditableLinkListItem): string {
  const preset = linkPresetForEditableUrl(link.preset, link.url);
  const display = displayLinkText(preset, link.url);
  if (!linkInputModelFor(preset).handle) return display;
  return display.startsWith('@') ? display : `@${display}`;
}

export function EditableLinksList({
  links,
  onAdd,
  onEdit,
  onRemove,
  onMove,
  onImportLinktree,
}: EditableLinksListProps): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <View className="min-h-11 flex-row items-center justify-between">
        <ThemedText variant="label">{t('meEdit.links')}</ThemedText>
        <PressableScale
          haptic="tap"
          onPress={onImportLinktree}
          accessibilityRole="button"
          accessibilityLabel={t('meEdit.importFromLinktree')}
          className="min-h-11 flex-row items-center justify-center gap-1 px-1">
          <SfIcon name="square.and.arrow.down" size={12} color={Colors.primaryBlue} />
          <ThemedText variant="caption" style={{ color: Colors.primaryBlue }}>
            {t('meEdit.importFromLinktree')}
          </ThemedText>
        </PressableScale>
      </View>

      {links.map((link, index) => (
        <ThemedSurface
          key={link.id}
          variant="outlined"
          className="flex-row rounded-none">
          <PressableScale
            fill
            haptic="tap"
            onPress={() => {
              onEdit(link.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('meEdit.editLink', {
              label: link.label.trim() || linkSummary(link),
            })}
            style={{
              minHeight: 68,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingLeft: 12,
              paddingVertical: 10,
            }}>
            <ThemedSurface
              variant="inset"
              className="h-9 w-9 items-center justify-center rounded-none">
              <SfIcon
                name={linkIconNameFor(link.label, link.url)}
                size={16}
                color={Colors.primaryBlue}
              />
            </ThemedSurface>
            <View className="flex-1 gap-0.5">
              <ThemedText variant="bodyMedium" numberOfLines={1}>
                {link.label}
              </ThemedText>
              <ThemedText
                variant="caption"
                tone="tertiary"
                numberOfLines={1}
                ellipsizeMode="middle">
                {linkSummary(link)}
              </ThemedText>
            </View>
            <SfIcon name="pencil" size={13} color={Colors.text3} />
          </PressableScale>

          <View className="flex-row items-stretch">
            <LinkAction
              icon="chevron.up"
              label={t('meEdit.moveUp')}
              disabled={index === 0}
              onPress={() => {
                onMove(link.id, -1);
              }}
            />
            <LinkAction
              icon="chevron.down"
              label={t('meEdit.moveDown')}
              disabled={index === links.length - 1}
              onPress={() => {
                onMove(link.id, 1);
              }}
            />
            <LinkAction
              icon="trash"
              label={t('meEdit.removeLink')}
              destructive
              onPress={() => {
                onRemove(link.id);
              }}
            />
          </View>
        </ThemedSurface>
      ))}

      <ThemedButton
        label={t('meEdit.addLink')}
        variant="secondary"
        leadingIcon={<SfIcon name="plus" size={14} color={Colors.text1} />}
        onPress={onAdd}
      />
    </View>
  );
}

function LinkAction({
  icon,
  label,
  disabled = false,
  destructive = false,
  onPress,
}: {
  readonly icon: 'chevron.up' | 'chevron.down' | 'trash';
  readonly label: string;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const color = disabled
    ? Colors.text3
    : destructive
      ? Colors.destructive
      : Colors.text2;
  return (
    <PressableScale
      haptic={destructive ? 'warning' : 'tap'}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 44,
        minHeight: 68,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
      }}>
      <SfIcon name={icon} size={14} color={color} />
    </PressableScale>
  );
}
