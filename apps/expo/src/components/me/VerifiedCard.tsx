/**
 * VerifiedCard — Me tab's merged identity + QR expand card (1.3.3 Task A0.2).
 *
 * Combines the pre-1.3.3 Me-tab identity header (`ProfileHeaderCard`:
 * avatar/name/DID pill/Edit) with the pre-1.3.3 Share-tab QR expand card
 * (`QrShareCard`: collapsible own-QR + sharing field pills — it was already
 * "可展開" / expandable) into one "verified card" component, per
 * docs/ref/03-app-web-mechanisms.md §5:
 *   "新 Me = 現 Me 上半(identity 卡)+ 原 Share tab 底部 QR 展開卡,合併為
 *    一張可展開分享的已驗證名片"
 * Both pieces keep their Figma-matched visuals unmodified (reuse, no dup —
 * root CLAUDE.md rule 1); this component is the seam that used to be "two
 * separate tabs".
 *
 * A badge row sits between them. Phase A0.2 has no real badge data source
 * yet — badges land in later phases (Nostr/atproto/DNS/OIDC/passport, see
 * docs/ref/04-plan-app.md Phase A4+) — so it renders an honest empty state,
 * never placeholder badges (CLAUDE.md rule 8: no fake data).
 */
import { Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ProfileHeaderCard, type ProfileHeaderCardProps } from '@/components/me/ProfileHeaderCard';
import { QrShareCard, type QrShareCardProps } from '@/components/share/QrShareCard';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

export type VerifiedCardProps = ProfileHeaderCardProps & QrShareCardProps;

export function VerifiedCard({
  name,
  did,
  avatar,
  onEdit,
  qrImageUri,
  cardName,
  enabledFields,
  hasRealHuman,
  onOpenSettings,
  onShare,
}: VerifiedCardProps) {
  return (
    <View className="gap-3">
      <ProfileHeaderCard name={name} did={did} avatar={avatar} onEdit={onEdit} />
      <BadgeRow />
      <View className="px-4">
        <QrShareCard
          qrImageUri={qrImageUri}
          cardName={cardName}
          enabledFields={enabledFields}
          hasRealHuman={hasRealHuman}
          onOpenSettings={onOpenSettings}
          onShare={onShare}
        />
      </View>
    </View>
  );
}

/**
 * Badge row — always the honest empty state today. There is no badge
 * registry / verification engine wired up yet (that's Phase A4 onward), so
 * this never fabricates a count or a plausible-looking badge chip.
 */
function BadgeRow() {
  const { t } = useTranslation();
  return (
    <View className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-3">
      <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
        <SfIcon name="checkmark.seal" size={14} color={Colors.text3} />
      </View>
      <Text className="text-text3 text-[13px]">{t('verifiedCard.noBadgesYet')}</Text>
    </View>
  );
}
