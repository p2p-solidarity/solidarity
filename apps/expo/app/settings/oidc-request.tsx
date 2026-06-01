/**
 * OIDC Request — 1:1 port of
 * solidarity/Views/SettingsViews/OIDCRequestView.swift.
 *
 * Sections (top → bottom):
 *   1. Hero — terminalGreen circle with qrcode.viewfinder + heading.
 *   2. QR area — generated QR (240pt) or placeholder card.
 *   3. Request URL block — link icon + mono URL + copy button that flips
 *      to a green checkmark for 1.5s after press.
 *   4. Error banner — destructive surface (only when an error exists).
 *   5. Primary action button — "Generate Request" / "Regenerate Request".
 *
 * TODO(android): the Swift original calls `OIDCService.shared.generateRequest`
 * which mints a state token, signs it with the master key, and posts the
 * request_uri to an issuer registry. Until that service ports we generate a
 * self-issued openid4vp:// URL with a random nonce so the QR is scannable.
 */
import * as Clipboard from 'expo-clipboard';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { didKeyForCurrentIdentity } from '@/keychain/signingKey';
import { buildOid4VpRequestUrl } from '@/oidc/requestQr';

const MONO_FONT = 'Menlo';

interface GeneratedRequest {
  readonly url: string;
  readonly nonce: string;
}

function randomNonce(): string {
  return randomUUID();
}

export default function OidcRequestSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [request, setRequest] = useState<GeneratedRequest | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onGenerate = async () => {
    try {
      const nonce = randomNonce();
      const state = randomUUID();
      const clientId = await didKeyForCurrentIdentity().catch(
        () => 'https://solidarity.gg/oidc/me'
      );
      const url = buildOid4VpRequestUrl({ nonce, state, clientId });
      setRequest({ url, nonce });
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage((err as Error).message);
    }
  };

  const onCopy = async () => {
    if (!request) return;
    try {
      await Clipboard.setStringAsync(request.url);
      setCopied(true);
      pushToast(t('oidcRequest.copied'), 'success', 1500);
      setTimeout(() => { setCopied(false); }, 1500);
    } catch (err) {
      pushToast((err as Error).message, 'error');
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('oidcRequest.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Hero */}
          <View className="items-center gap-3" style={{ paddingTop: 8 }}>
            <View
              className="items-center justify-center rounded-full"
              style={{
                width: 64,
                height: 64,
                backgroundColor: `${Colors.terminalGreen}1F`,
              }}
            >
              <SfIcon
                name="qrcode.viewfinder"
                size={28}
                color={Colors.terminalGreen}
              />
            </View>
            <View className="items-center gap-1.5">
              <Text className="text-text1 text-[17px] font-semibold">
                {t('oidcRequest.heroTitle')}
              </Text>
              <Text
                className="text-text2 text-[13px] text-center"
                style={{ paddingHorizontal: 24, lineHeight: 18 }}
              >
                {t('oidcRequest.heroSubtitle')}
              </Text>
            </View>
          </View>

          {/* QR area */}
          <View className="px-4">
            {request ? (
              <View
                className="self-center rounded-2xl"
                style={{
                  backgroundColor: '#FFFFFF',
                  padding: 16,
                  borderWidth: 1,
                  borderColor: Colors.divider,
                }}
              >
                <QRCode
                  value={request.url}
                  size={240}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                />
              </View>
            ) : (
              <View
                className="self-center items-center justify-center rounded-2xl bg-mutedSurface"
                style={{ width: 240, height: 240, gap: 10 }}
              >
                <SfIcon
                  name="qrcode"
                  size={56}
                  weight="light"
                  color={Colors.text3}
                />
                <Text className="text-text2 text-[14px] font-medium">
                  {t('oidcRequest.noRequest')}
                </Text>
                <Text
                  className="text-text3 text-[12px] text-center"
                  style={{ paddingHorizontal: 16 }}
                >
                  {t('oidcRequest.noRequestHint')}
                </Text>
              </View>
            )}
          </View>

          {/* Request URL block */}
          {request ? (
            <View className="gap-2">
              <SettingsBlockSectionHeader title={t('oidcRequest.requestUrl')} />
              <View
                className="mx-4 bg-mutedSurface rounded-xl flex-row items-start"
                style={{ paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                  }}
                >
                  <SfIcon name="link" size={14} color={Colors.text1} />
                </View>
                <Text
                  className="text-text2 text-[11px] flex-1"
                  numberOfLines={3}
                  ellipsizeMode="middle"
                  selectable
                  style={{ fontFamily: MONO_FONT }}
                >
                  {request.url}
                </Text>
                <Pressable
                  onPress={() => { void onCopy(); }}
                  accessibilityRole="button"
                  accessibilityLabel={t('oidcRequest.copyUrl')}
                  className="active:opacity-80"
                  style={{
                    width: 28,
                    height: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: Colors.searchBg,
                    borderRadius: 8,
                    marginLeft: 12,
                  }}
                >
                  <SfIcon
                    name={copied ? 'checkmark' : 'doc.on.doc'}
                    size={14}
                    weight="semibold"
                    color={copied ? Colors.terminalGreen : Colors.text1}
                  />
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Error banner */}
          {errorMessage ? (
            <View
              className="mx-4 rounded-xl flex-row items-start"
              style={{
                backgroundColor: `${Colors.destructive}1A`,
                paddingHorizontal: 14,
                paddingVertical: 14,
              }}
            >
              <SfIcon
                name="exclamationmark.triangle.fill"
                size={14}
                color={Colors.destructive}
              />
              <Text
                className="text-destructive text-[13px] flex-1"
                style={{ marginLeft: 12 }}
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {/* Primary action */}
          <View className="px-4">
            <ThemedButton
              variant="primary"
              fullWidth
              label={request ? t('oidcRequest.regenerate') : t('oidcRequest.generate')}
              leadingIcon={
                <SfIcon
                  name={request ? 'arrow.clockwise' : 'sparkles'}
                  size={14}
                  color="#FFFFFF"
                />
              }
              onPress={() => { void onGenerate(); }}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
