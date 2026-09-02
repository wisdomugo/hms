/*
 * Shared building blocks for the developer guides.
 *
 * One guide per milestone, each a small file that requires this one and exports
 * nothing but its content. The layout decisions live here so they stay the same
 * across twenty documents and nobody has to remember them.
 *
 * See README.md in this folder.
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat
} = require('docx');
const fs = require('fs');
const path = require('path');

const ACCENT = '0F6E6B';
const INK = '0E1A1C';
const MUTED = '55686B';
const LINE = 'DAE3E4';
const SOFT = 'F1F6F6';
const TABLE_W = 9000;

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const hair = { style: BorderStyle.SINGLE, size: 4, color: LINE };

/** A paragraph of body text. */
const p = (text, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 276 },
  children: [new TextRun({
    text, bold: o.bold, italics: o.italics,
    color: o.color ?? INK, size: o.size ?? 21, font: 'Calibri'
  })]
});

/** Mixed prose and code: rich(['run ', ['npm run generate'], ' first']). */
const rich = (parts, o = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 276 },
  children: parts.map(part => Array.isArray(part)
    ? new TextRun({ text: part[0], font: 'Consolas', size: 19, color: INK })
    : new TextRun({ text: part, size: 21, color: INK, font: 'Calibri' }))
});

const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80, line: 276 },
  children: [new TextRun({ text, size: 21, color: INK, font: 'Calibri' })]
});

const step = (text) => new Paragraph({
  numbering: { reference: 'steps', level: 0 },
  spacing: { after: 80, line: 276 },
  children: [new TextRun({ text, size: 21, color: INK, font: 'Calibri' })]
});

/** A shaded block of terminal lines. Pass an array of strings. */
const code = (lines) => lines.map((line, i) => new Paragraph({
  spacing: { after: i === lines.length - 1 ? 160 : 0, before: i === 0 ? 40 : 0, line: 240 },
  shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
  indent: { left: 220, right: 220 },
  children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: INK })]
}));

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 420, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
  children: [new TextRun({ text, bold: true, size: 26, color: ACCENT, font: 'Calibri' })]
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 280, after: 110 },
  children: [new TextRun({ text, bold: true, size: 22, color: INK, font: 'Calibri' })]
});

const spacer = () => new Paragraph({ spacing: { after: 200 }, children: [] });

/** The one visual emphasis this design allows. Use it sparingly. */
const callout = (text) => new Paragraph({
  spacing: { before: 60, after: 200 },
  shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
  indent: { left: 200, right: 200 },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
  children: [new TextRun({ text, bold: true, size: 23, color: INK, font: 'Calibri' })]
});

/**
 * A table. `widths` must sum to 9000 (the usable A4 width in DXA).
 * Both the table and every cell need a width or Google Docs renders it wrongly.
 */
function table(widths, header, rows) {
  const cell = (text, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: opts.head ? { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    children: String(text).split('\n').map((t, i, arr) => new Paragraph({
      spacing: { after: i === arr.length - 1 ? 0 : 60, line: 260 },
      children: [new TextRun({
        text: t, bold: opts.head,
        size: opts.head ? 17 : 19,
        color: opts.head ? MUTED : INK,
        font: opts.mono ? 'Consolas' : 'Calibri',
        allCaps: opts.head
      })]
    }))
  });

  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: hair, bottom: hair, left: noBorder, right: noBorder,
      insideHorizontal: hair, insideVertical: noBorder
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((t, i) => cell(t, widths[i], { head: true }))
      }),
      // A first column that looks like a path or an identifier is set in the
      // monospace face, because in these documents it usually is one.
      ...rows.map(r => new TableRow({
        children: r.map((t, i) => cell(t, widths[i], {
          mono: i === 0 && /^[a-z_.][a-z0-9_./@-]*$/i.test(String(t)) && /[./_]/.test(String(t))
        }))
      }))
    ]
  });
}

/** The masthead every guide opens with. */
function masthead({ number, title, standfirst }) {
  return [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: `HOSPITAL MANAGEMENT SYSTEM  ·  DEVELOPER GUIDE ${number}`,
        bold: true, size: 16, color: ACCENT, font: 'Calibri', characterSpacing: 30
      })]
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({
        text: `Milestone: ${title}`,
        bold: true, size: 34, color: INK, font: 'Calibri'
      })]
    }),
    new Paragraph({
      spacing: { after: 260 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK, space: 8 } },
      children: [new TextRun({ text: standfirst, size: 21, color: MUTED, font: 'Calibri' })]
    })
  ];
}

/** Build and write. `filename` is the .docx name, written to docs/. */
function build({ number, title, standfirst, filename, children }) {
  const doc = new Document({
    creator: 'Wisdom Nukas',
    title: `DEV_GUIDE_${number} — Milestone — ${title}`,
    description: `Hospital Management System — record of build milestone ${number}.`,
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 200 } } }
          }]
        },
        {
          reference: 'steps',
          levels: [{
            level: 0, format: LevelFormat.DECIMAL, text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 260 } } }
          }]
        }
      ]
    },
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: INK } } } },
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 } } },
      children: [...masthead({ number, title, standfirst }), ...children]
    }]
  });

  const out = path.join(__dirname, '..', filename);
  return Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(out, buf);
    console.log(`written: ${filename}  (${buf.length} bytes)`);
  });
}

module.exports = { p, rich, bullet, step, code, h1, h2, spacer, callout, table, build };
