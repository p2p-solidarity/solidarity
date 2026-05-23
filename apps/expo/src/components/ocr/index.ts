/**
 * OCR scanner barrel — keeps consumer imports flat.
 */
export {
  ConfidenceBadge,
  ExtractedFieldView,
  LanguageOptionView,
} from './OcrScannerComponents';
export type {
  ConfidenceBadgeProps,
  ExtractedFieldViewProps,
  LanguageOptionViewProps,
} from './OcrScannerComponents';

export {
  ExtractedDataContent,
  LanguageSelectionContent,
  ProcessingSection,
  ScanningOptionsContent,
} from './OcrScannerSections';
export type {
  ExtractedDataContentProps,
  LanguageSelectionContentProps,
  ScanningOptionsContentProps,
} from './OcrScannerSections';

export {
  extractBusinessCardFields,
  recogniseText,
} from './ocrAnalyser';
export type { OcrResult, RecognizedText } from './ocrAnalyser';

export {
  SCAN_LANGUAGES,
  scanLanguageDisplayName,
  scanLanguageFlag,
} from './scanLanguage';
export type { ScanLanguage } from './scanLanguage';
