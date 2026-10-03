export type DocumentSettings = {
  format: 'A4' | 'Letter';
  landscape: boolean;
  margin: number;
  header: string;
  footer: string;
  pageNumbers: boolean;
};
export const defaultDocumentSettings: DocumentSettings = {
  format: 'A4',
  landscape: false,
  margin: 20,
  header: '',
  footer: 'Powered by Danny',
  pageNumbers: true,
};

/** The same typography is used in the editor and in Chromium's PDF renderer. */
export const documentContentCss = `
.document-content { color: #172d3b; font: 11pt Arial, sans-serif; line-height: 1.5; overflow-wrap: anywhere; }
.document-content * { box-sizing: border-box; }
.document-content p { margin: 0 0 10pt; }
.document-content h1 { font-size: 26pt; line-height: 1.15; margin: 0 0 16pt; color: #285c77; }
.document-content h2 { font-size: 17pt; margin: 20pt 0 10pt; color: #285c77; }
.document-content h3 { font-size: 13pt; margin: 15pt 0 8pt; }
.document-content h1,.document-content h2,.document-content h3 { break-after: avoid; }
.document-content ul { list-style: disc; padding-left: 24pt; margin: 8pt 0; }
.document-content ol { list-style: decimal; padding-left: 24pt; margin: 8pt 0; }
.document-content li p { margin: 2pt 0; }
.document-content a { color: #276b93; text-decoration: underline; }
.document-content blockquote { border-left: 3pt solid #9cbfd1; margin: 12pt 0; padding-left: 12pt; color: #476575; }
.document-content table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 12pt 0; }
.document-content th,.document-content td { border: 1px solid #bed0da; padding: 7pt; vertical-align: top; position: relative; min-width: 30px; }
.document-content th { background: #eaf3f8; font-weight: bold; text-align: left; }
.document-content td p,.document-content th p { margin: 0; }
.document-content thead { display: table-header-group; }
.document-content tr { break-inside: avoid; }
.document-content img { display: block; max-width: 100%; height: auto; max-height: var(--document-image-max-height, 220mm); object-fit: contain; margin: 12pt 0; break-inside: avoid; }
.document-content img[data-align="center"] { margin-left: auto; margin-right: auto; }
.document-content img[data-align="right"] { margin-left: auto; }
.document-content hr { border: 0; border-top: 1px solid #bed0da; margin: 18pt 0; }
.document-content div[data-page-break] { break-before: page; height: 0; margin: 0; }
.document-content pre { white-space: pre-wrap; }
.document-content mark { color: inherit; }
.document-content sub { vertical-align: sub; font-size: smaller; }
.document-content sup { vertical-align: super; font-size: smaller; }
`;
