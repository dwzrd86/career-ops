import { Document, Packer, Paragraph, TextRun } from "docx";
import { parseResumeDraft } from "./resumeTailoring";

// Keep the reviewed wording verbatim. No template claims or inferred sections.
export async function resumeDocument(text: string): Promise<Blob> {
  const lines = parseResumeDraft(text).split("\n");
  const document = new Document({
    creator: "Meritwake",
    title: "Resume",
    description: "",
    styles: { default: { document: { run: { font: "Arial", size: 22, color: "000000" } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      children: lines.map((line, index) => new Paragraph({
        spacing: { after: 60, line: 264 },
        children: [new TextRun({ text: line, bold: index === 0, size: index === 0 ? 28 : 22 })],
      })),
    }],
  });
  return Packer.toBlob(document);
}
