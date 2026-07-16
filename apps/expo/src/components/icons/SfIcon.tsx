/**
 * SfIcon — thin wrapper around expo-symbols' SymbolView. Call sites name
 * icons by their SF Symbol identifier (`gearshape`, `chevron.right`) so the
 * code stays verbatim with the SwiftUI legacy.
 *
 * On Android, `expo-symbols` renders the Material Symbols font glyph
 * matching the `android` half of the name object. We pass a full
 * SF → Material mapping below so every call site renders a real glyph on
 * both platforms (no more single-dot fallback).
 *
 * Sizing: Material Symbols carry ~3pt of intrinsic padding around the
 * glyph at any given `size` (drawn inside the EM box) while SF Symbols
 * fill the size more tightly. To keep visual weight equivalent we scale
 * the Android render up by `ANDROID_GLYPH_RATIO`. Without this, Android
 * icons (especially the 18pt gearshape in the Me/Settings nav bar) look
 * 2–4pt smaller than their iOS counterparts.
 */
import { SymbolView, type SFSymbol, type AndroidSymbol } from 'expo-symbols';
import { Platform, type ColorValue } from 'react-native';

const ANDROID_GLYPH_RATIO = 1.2;

export interface SfIconProps {
  /** SF Symbol name, e.g. `gearshape`, `chevron.right`. */
  name: SFSymbol;
  /** Symbol size in points. SwiftUI default for body text is 17. */
  size?: number;
  /** Tint colour. Defaults to inherit. */
  color?: ColorValue;
  /** Symbol weight (regular/medium/semibold/bold). */
  weight?: 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
}

export function SfIcon({
  name,
  size = 17,
  color,
  weight = 'regular',
}: SfIconProps) {
  const android = SF_TO_MATERIAL[name] ?? FALLBACK_MATERIAL;
  const resolvedSize =
    Platform.OS === 'android' ? Math.round(size * ANDROID_GLYPH_RATIO) : size;
  return (
    <SymbolView
      name={{ ios: name, android }}
      size={resolvedSize}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
    />
  );
}

const FALLBACK_MATERIAL: AndroidSymbol = 'help_outline';

