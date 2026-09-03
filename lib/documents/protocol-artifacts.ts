import fontkit from '@pdf-lib/fontkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import { z } from 'zod';
import golosTextRegular from '@expo-google-fonts/golos-text/400Regular/GolosText_400Regular.ttf?inline';

export const exportArtifactKinds = [
  'protocol_docx',
  'protocol_pdf',
  'transcript_txt',
  'audit_json',
  'bundle_zip',
] as const;

export type ExportArtifactKind = (typeof exportArtifactKinds)[number];

const sectionCodeSchema = z.enum([
  'complaints',
  'history_of_present_illness',
  'past_medical_history',
  'allergy_status',
  'objective_findings',
  'preliminary_diagnosis',
  'examination_plan',
  'treatment_plan',
]);

export const protocolAmendmentSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  baseProtocolId: z.string().min(1),
  reason: z.string().trim().min(10).max(500),
  text: z.string().trim().min(1).max(8000),
  signedByMembershipId: z.string().min(1),
  signedByDisplayName: z.string().min(1),
  signedAt: z.number().int().positive(),
});

export const signedProtocolContentSchema = z.object({
  schemaVersion: z.literal(1),
  dataMode: z.literal('synthetic-only'),
  encounter: z.object({
    id: z.string().min(1),
    sourceVersion: z.number().int().positive(),
    reasonForVisit: z.string().nullable(),
    startedAt: z.number().nullable(),
    endedAt: z.number(),
  }),
  patient: z.object({
    medicalRecordNumber: z.string().min(1),
    displayName: z.string().min(1),
    birthDate: z.string().nullable(),
    sexAtBirth: z.enum(['female', 'male', 'unknown', 'not_recorded']),
  }),
  clinicianMembershipId: z.string().min(1),
  sections: z
    .array(
      z.object({
        sourceVersionId: z.string().min(1),
        code: sectionCodeSchema,
        version: z.number().int().positive(),
        content: z.string(),
        reviewState: z.enum(['reviewed', 'explicitly_absent']),
        reviewedByMembershipId: z.string().nullable(),
        reviewedAt: z.number().nullable(),
      }),
    )
    .length(8),
  recommendations: z
    .array(
      z.object({
        sourceSuggestionId: z.string().min(1),
        sourceAnalysisRunId: z.string().min(1),
        sourceDecisionId: z.string().min(1),
        sourceDerivativeVersionId: z.string().min(1).nullable(),
        state: z.enum(['accepted', 'edited_and_accepted']),
        original: z.object({
          title: z.string(),
          content: z.string(),
          evidence: z.array(
            z.object({
              sourceId: z.string().min(1),
              quote: z.string().optional(),
            }),
          ),
        }),
        effective: z.object({
          title: z.string(),
          content: z.string(),
          evidence: z.array(
            z.object({
              sourceId: z.string().min(1),
              quote: z.string().optional(),
            }),
          ),
        }),
        provenance: z.object({
          provider: z.string(),
          model: z.string(),
          modelVersion: z.string(),
          policyVersion: z.string(),
          inputHash: z.string(),
          sourceRecordIds: z.array(z.string()),
        }),
        reviewedByMembershipId: z.string().min(1),
        reviewedByDisplayName: z.string().min(1),
        reviewedAt: z.number(),
      }),
    )
    .default([]),
  transcript: z.object({
    included: z.boolean(),
    consentEventId: z.string().nullable(),
    segments: z.array(
      z.object({
        sourceVersionId: z.string().min(1),
        segmentIndex: z.number().int().positive(),
        version: z.number().int().positive(),
        role: z.enum(['doctor', 'patient', 'other', 'unknown']),
        roleSource: z.enum([
          'unassigned',
          'model',
          'voice_calibration',
          'manual',
        ]),
        language: z.enum(['ru', 'kk', 'mixed', 'unknown']),
        text: z.string(),
        startedAtMs: z.number().int().nonnegative(),
        endedAtMs: z.number().int().nonnegative(),
        state: z.enum(['provisional', 'final', 'corrected']),
      }),
    ),
  }),
  amendments: z.array(protocolAmendmentSchema).default([]),
});

export type SignedProtocolContent = z.infer<typeof signedProtocolContentSchema>;

export type ExportAuditEvent = {
  id: string;
  sequence: number;
  actorType: string;
  actorId: string;
  action: string;
  outcome: string;
  purpose: string;
  entityType: string;
  entityId: string;
  requestId: string;
  metadata: unknown;
  previousHash: string | null;
  eventHash: string;
  occurredAt: number;
};

