/**
 * ThemedTextInput — the single text-input primitive, completing the
 * Themed{Button,Text,Surface} family (apps/expo/CLAUDE.md rules 1–5).
 *
 * Before this, every screen hand-rolled a raw <TextInput> with inline
 * styles that drifted (14 vs 15px, border-or-not, no focus state, sub-44pt
 * touch targets). Route inputs through this instead — every future
 * platform-binding wizard (S/A/B/C, docs/ref/03 §5) gets a correct field
 * for free instead of re-hand-rolling and re-drifting.
 *
 * Bakes in the mobile text-input UX baseline the raw fields were missing:
 *  - visible FOCUS state (accent/mauve border) and ERROR state (destructive
 *    border + message row) — the two states a bare TextInput never showed;
 *  - `kind` sets the right keyboard / autocapitalize / secure defaults in
 *    ONE place (`text | url | handle | secret | did`);
 *  - ≥44pt touch target (rule 6);
 *  - trailing affordances: reveal (auto for `secret`), paste, clear;
 *  - every colour from a `Colors` token (rule 4) — no new hex.
 *
 * Controlled field (`value`/`onChangeText`); focus + reveal are local UI
 * state (rule 9). Label is optional — omit it where the row already has its
 * own heading (e.g. the link-label input inside a bordered card).
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputProps as RNTextInputProps,
} from 'react-native';
import type { SFSymbol } from 'expo-symbols';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';

import { ThemedText } from './ThemedText';

export type TextInputKind = 'text' | 'url' | 'handle' | 'secret' | 'did';

interface KindConfig {
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: RNTextInputProps['autoCapitalize'];
  readonly autoCorrect?: boolean;
  readonly autoComplete?: RNTextInputProps['autoComplete'];
  readonly textContentType?: RNTextInputProps['textContentType'];
  readonly mono?: boolean;
  readonly secret?: boolean;
}

const KIND_CONFIG: Readonly<Record<TextInputKind, KindConfig>> = {
  text: {},
  url: {
    keyboardType: 'url',
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'off',
    textContentType: 'URL',
  },
  handle: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off' },
  // `oneTimeCode`, NEVER `password` — a raw crypto key (nsec/seed) must not
  // be offered to the iOS password manager (that would cache the very thing
  // that must stay uncached). `oneTimeCode` still disables autofill/correct.
  secret: {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'off',
    textContentType: 'oneTimeCode',
    mono: true,
    secret: true,
  },
  did: { autoCapitalize: 'none', autoCorrect: false, autoComplete: 'off', mono: true },
};

export interface ThemedTextInputProps {
  readonly value: string;
  readonly onChangeText: (v: string) => void;
  readonly kind?: TextInputKind;
  readonly label?: string;
  readonly placeholder?: string;
  /** Read-only format guidance rendered inside the field at the trailing edge. */
  readonly inlineSuffix?: string | null;
  /** Read-only fixed part rendered inside the field at the leading edge —
   * the user types only what follows it (e.g. `https://`, `t.me/`). */
  readonly inlinePrefix?: string | null;
  /** Non-null → destructive border + this message under the field. Wins over `hint`. */
  readonly error?: string | null;
  /** Neutral/positive helper under the field (e.g. "✓ npub1…"). Hidden while `error` is set. */
  readonly hint?: string | null;
  readonly hintTone?: 'success' | 'secondary';
  readonly multiline?: boolean;
  readonly editable?: boolean;
  readonly autoFocus?: boolean;
  /** Trailing paste-from-clipboard button — for token/key/URL fields. */
  readonly showPaste?: boolean;
  /** Trailing clear (✕) button, shown only when the field is non-empty. */
  readonly showClear?: boolean;
  /** Called on blur — the seam for on-blur normalization (e.g. auto-prefix https). */
  readonly onBlur?: () => void;
  readonly returnKeyType?: ReturnKeyTypeOptions;
  /** Override the kind default for narrow cases such as numeric PIN entry. */
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: RNTextInputProps['autoCapitalize'];
  readonly autoCorrect?: boolean;
  readonly onSubmitEditing?: () => void;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

const MIN_HEIGHT = 48; // comfortably ≥44pt (rule 6)
const MULTILINE_MIN_HEIGHT = 88;
const TRAILING_SLOT = 44;
const INLINE_SUFFIX_WIDTH = 96;

