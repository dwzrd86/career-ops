import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { resumeDocument } from "../src/resumeDocument";

describe("reviewed Word resume export", () => {
  it("creates a real DOCX with Unicode evidence in reading order and no tables or external links", async () => {
    const text = "Zoë García 李\nzoe@example.test · +1 555 0100\n\nEXPERIENCE\n• Engineer — Acme & Co <2022–2025>\nImproved throughput 25%.\nSKILLS\nPython, SQL";
    const blob = await resumeDocument(text);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(match =>
      [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(run => run[1]
        .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")).join(""));
    expect(paragraphs).toEqual(text.split("\n"));
    expect(xml).not.toMatch(/<w:(tbl|drawing|hyperlink|txbxContent)\b/);
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:ascii="Arial"');
    expect(xml).toContain('w:w="12240"');
    const relationships = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(relationships).not.toContain('TargetMode="External"');
  });

  it("rejects invalid drafts and exports long resumes without dropping text", async () => {
    for (const text of [" ", "binary\u0000content", "x".repeat(40001)]) {
      await expect(resumeDocument(text)).rejects.toThrow();
    }
    const text = Array.from({ length: 500 }, (_, index) => `Evidence line ${index} with unchanged metrics 42%.`).join("\n");
    const zip = await JSZip.loadAsync(await (await resumeDocument(text)).arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Evidence line 499 with unchanged metrics 42%.");
  });
});