export type SignedProtocolExportSource = {
  protocol: {
    id: string;
    version: number;
    sourceHash: string;
    signedAt: number;
    signedByMembershipId: string;
    signedByDisplayName: string;
  };
  content: SignedProtocolContent;
  auditEvents: ExportAuditEvent[];
};

export type GeneratedArtifact = {
  kind: ExportArtifactKind;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
};

const sectionLabels: Record<
  z.infer<typeof sectionCodeSchema>,
  string
> = {
  complaints: 'Жалобы',
  history_of_present_illness: 'Анамнез заболевания',
  past_medical_history: 'Анамнез жизни',
  allergy_status: 'Аллергологический статус',
  objective_findings: 'Объективные данные',
  preliminary_diagnosis: 'Предварительный диагноз',
  examination_plan: 'План обследования',
  treatment_plan: 'План лечения и наблюдения',
};

const roleLabels = {
  doctor: 'Врач',
  patient: 'Пациент',
  other: 'Другой участник',
  unknown: 'Говорящий не определён',
} as const;

const languageLabels = {
  ru: 'RU',
  kk: 'KK',
  mixed: 'RU/KK',
  unknown: '—',
} as const;

const sexLabels = {
  female: 'Женский',
  male: 'Мужской',
  unknown: 'Не определён',
  not_recorded: 'Не указан',
} as const;

const ink = '1F2933';
const accent = '38566D';
const muted = '66717C';
const line = 'D8DEE3';
const soft = 'F3F5F6';

function formatDateTime(value: number | null) {
  if (value === null) return 'Не указано';
  return `${new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))} UTC`;
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function metadataRow(label: string, value: string) {
  const border = { style: BorderStyle.SINGLE, color: line, size: 2 };
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2700, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: { type: ShadingType.CLEAR, fill: soft },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        borders: { top: border, bottom: border, left: border, right: border },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, bold: true, color: ink })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 6660, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        borders: { top: border, bottom: border, left: border, right: border },
        children: [
          new Paragraph({
            children: [new TextRun({ text: value, color: ink })],
          }),
        ],
      }),
    ],
  });
}

