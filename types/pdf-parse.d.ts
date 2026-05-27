// pdf-parse@1.1.1 only ships types for its top-level entry. We deep-import
// from the lib/ path to bypass index.js's self-test (which crashes when
// `module.parent` is undefined under Next.js's bundler).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfData {
    text?: string;
    numpages?: number;
    numrender?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(dataBuffer: Buffer): Promise<PdfData>;
  export default pdfParse;
}
