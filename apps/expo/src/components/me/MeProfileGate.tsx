import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { getRootDid } from '@/identity/rootKey';

type GateState = 'loading' | 'createPage' | 'needsIdentity' | 'error';

export interface MeProfileGateProps {
  readonly onCreatePage: () => void;
  readonly onSetUpIdentity: () => void;
}

export function MeProfileGate({ onCreatePage, onSetUpIdentity }: MeProfileGateProps): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>('loading');
  const requestId = useRef(0);

  const checkIdentity = useCallback((): void => {
    const currentRequest = ++requestId.current;
    setState('loading');
    void getRootDid()
      .then((result) => {
        if (currentRequest !== requestId.current) return;
        if (result.ok) setState('createPage');
        else if (result.error.kind === 'notProvisioned') setState('needsIdentity');
        else setState('error');
      })
      .catch(() => {
        if (currentRequest === requestId.current) setState('error');
      });
  }, []);

  useEffect(() => {
    checkIdentity();
    return () => {
      requestId.current += 1;
    };
  }, [checkIdentity]);

  return (
    <View className="flex-1 justify-center px-4 pb-24">
      <Animated.View entering={FadeInDown.duration(240)}>
        <ThemedSurface variant="outlined" className="gap-4 rounded-none px-5 py-6">
          {state === 'loading' ? (
            <View className="items-center gap-3 py-2">
              <ActivityIndicator size="small" color={Colors.text3} />
              <ThemedText variant="bodySmall" tone="tertiary">
                {t('mePage.loading')}
              </ThemedText>
            </View>
          ) : state === 'error' ? (
            <>
              <ThemedText variant="titleMedium">{t('mePage.loadErrorTitle')}</ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary">
                {t('mePage.loadErrorMessage')}
              </ThemedText>
              <ThemedButton label={t('mePage.retry')} variant="secondary" onPress={checkIdentity} />
            </>
          ) : (
            <>
              <ThemedText variant="titleLarge">
                {t(state === 'createPage' ? 'mePage.createTitle' : 'mePage.identityTitle')}
              </ThemedText>
              <ThemedText variant="bodyMedium" tone="secondary">
                {t(state === 'createPage' ? 'mePage.createMessage' : 'mePage.identityMessage')}
              </ThemedText>
              <ThemedButton
                label={t(
                  state === 'createPage' ? 'profileCard.createPage' : 'profileCard.setUpIdentity'
                )}
                variant="primary"
                fullWidth
                onPress={state === 'createPage' ? onCreatePage : onSetUpIdentity}
              />
            </>
          )}
        </ThemedSurface>
      </Animated.View>
    </View>
  );
}