async function buildDocx(source: SignedProtocolExportSource) {
  const { content, protocol } = source;
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: 'СИНТЕТИЧЕСКИЙ КОНТУР · НЕ ДЛЯ ОКАЗАНИЯ МЕДИЦИНСКОЙ ПОМОЩИ',
          bold: true,
          color: accent,
          size: 18,
          characterSpacing: 20,
        }),
      ],
      spacing: { after: 140 },
    }),
    new Paragraph({
      text: 'ORION — Подписанный протокол приёма',
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Версия ${protocol.version} · подписано ${formatDateTime(protocol.signedAt)}`,
          color: muted,
          size: 22,
        }),
      ],
      spacing: { after: 300 },
    }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      indent: { size: 120, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [2700, 6660],
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      rows: [
        metadataRow('Пациент', content.patient.displayName),
        metadataRow('Номер карты', content.patient.medicalRecordNumber),
        metadataRow(
          'Дата рождения / пол',
          `${content.patient.birthDate ?? 'Не указана'} · ${sexLabels[content.patient.sexAtBirth]}`,
        ),
        metadataRow(
          'Приём',
          `${formatDateTime(content.encounter.startedAt)} — ${formatDateTime(content.encounter.endedAt)}`,
        ),
        metadataRow(
          'Причина обращения',
          content.encounter.reasonForVisit ?? 'Не указана',
        ),
        metadataRow(
          'Подписал',
          `${protocol.signedByDisplayName} · ${protocol.signedByMembershipId}`,
        ),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Документ сформирован только из подписанного врачом неизменяемого снимка. Электронная юридически значимая подпись не подключена.',
          color: ink,
          italics: true,
        }),
      ],
      shading: { type: ShadingType.CLEAR, fill: soft },
      border: {
        left: { style: BorderStyle.SINGLE, color: accent, size: 18 },
      },
      indent: { left: 180, right: 180 },
      spacing: { before: 260, after: 260 },
    }),
    new Paragraph({ text: 'Клинический протокол', heading: HeadingLevel.HEADING_1 }),
  ];

  for (const section of content.sections) {
    children.push(
      new Paragraph({
        text: sectionLabels[section.code],
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({
        children: [
          new TextRun({
            text:
              section.reviewState === 'explicitly_absent'
                ? 'Раздел проверен врачом и явно отмечен как отсутствующий.'
                : section.content || 'Проверенный текст отсутствует.',
            italics: section.reviewState === 'explicitly_absent',
            color: section.reviewState === 'explicitly_absent' ? muted : ink,
          }),
        ],
        keepLines: true,
      }),
    );
  }

  children.push(
    new Paragraph({
      text: 'Принятые рекомендации врача',
      heading: HeadingLevel.HEADING_1,
    }),
  );
  if (content.recommendations.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Врач не включил рекомендации ассистента в этот протокол.',
            italics: true,
            color: muted,
          }),
        ],
      }),
    );
  } else {
    for (const recommendation of content.recommendations) {
      const edited = recommendation.state === 'edited_and_accepted';
      const evidenceText = recommendation.effective.evidence
        .map((item) => item.quote ?? item.sourceId)
        .join('; ');
      children.push(
        new Paragraph({
          text: recommendation.effective.title,
          heading: HeadingLevel.HEADING_2,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: edited
                ? 'Принято после редакции врача'
                : 'Принято врачом без изменений',
              bold: true,
              color: accent,
            }),
            new TextRun({
              text: ` · ${recommendation.reviewedByDisplayName} · ${formatDateTime(recommendation.reviewedAt)}`,
              color: muted,
            }),
          ],
          keepNext: true,
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Итоговый текст: ', bold: true }),
            new TextRun(recommendation.effective.content),
          ],
          border: {
            left: { style: BorderStyle.SINGLE, color: accent, size: 12 },
          },
          indent: { left: 180 },
          spacing: { after: 80 },
          keepLines: true,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Основание: ', bold: true, color: muted }),
            new TextRun({
              text: evidenceText || 'Ссылки на основание сохранены в аудите.',
              color: muted,
            }),
          ],
          spacing: { after: edited ? 80 : 160 },
          keepLines: true,
        }),
      );
      if (edited) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: 'Оригинал ИИ (справочно, не является итоговым решением врача): ',
                bold: true,
                color: muted,
              }),
              new TextRun({
                text: recommendation.original.content,
                color: muted,
                italics: true,
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: soft },
            indent: { left: 180, right: 180 },
            spacing: { after: 160 },
            keepLines: true,
          }),
        );
      }
    }
  }

  if (content.amendments.length > 0) {
    children.push(
      new Paragraph({
        text: 'Подписанные корректировки',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const amendment of content.amendments) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Корректировка №${amendment.sequence}`,
              bold: true,
              color: accent,
            }),
            new TextRun({
              text: ` · ${formatDateTime(amendment.signedAt)} · ${amendment.signedByDisplayName}`,
              color: muted,
            }),
          ],
          spacing: { before: 120, after: 60 },
          keepNext: true,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Причина: ', bold: true }),
            new TextRun(amendment.reason),
          ],
          keepNext: true,
        }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Дополнение: ', bold: true }),
            new TextRun(amendment.text),
          ],
          border: {
            left: { style: BorderStyle.SINGLE, color: accent, size: 12 },
          },
          indent: { left: 180 },
          spacing: { after: 120 },
          keepLines: true,
        }),
      );
    }
  }

  children.push(
    new Paragraph({
      text: 'Полная расшифровка разговора',
      heading: HeadingLevel.HEADING_1,
    }),
  );

  if (!content.transcript.included) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Расшифровка не включена: на момент создания протокола не было действующего согласия на её хранение.',
            italics: true,
            color: muted,
          }),
        ],
      }),
    );
  } else {
    for (const segment of content.transcript.segments) {
      const roleColor = segment.role === 'doctor' ? '355F78' : '496B61';
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${roleLabels[segment.role]}  `,
              bold: true,
              color: roleColor,
            }),
            new TextRun({
              text: `${formatClock(segment.startedAtMs)}–${formatClock(segment.endedAtMs)} · ${languageLabels[segment.language]} · сегмент ${segment.segmentIndex}, v${segment.version}`,
              color: muted,
              size: 18,
            }),
            new TextRun({ text: `\n${segment.text}`, break: 1, color: ink }),
          ],
          border: {
            left: { style: BorderStyle.SINGLE, color: roleColor, size: 12 },
          },
          indent: { left: 180 },
          spacing: { before: 80, after: 140 },
          keepLines: true,
        }),
      );
    }
  }

  children.push(
    new Paragraph({
      text: 'Контроль целостности',
      heading: HeadingLevel.HEADING_1,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Идентификатор протокола: ', bold: true }),
        new TextRun(protocol.id),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'SHA-256 снимка: ', bold: true }),
        new TextRun(protocol.sourceHash),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Событий аудита в комплекте: ', bold: true }),
        new TextRun(String(source.auditEvents.length)),
      ],
    }),
  );

  const document = new Document({
    title: `ORION — протокол ${content.encounter.id}`,
    subject: 'Подписанный синтетический клинический протокол',
    creator: 'ORION Clinic',
    description:
      'Синтетический документ. Не предназначен для оказания медицинской помощи.',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: ink },
          paragraph: { spacing: { after: 120, line: 264 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 40, bold: true, color: ink },
          paragraph: { spacing: { before: 0, after: 80 }, keepNext: true },
        },
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 32, bold: true, color: accent },
          paragraph: {
            spacing: { before: 320, after: 160 },
            keepNext: true,
            outlineLevel: 0,
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', size: 26, bold: true, color: accent },
          paragraph: {
            spacing: { before: 240, after: 120 },
            keepNext: true,
            outlineLevel: 1,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
              header: 708,
              footer: 708,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'ORION Clinic · Синтетический контур',
                    color: muted,
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    children: [
                      'ORION · Страница ',
                      PageNumber.CURRENT,
                      ' из ',
                      PageNumber.TOTAL_PAGES,
                    ],
                    color: muted,
                    size: 18,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return new Uint8Array(await Packer.toArrayBuffer(document));
}

function dataUriBytes(value: string) {
  const separator = value.indexOf(',');
  if (separator < 0) throw new Error('Embedded font data is invalid');
  const binary = atob(value.slice(separator + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type PdfFonts = {
  latin: PDFFont;
  cyrillic: PDFFont;
  cyrillicExt: PDFFont;
};

function fontForCharacter(character: string, fonts: PdfFonts) {
  const code = character.codePointAt(0) ?? 0;
  if ((code >= 0x0460 && code <= 0x052f) || (code >= 0xa640 && code <= 0xa69f)) {
    return fonts.cyrillicExt;
  }
  if (
    (code >= 0x0400 && code <= 0x045f) ||
    code === 0x0301 ||
    code === 0x2116
  ) {
    return fonts.cyrillic;
  }
  return fonts.latin;
}

function fontRuns(text: string, fonts: PdfFonts) {
  const result: { text: string; font: PDFFont }[] = [];
  for (const character of text) {
    const font = fontForCharacter(character, fonts);
    const previous = result.at(-1);
    if (previous?.font === font) previous.text += character;
    else result.push({ text: character, font });
  }
  return result;
}

function measurePdfText(text: string, size: number, fonts: PdfFonts) {
  return fontRuns(text, fonts).reduce(
    (width, run) => width + run.font.widthOfTextAtSize(run.text, size),
    0,
  );
}

function wrapPdfText(text: string, width: number, size: number, fonts: PdfFonts) {
  const output: string[] = [];
  for (const sourceLine of text.replace(/\r/g, '').split('\n')) {
    if (!sourceLine) {
      output.push('');
      continue;
    }
    let line = '';
    for (const token of sourceLine.split(/(\s+)/).filter(Boolean)) {
      const candidate = `${line}${token}`;
      if (!line || measurePdfText(candidate, size, fonts) <= width) {
        line = candidate;
        continue;
      }
      output.push(line.trimEnd());
      if (measurePdfText(token, size, fonts) <= width) {
        line = token.trimStart();
        continue;
      }
      line = '';
      for (const character of token) {
        if (line && measurePdfText(`${line}${character}`, size, fonts) > width) {
          output.push(line);
          line = character;
        } else {
          line += character;
        }
      }
    }
    output.push(line.trimEnd());
  }
  return output;
}

async function buildPdf(source: SignedProtocolExportSource) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const pdfFont = await pdf.embedFont(dataUriBytes(golosTextRegular), {
    subset: true,
  });
  const fonts: PdfFonts = {
    latin: pdfFont,
    cyrillic: pdfFont,
    cyrillicExt: pdfFont,
  };
  pdf.setTitle(`ORION — протокол ${source.content.encounter.id}`);
  pdf.setAuthor('ORION Clinic');
  pdf.setSubject('Подписанный синтетический клинический протокол');
  pdf.setCreationDate(new Date(source.protocol.signedAt));
  pdf.setModificationDate(new Date(source.protocol.signedAt));

  const pageWidth = 612;
  const pageHeight = 792;
  const left = 58;
  const right = 58;
  const top = 58;
  const bottom = 54;
  const contentWidth = pageWidth - left - right;
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;

  const addPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    page.drawText('ORION Clinic · Синтетический контур', {
      x: left,
      y: pageHeight - 30,
      size: 8,
      font: fonts.latin,
      color: rgb(0.4, 0.45, 0.49),
    });
    page.drawLine({
      start: { x: left, y: pageHeight - 36 },
      end: { x: pageWidth - right, y: pageHeight - 36 },
      thickness: 0.5,
      color: rgb(0.85, 0.88, 0.9),
    });
    y = pageHeight - top;
  };

  const ensure = (height: number) => {
    if (y - height < bottom) addPage();
  };

  const drawLine = (
    text: string,
    size: number,
    color: ReturnType<typeof rgb>,
    x = left,
  ) => {
    let cursor = x;
    for (const run of fontRuns(text, fonts)) {
      page.drawText(run.text, { x: cursor, y, size, font: run.font, color });
      cursor += run.font.widthOfTextAtSize(run.text, size);
    }
  };

  const paragraph = (
    text: string,
    options: {
      size?: number;
      color?: ReturnType<typeof rgb>;
      before?: number;
      after?: number;
      lineHeight?: number;
      indent?: number;
    } = {},
  ) => {
    const size = options.size ?? 10.5;
    const lineHeight = options.lineHeight ?? size * 1.35;
    const indent = options.indent ?? 0;
    const lines = wrapPdfText(text, contentWidth - indent, size, fonts);
    y -= options.before ?? 0;
    ensure(lines.length * lineHeight + (options.after ?? 0));
    for (const lineText of lines) {
      ensure(lineHeight);
      drawLine(lineText, size, options.color ?? rgb(0.12, 0.16, 0.2), left + indent);
      y -= lineHeight;
    }
    y -= options.after ?? 5;
  };

  const heading = (text: string, level: 1 | 2) => {
    const size = level === 1 ? 15 : 12;
    const before = level === 1 ? 15 : 10;
    ensure(before + size * 2.4);
    paragraph(text, {
      size,
      color: rgb(0.22, 0.34, 0.43),
      before,
      after: level === 1 ? 7 : 4,
      lineHeight: size * 1.2,
    });
  };

  addPage();
  paragraph('СИНТЕТИЧЕСКИЙ КОНТУР · НЕ ДЛЯ ОКАЗАНИЯ МЕДИЦИНСКОЙ ПОМОЩИ', {
    size: 8.5,
    color: rgb(0.22, 0.34, 0.43),
    after: 12,
  });
  paragraph('ORION — Подписанный протокол приёма', {
    size: 20,
    color: rgb(0.12, 0.16, 0.2),
    lineHeight: 24,
    after: 3,
  });
  paragraph(
    `Версия ${source.protocol.version} · подписано ${formatDateTime(source.protocol.signedAt)}`,
    { size: 10, color: rgb(0.4, 0.45, 0.49), after: 14 },
  );

  const metadata = [
    ['Пациент', source.content.patient.displayName],
    ['Номер карты', source.content.patient.medicalRecordNumber],
    [
      'Дата рождения / пол',
      `${source.content.patient.birthDate ?? 'Не указана'} · ${sexLabels[source.content.patient.sexAtBirth]}`,
    ],
    [
      'Приём',
      `${formatDateTime(source.content.encounter.startedAt)} — ${formatDateTime(source.content.encounter.endedAt)}`,
    ],
    ['Причина обращения', source.content.encounter.reasonForVisit ?? 'Не указана'],
    [
      'Подписал',
      `${source.protocol.signedByDisplayName} · ${source.protocol.signedByMembershipId}`,
    ],
  ];
  for (const [label, value] of metadata) {
    ensure(32);
    paragraph(label, {
      size: 8.5,
      color: rgb(0.4, 0.45, 0.49),
      after: 0,
      lineHeight: 10,
    });
    paragraph(value, { size: 10.5, after: 6, lineHeight: 13 });
  }
  paragraph(
    'Документ сформирован только из подписанного врачом неизменяемого снимка. Электронная юридически значимая подпись не подключена.',
    {
      size: 9.5,
      color: rgb(0.22, 0.34, 0.43),
      before: 6,
      after: 8,
      indent: 10,
    },
  );

  heading('Клинический протокол', 1);
  for (const section of source.content.sections) {
    heading(sectionLabels[section.code], 2);
    paragraph(
      section.reviewState === 'explicitly_absent'
        ? 'Раздел проверен врачом и явно отмечен как отсутствующий.'
        : section.content || 'Проверенный текст отсутствует.',
      {
        color:
          section.reviewState === 'explicitly_absent'
            ? rgb(0.4, 0.45, 0.49)
            : rgb(0.12, 0.16, 0.2),
      },
    );
  }

  heading('Принятые рекомендации врача', 1);
  if (source.content.recommendations.length === 0) {
    paragraph('Врач не включил рекомендации ассистента в этот протокол.', {
      color: rgb(0.4, 0.45, 0.49),
    });
  } else {
    for (const recommendation of source.content.recommendations) {
      const edited = recommendation.state === 'edited_and_accepted';
      heading(recommendation.effective.title, 2);
      paragraph(
        `${edited ? 'Принято после редакции врача' : 'Принято врачом без изменений'} · ${recommendation.reviewedByDisplayName} · ${formatDateTime(recommendation.reviewedAt)}`,
        { size: 9, color: rgb(0.22, 0.34, 0.43), after: 3 },
      );
      paragraph(`Итоговый текст: ${recommendation.effective.content}`, {
        indent: 8,
        after: 4,
      });
      const evidenceText = recommendation.effective.evidence
        .map((item) => item.quote ?? item.sourceId)
        .join('; ');
      paragraph(
        `Основание: ${evidenceText || 'Ссылки на основание сохранены в аудите.'}`,
        { size: 9, color: rgb(0.4, 0.45, 0.49), after: edited ? 4 : 10 },
      );
      if (edited) {
        paragraph(
          `Оригинал ИИ (справочно, не является итоговым решением врача): ${recommendation.original.content}`,
          {
            size: 9,
            color: rgb(0.4, 0.45, 0.49),
            indent: 8,
            after: 10,
          },
        );
      }
    }
  }

  if (source.content.amendments.length > 0) {
    heading('Подписанные корректировки', 1);
    for (const amendment of source.content.amendments) {
      paragraph(
        `Корректировка №${amendment.sequence} · ${formatDateTime(amendment.signedAt)} · ${amendment.signedByDisplayName}`,
        { size: 10.5, color: rgb(0.22, 0.34, 0.43), after: 3 },
      );
      paragraph(`Причина: ${amendment.reason}`, { size: 10, after: 3 });
      paragraph(`Дополнение: ${amendment.text}`, {
        size: 10.5,
        indent: 8,
        after: 10,
      });
    }
  }

  heading('Полная расшифровка разговора', 1);
  if (!source.content.transcript.included) {
    paragraph(
      'Расшифровка не включена: на момент создания протокола не было действующего согласия на её хранение.',
      { color: rgb(0.4, 0.45, 0.49) },
    );
  } else {
    for (const segment of source.content.transcript.segments) {
      const roleColor =
        segment.role === 'doctor' ? rgb(0.2, 0.37, 0.47) : rgb(0.29, 0.42, 0.38);
      ensure(48);
      paragraph(
        `${roleLabels[segment.role]} · ${formatClock(segment.startedAtMs)}–${formatClock(segment.endedAtMs)} · ${languageLabels[segment.language]} · сегмент ${segment.segmentIndex}, v${segment.version}`,
        { size: 9, color: roleColor, after: 2, lineHeight: 11, indent: 8 },
      );
      paragraph(segment.text, { size: 10.5, after: 10, indent: 8 });
    }
  }

  heading('Контроль целостности', 1);
  paragraph(`Идентификатор протокола: ${source.protocol.id}`, { size: 9.5 });
  paragraph(`SHA-256 снимка: ${source.protocol.sourceHash}`, { size: 9.5 });
  paragraph(`Событий аудита в комплекте: ${source.auditEvents.length}`, {
    size: 9.5,
  });

  for (const [index, outputPage] of pages.entries()) {
    const footer = `ORION · v${source.protocol.version} · Страница ${index + 1} из ${pages.length}`;
    let x = pageWidth - right;
    for (const run of [...fontRuns(footer, fonts)].reverse()) {
      x -= run.font.widthOfTextAtSize(run.text, 8);
    }
    let cursor = x;
    for (const run of fontRuns(footer, fonts)) {
      outputPage.drawText(run.text, {
        x: cursor,
        y: 28,
        size: 8,
        font: run.font,
        color: rgb(0.4, 0.45, 0.49),
      });
      cursor += run.font.widthOfTextAtSize(run.text, 8);
    }
  }

  return new Uint8Array(await pdf.save());
}

function buildTranscriptText(source: SignedProtocolExportSource) {
  const lines = [
    'ORION — ПОЛНАЯ РАСШИФРОВКА РАЗГОВОРА',
    'Синтетический контур. Не для оказания медицинской помощи.',
    '',
    `Пациент: ${source.content.patient.displayName}`,
    `Номер карты: ${source.content.patient.medicalRecordNumber}`,
    `Приём: ${source.content.encounter.id}`,
    `Протокол: ${source.protocol.id}, версия ${source.protocol.version}`,
    `Подписано: ${formatDateTime(source.protocol.signedAt)}`,
    `SHA-256 снимка: ${source.protocol.sourceHash}`,
    '',
  ];
  if (!source.content.transcript.included) {
    lines.push(
      'Расшифровка не включена: на момент создания протокола не было действующего согласия на её хранение.',
    );
  } else {
    for (const segment of source.content.transcript.segments) {
      lines.push(
        `[${formatClock(segment.startedAtMs)}–${formatClock(segment.endedAtMs)}] ${roleLabels[segment.role]} · ${languageLabels[segment.language]} · сегмент ${segment.segmentIndex}, v${segment.version}`,
        segment.text,
        '',
      );
    }
  }
  return strToU8(lines.join('\r\n'));
}

function buildAuditJson(source: SignedProtocolExportSource) {
  return strToU8(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        dataMode: 'synthetic-only',
        generatedFromSignedSnapshotAt: new Date(source.protocol.signedAt).toISOString(),
        protocol: source.protocol,
        encounter: {
          id: source.content.encounter.id,
          sourceVersion: source.content.encounter.sourceVersion,
        },
        recommendations: source.content.recommendations,
        auditEventCount: source.auditEvents.length,
        auditEvents: source.auditEvents,
      },
      null,
      2,
    )}\n`,
  );
}