export function ThemedTextInput({
  value,
  onChangeText,
  kind = 'text',
  label,
  placeholder,
  inlineSuffix = null,
  inlinePrefix = null,
  error = null,
  hint = null,
  hintTone = 'secondary',
  multiline = false,
  editable = true,
  autoFocus,
  showPaste = false,
  showClear = false,
  onBlur,
  returnKeyType,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  onSubmitEditing,
  accessibilityLabel,
  testID,
}: ThemedTextInputProps): ReactNode {
  const { t } = useTranslation();
  const cfg = KIND_CONFIG[kind];
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  // Measured on layout; until then an estimate keeps the caret from
  // overlapping the prefix on the first frame.
  const [prefixWidth, setPrefixWidth] = useState(0);
  const effectivePrefixWidth = inlinePrefix
    ? (prefixWidth > 0 ? prefixWidth : inlinePrefix.length * 8) + 4
    : 0;

  const trailing: ReactNode[] = [];
  if (cfg.secret) {
    trailing.push(
      <TrailingButton
        key="reveal"
        icon={revealed ? 'eye.slash' : 'eye'}
        label={t(revealed ? 'input.hide' : 'input.reveal')}
        onPress={() => {
          setRevealed((r) => !r);
        }}
      />
    );
  }
  if (showPaste) {
    trailing.push(
      <TrailingButton
        key="paste"
        icon="doc.on.clipboard"
        label={t('input.paste')}
        onPress={() => {
          // Lazy-load so importing this primitive never pulls the native
          // clipboard module in at module-load time (keeps unit tests that
          // render Themed components import-safe).
          void (async () => {
            const mod = await import('expo-clipboard');
            const text = await mod.getStringAsync();
            if (text.length > 0) onChangeText(text.trim());
          })();
        }}
      />
    );
  }
  if (showClear && value.length > 0) {
    trailing.push(
      <TrailingButton
        key="clear"
        icon="xmark.circle.fill"
        label={t('input.clear')}
        onPress={() => {
          onChangeText('');
        }}
      />
    );
  }

  const borderColor = error ? Colors.destructive : focused ? Colors.primaryBlue : Colors.divider;
  const trailingWidth = trailing.length * TRAILING_SLOT;

  return (
    <View style={{ gap: label ? 8 : 6 }}>
      {label ? <ThemedText variant="label">{label}</ThemedText> : null}
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={Colors.text3}
          editable={editable}
          autoFocus={autoFocus}
          multiline={multiline}
          secureTextEntry={cfg.secret === true && !revealed}
          keyboardType={keyboardType ?? cfg.keyboardType}
          autoCapitalize={autoCapitalize ?? cfg.autoCapitalize}
          autoCorrect={autoCorrect ?? cfg.autoCorrect}
          autoComplete={cfg.autoComplete}
          textContentType={cfg.textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={accessibilityLabel ?? label}
          testID={testID}
          className="bg-searchBg text-text1"
          style={{
            paddingHorizontal: 14,
            paddingLeft: 14 + effectivePrefixWidth,
            paddingRight:
              14 + trailingWidth + (inlineSuffix ? INLINE_SUFFIX_WIDTH : 0),
            paddingVertical: 12,
            minHeight: multiline ? MULTILINE_MIN_HEIGHT : MIN_HEIGHT,
            fontSize: 15,
            fontFamily: cfg.mono ? 'Menlo' : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
            borderWidth: 1,
            borderColor,
          }}
        />
        {inlineSuffix ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              right: 14 + trailingWidth,
              width: INLINE_SUFFIX_WIDTH,
              top: 0,
              bottom: 0,
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}>
            <ThemedText variant="bodySmall" tone="tertiary" numberOfLines={1}>
              {inlineSuffix}
            </ThemedText>
          </View>
        ) : null}
        {inlinePrefix ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 14,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            }}>
            <ThemedText
              variant="bodySmall"
              tone="tertiary"
              numberOfLines={1}
              onLayout={(e) => {
                setPrefixWidth(e.nativeEvent.layout.width);
              }}>
              {inlinePrefix}
            </ThemedText>
          </View>
        ) : null}
        {trailing.length > 0 ? (
          <View
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              flexDirection: 'row',
              alignItems: 'center',
            }}>
            {trailing}
          </View>
        ) : null}
      </View>
      {error ? (
        <ThemedText variant="caption" tone="error">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText
          variant="caption"
          tone="secondary"
          style={hintTone === 'success' ? { color: Colors.terminalGreen } : undefined}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

function TrailingButton({
  icon,
  label,
  onPress,
}: {
  readonly icon: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <PressableScale
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: TRAILING_SLOT,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <SfIcon name={icon} size={18} color={Colors.text3} />
    </PressableScale>
  );
}
