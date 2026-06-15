/**
 * MarkdownDocument — public alias for the existing MarkdownDocumentView
 * port. Exposes a tighter prop surface (`source: string`) so legal pages
 * (privacy, terms) can render bundled markdown without juggling the
 * async loader overload.
 *
 * The renderer + parser are the same Swift-parity implementation that
 * powers settings/about pages (see ./MarkdownDocumentView.tsx and
 * ./markdownParser.ts).
 */
import type { ReactNode } from 'react';

import { MarkdownDocumentView } from './MarkdownDocumentView';

export interface MarkdownDocumentProps {
  readonly source: string;
}

export function MarkdownDocument({ source }: MarkdownDocumentProps): ReactNode {
  return <MarkdownDocumentView source={source} />;
}