// SF Symbol → Material Symbol mapping. Material catalog: https://fonts.google.com/icons
// Add a new entry whenever a new SF name shows up in the codebase.
const SF_TO_MATERIAL: Partial<Record<SFSymbol, AndroidSymbol>> = {
  airplayaudio: 'airplay',
  'antenna.radiowaves.left.and.right': 'cell_tower',
  'arrow.clockwise': 'refresh',
  'arrow.counterclockwise': 'history',
  'arrow.counterclockwise.icloud': 'cloud_sync',
  'arrow.triangle.2.circlepath': 'sync',
  'arrow.up.forward.app': 'open_in_new',
  'arrowshape.turn.up.right': 'reply',
  bell: 'notifications',
  'bell.badge.fill': 'notifications_active',
  'bolt.fill': 'bolt',
  briefcase: 'work',
  'building.2': 'apartment',
  calendar: 'calendar_today',
  'calendar.badge.checkmark': 'event_available',
  camera: 'photo_camera',
  'camera.viewfinder': 'qr_code_scanner',
  'chart.bar': 'bar_chart',
  checkmark: 'check',
  'checkmark.circle': 'check_circle',
  'checkmark.circle.fill': 'check_circle',
  'checkmark.seal': 'verified',
  'checkmark.seal.fill': 'verified',
  'checkmark.shield': 'verified_user',
  'checkmark.shield.fill': 'verified_user',
  'chevron.left': 'chevron_left',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron_right',
  'chevron.up': 'expand_less',
  'chevron.down': 'expand_more',
  'chevron.up.chevron.down': 'unfold_more',
  circle: 'radio_button_unchecked',
  'circle.dashed': 'radio_button_unchecked',
  clock: 'schedule',
  'clock.fill': 'schedule',
  'crown.fill': 'workspace_premium',
  'doc.badge.plus': 'note_add',
  'doc.on.clipboard': 'content_paste',
  'doc.on.doc': 'content_copy',
  'doc.text': 'description',
  'doc.text.fill': 'description',
  'doc.viewfinder': 'document_scanner',
  'dot.radiowaves.left.and.right': 'wifi_tethering',
  'ellipsis.circle': 'more_horiz',
  envelope: 'mail',
  'envelope.fill': 'mail',
  'exclamationmark.triangle': 'warning',
  'exclamationmark.triangle.fill': 'warning',
  eye: 'visibility',
  'eye.slash': 'visibility_off',
  'face.smiling': 'mood',
  faceid: 'face',
  gearshape: 'settings',
  globe: 'public',
  'graduationcap.fill': 'school',
  hammer: 'build',
  'hand.raised': 'pan_tool',
  'hand.thumbsup.fill': 'thumb_up',
  hourglass: 'hourglass_empty',
  icloud: 'cloud',
  'icloud.and.arrow.up': 'cloud_upload',
  'info.circle': 'info',
  iphone: 'smartphone',
  'iphone.radiowaves.left.and.right': 'wifi_tethering',
  key: 'key',
  'key.fill': 'key',
  'key.horizontal': 'key',
  'key.icloud': 'key',
  'key.slash': 'key_off',
  keyboard: 'keyboard',
  link: 'link',
  'link.badge.plus': 'add_link',
  'link.circle': 'link',
  'link.circle.fill': 'link',
  'list.bullet': 'format_list_bulleted',
  'list.bullet.rectangle': 'view_list',
  'lock.doc.fill': 'encrypted',
  'lock.fill': 'lock',
  'lock.rectangle': 'lock',
  'lock.shield': 'gpp_good',
  magnifyingglass: 'search',
  'mappin.and.ellipse': 'location_on',
  number: 'tag',
  paintbrush: 'brush',
  'paperplane.fill': 'send',
  pawprint: 'pets',
  'pencil.circle.fill': 'edit',
  person: 'person',
  'person.2': 'group',
  'person.2.fill': 'group',
  'person.2.slash': 'group_off',
  'person.3': 'groups',
  'person.3.fill': 'groups',
  'person.badge.key.fill': 'admin_panel_settings',
  'person.badge.shield.checkmark.fill': 'verified_user',
  'person.crop.circle': 'account_circle',
  'person.crop.circle.badge.plus': 'person_add',
  'person.crop.rectangle.fill': 'badge',
  'person.fill': 'person',
  'person.text.rectangle': 'contact_page',
  phone: 'call',
  'phone.fill': 'call',
  photo: 'image',
  plus: 'add',
  'plus.circle.fill': 'add_circle',
  qrcode: 'qr_code',
  'qrcode.viewfinder': 'qr_code_scanner',
  safari: 'public',
  shield: 'shield',
  'shield.checkerboard': 'shield',
  'shield.checkered': 'shield',
  'slider.horizontal.3': 'tune',
  sparkles: 'auto_awesome',
  'square.and.arrow.down': 'download',
  'square.and.arrow.up': 'ios_share',
  'square.and.arrow.up.on.square': 'ios_share',
  'square.and.pencil': 'edit',
  'square.grid.2x2': 'grid_view',
  'stop.fill': 'stop',
  tag: 'tag',
  timer: 'timer',
  trash: 'delete',
  'trash.circle.fill': 'delete',
  'trash.slash': 'delete_outline',
  viewfinder: 'crop_free',
  'wallet.pass': 'wallet',
  'wave.3.forward': 'wifi_tethering',
  xmark: 'close',
  'xmark.bin': 'delete',
  'xmark.circle': 'cancel',
  'xmark.circle.fill': 'cancel',
  'xmark.seal': 'gpp_bad',
};
