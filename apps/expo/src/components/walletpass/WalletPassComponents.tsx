/**
 * WalletPassComponents — 1:1 port of
 * solidarity/Views/CardViews/WalletPassGeneration/WalletPassGenerationComponents.swift.
 *
 * Subviews used by the wallet-pass generation screen:
 *   - PassPreviewView    : blue gradient header + name/title/company block
 *                          + email/phone auxiliary + QR placeholder
 *   - PassInformationView: "About Apple Wallet Passes" card with 4 InfoRows
 *   - InfoRow            : icon + title + subtitle row primitive
 *
 * The Swift screen used `PassKit.PKAddPassesViewController`. There is no RN
 * equivalent — see `passBundle.ts` for the unsigned `pass.json` generator
 * we share via expo-sharing instead.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { BusinessCard } from '@solidarity/shared';

export interface PassPreviewViewProps {
  readonly businessCard: BusinessCard;
  /** Payload encoded into the QR (defaults to the share import string). */
  readonly qrPayload?: string;
}

export function PassPreviewView({
  businessCard,
  qrPayload,
}: PassPreviewViewProps): ReactNode {
  return (
    <View
      style={{
        alignSelf: 'stretch',
        marginHorizontal: 16,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      {/* Pass header */}
      <LinearGradient
        colors={[Colors.primaryBlue, `${Colors.primaryBlue}CC`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText
            variant="caption"
            style={{ color: Colors.cardBg, fontWeight: '500' }}
          >
            Solid(ar)ity
          </ThemedText>
          <ThemedText
            variant="caption"
            style={{ color: `${Colors.cardBg}E6` }}
          >
            Business Card
          </ThemedText>
        </View>
        <SfIcon name="person.crop.circle" size={24} color={Colors.cardBg} />
      </LinearGradient>

      {/* Pass content */}
      <View
        style={{
          backgroundColor: Colors.cardBg,
          padding: 16,
          gap: 12,
        }}
      >
        {/* Primary field */}
        <View style={{ gap: 4 }}>
          <ThemedText variant="caption" tone="secondary">
            NAME
          </ThemedText>
          <ThemedText variant="titleLarge">{businessCard.name}</ThemedText>
        </View>

        {/* Secondary fields */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {businessCard.title ? (
            <View style={{ gap: 4 }}>
              <ThemedText variant="caption" tone="secondary">
                TITLE
              </ThemedText>
              <ThemedText variant="bodyMedium">
                {businessCard.title}
              </ThemedText>
            </View>
          ) : (
            <View />
          )}

          {businessCard.company ? (
            <View style={{ gap: 4, alignItems: 'flex-end' }}>
              <ThemedText variant="caption" tone="secondary">
                COMPANY
              </ThemedText>
              <ThemedText variant="bodyMedium">
                {businessCard.company}
              </ThemedText>
            </View>
          ) : (
            <View />
          )}
        </View>

        {/* Auxiliary fields */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          {businessCard.email ? (
            <View style={{ gap: 4 }}>
              <ThemedText variant="caption" tone="secondary">
                EMAIL
              </ThemedText>
              <ThemedText
                variant="bodyMedium"
                style={{ color: Colors.primaryBlue }}
              >
                {businessCard.email}
              </ThemedText>
            </View>
          ) : (
            <View />
          )}

          {businessCard.phone ? (
            <View style={{ gap: 4, alignItems: 'flex-end' }}>
              <ThemedText variant="caption" tone="secondary">
                PHONE
              </ThemedText>
              <ThemedText
                variant="bodyMedium"
                style={{ color: Colors.primaryBlue }}
              >
                {businessCard.phone}
              </ThemedText>
            </View>
          ) : (
            <View />
          )}
        </View>

        {/* QR code */}
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <View
            style={{
              padding: 8,
              borderRadius: 8,
              backgroundColor: Colors.cardBg,
            }}
          >
            {qrPayload && qrPayload.length > 0 ? (
              <QRCode value={qrPayload} size={80} />
            ) : (
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 8,
                  backgroundColor: Colors.text1,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SfIcon name="qrcode" size={32} color={Colors.cardBg} />
              </View>
            )}
          </View>
          <ThemedText
            variant="caption"
            tone="secondary"
            style={{ paddingTop: 8 }}
          >
            QR Code
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

// MARK: - Pass Information

export function PassInformationView(): ReactNode {
  return (
    <ThemedSurface
      variant="inset"
      padded
      style={{ alignSelf: 'stretch', marginHorizontal: 16, gap: 16 }}
    >
      <ThemedText variant="titleMedium">About Apple Wallet Passes</ThemedText>

      <View style={{ gap: 12 }}>
        <InfoRow
          icon="checkmark.circle"
          title="Always Available"
          description="Access your business card even when offline"
        />
        <InfoRow
          icon="lock.shield"
          title="Secure Sharing"
          description="QR code contains encrypted information"
        />
        <InfoRow
          icon="arrow.clockwise"
          title="Auto Updates"
          description="Pass updates automatically when you change your information"
        />
        <InfoRow
          icon="person.2"
          title="Easy Sharing"
          description="Recipients can scan your pass to get your contact info"
        />
      </View>
    </ThemedSurface>
  );
}

export interface InfoRowProps {
  readonly icon: 'checkmark.circle' | 'lock.shield' | 'arrow.clockwise' | 'person.2';
  readonly title: string;
  readonly description: string;
}

export function InfoRow({ icon, title, description }: InfoRowProps): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      <View style={{ width: 24, alignItems: 'center', paddingTop: 2 }}>
        <SfIcon name={icon} size={18} color={Colors.terminalGreen} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <ThemedText variant="bodyMedium" style={{ fontWeight: '500' }}>
          {title}
        </ThemedText>
        <ThemedText variant="caption" tone="secondary">
          {description}
        </ThemedText>
      </View>
    </View>
  );
}