export async function generateProtocolArtifacts(
  source: SignedProtocolExportSource,
): Promise<GeneratedArtifact[]> {
  const baseName = `ORION-${source.content.encounter.id}-protocol-v${source.protocol.version}`;
  const initial = [
    {
      kind: 'protocol_docx' as const,
      filename: `${baseName}.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: await buildDocx(source),
    },
    {
      kind: 'protocol_pdf' as const,
      filename: `${baseName}.pdf`,
      mimeType: 'application/pdf',
      bytes: await buildPdf(source),
    },
    {
      kind: 'transcript_txt' as const,
      filename: `${baseName}-transcript.txt`,
      mimeType: 'text/plain; charset=utf-8',
      bytes: buildTranscriptText(source),
    },
    {
      kind: 'audit_json' as const,
      filename: `${baseName}-audit.json`,
      mimeType: 'application/json; charset=utf-8',
      bytes: buildAuditJson(source),
    },
  ];
  const artifacts: GeneratedArtifact[] = [];
  for (const artifact of initial) {
    artifacts.push({ ...artifact, sha256: await sha256Bytes(artifact.bytes) });
  }
  const manifest = strToU8(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        dataMode: 'synthetic-only',
        protocolId: source.protocol.id,
        protocolVersion: source.protocol.version,
        sourceHash: source.protocol.sourceHash,
        files: artifacts.map(({ filename, kind, mimeType, sha256: hash, bytes }) => ({
          filename,
          kind,
          mimeType,
          sha256: hash,
          byteSize: bytes.byteLength,
        })),
      },
      null,
      2,
    )}\n`,
  );
  const bundleBytes = zipSync(
    {
      ...Object.fromEntries(artifacts.map((artifact) => [artifact.filename, artifact.bytes])),
      'manifest.json': manifest,
    },
    { level: 6 },
  );
  artifacts.push({
    kind: 'bundle_zip',
    filename: `${baseName}-complete.zip`,
    mimeType: 'application/zip',
    bytes: bundleBytes,
    sha256: await sha256Bytes(bundleBytes),
  });
  return artifacts;
}
