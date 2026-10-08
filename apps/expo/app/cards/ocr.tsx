import { Redirect } from 'expo-router';

/** OCR is not available in this build; old links open the real card editor. */
export default function OcrCompatibilityRoute() {
  return <Redirect href="/cards/edit" />;
}
