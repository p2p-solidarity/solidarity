import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const VCARD_FILENAME = 'solidarity-contacts.vcf';

/** Write vCard text to a short-lived file and present the native share sheet. */
export async function shareVCard(vCard: string, dialogTitle: string): Promise<void> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new Error('Cache directory unavailable');
  if (!(await Sharing.isAvailableAsync())) throw new Error('System sharing unavailable');

  const fileUri = `${cacheDirectory}${VCARD_FILENAME}`;
  await FileSystem.writeAsStringAsync(fileUri, vCard, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  try {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/vcard',
      UTI: 'public.vcard',
      dialogTitle,
    });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
  }
}
