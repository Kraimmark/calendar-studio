import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { buildPublicPlan } from '../../domain/publicPlan';
import type { CalendarEvent } from '../../domain/types';

const twips = (millimetres: number) => Math.round(millimetres * 56.7);
const fontSize = 22;
const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cell(value: string, options: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {}): TableCell {
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    width: options.width ? { size: options.width, type: WidthType.DXA } : undefined,
    borders,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    children: [new Paragraph({ alignment: options.align ?? AlignmentType.LEFT, spacing: { before: 0, after: 0, line: 220 }, children: [new TextRun({ text: value, bold: options.bold ?? false, font: 'Times New Roman', size: fontSize })] })],
  });
}

function mergedCell(value: string, restart: boolean, width: number): TableCell {
  return new TableCell({
    verticalMerge: restart ? 'restart' : 'continue',
    verticalAlign: VerticalAlign.CENTER,
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    children: restart ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 220 }, children: [new TextRun({ text: value, bold: true, font: 'Times New Roman', size: fontSize })] })] : [new Paragraph('')],
  });
}

function eventCell(value: string, bold: boolean, separator: boolean, width: number): TableCell {
  const bottom = separator ? { ...border, style: BorderStyle.DASHED } : border;
  return new TableCell({
    verticalAlign: VerticalAlign.CENTER,
    width: { size: width, type: WidthType.DXA },
    borders: { top: border, bottom, left: border, right: border },
    margins: { top: 90, bottom: 90, left: 100, right: 100 },
    children: [new Paragraph({ spacing: { before: 0, after: 0, line: 220 }, children: [new TextRun({ text: value, bold, font: 'Times New Roman', size: fontSize })] })],
  });
}

/** Creates the formal Word plan shown in the supplied 2026 calendar-plan example. */
export async function buildPublicPlanDocument(year: number, events: readonly CalendarEvent[]): Promise<Blob> {
  const widths = { number: twips(7), date: twips(30), event: twips(107), venue: twips(38) };
  const rows: TableRow[] = [new TableRow({
    tableHeader: true,
    children: [
      cell('№', { bold: true, align: AlignmentType.CENTER, width: widths.number }),
      cell('Дата', { bold: true, align: AlignmentType.CENTER, width: widths.date }),
      cell('Мероприятие', { bold: true, align: AlignmentType.CENTER, width: widths.event }),
      cell('Место проведения', { bold: true, align: AlignmentType.CENTER, width: widths.venue }),
    ],
  })];

  for (const month of buildPublicPlan(year, events)) {
    rows.push(new TableRow({ children: [new TableCell({
      columnSpan: 4,
      verticalAlign: VerticalAlign.CENTER,
      borders,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9E1F2' },
      margins: { top: 90, bottom: 90, left: 100, right: 100 },
      children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: month.label, bold: true, font: 'Times New Roman', size: fontSize })] })],
    })] }));
    for (let index = 0; index < month.rows.length;) {
      const first = month.rows[index]!;
      const group = [first];
      index += 1;
      while (index < month.rows.length && month.rows[index]!.groupKey === first.groupKey && month.rows[index]!.date === first.date && month.rows[index]!.venue === first.venue) {
        group.push(month.rows[index]!);
        index += 1;
      }
      group.forEach((item, groupIndex) => {
        const isFirst = groupIndex === 0;
        rows.push(new TableRow({ children: [
          mergedCell('', isFirst, widths.number),
          mergedCell(item.date, isFirst, widths.date),
          eventCell(item.title, item.isPrimary, groupIndex < group.length - 1, widths.event),
          mergedCell(item.venue, isFirst, widths.venue),
        ] }));
      });
    }
  }

  const document = new Document({
    sections: [{
      properties: {
        page: { size: { width: twips(210), height: twips(297) }, margin: { top: twips(15), right: twips(14), bottom: twips(15), left: twips(14) } },
      },
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 240 }, children: [new TextRun({ text: 'Проект календарного плана федерации практической стрельбы Санкт-Петербург', bold: true, font: 'Times New Roman', size: 26 })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 180, line: 240 }, children: [new TextRun({ text: `на ${year} год`, bold: true, font: 'Times New Roman', size: 26 })] }),
        new Table({ width: { size: twips(182), type: WidthType.DXA }, columnWidths: [widths.number, widths.date, widths.event, widths.venue], rows }),
      ],
    }],
  });
  return Packer.toBlob(document);
}
