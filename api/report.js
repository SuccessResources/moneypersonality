import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function wrapText(text, maxCharsPerLine = 85) {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function drawParagraph(page, text, x, y, options = {}) {
  const {
    font,
    size = 12,
    color = rgb(1, 1, 1),
    lineHeight = 18,
    maxCharsPerLine = 85
  } = options;

  const lines = wrapText(text, maxCharsPerLine);
  let currentY = y;

  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }

  return currentY;
}

function safeFilename(name) {
  return String(name || 'Money_Personality_Report')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;

    const {
      personalityName,
      description,
      strengthLabel,
      strengthText,
      shadowLabel,
      shadowText,
      stepLabel,
      stepText,
      mixLabel,
      percentages,
      userName,
      language
    } = body;

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(0.04, 0.18, 0.12)
    });

    page.drawText('Money Personality Report', {
      x: 40,
      y: height - 50,
      size: 16,
      font: fontBold,
      color: rgb(1, 0.84, 0)
    });

    if (userName) {
      page.drawText(`Name: ${userName}`, {
        x: 40,
        y: height - 72,
        size: 10,
        font: fontRegular,
        color: rgb(0.88, 0.95, 0.9)
      });
    }

    if (language) {
      page.drawText(`Language: ${String(language).toUpperCase()}`, {
        x: width - 140,
        y: height - 72,
        size: 10,
        font: fontRegular,
        color: rgb(0.88, 0.95, 0.9)
      });
    }

    page.drawText(personalityName || 'Your Result', {
      x: 40,
      y: height - 120,
      size: 28,
      font: fontBold,
      color: rgb(1, 1, 1)
    });

    let y = height - 155;
    y = drawParagraph(page, description || '', 40, y, {
      font: fontRegular,
      size: 12,
      color: rgb(0.92, 0.96, 0.94),
      lineHeight: 18,
      maxCharsPerLine: 78
    });

    y -= 18;

    page.drawRectangle({
      x: 40,
      y: y - 135,
      width: width - 80,
      height: 125,
      color: rgb(0.09, 0.28, 0.19),
      borderColor: rgb(0.2, 0.7, 0.4),
      borderWidth: 1
    });

    page.drawText(mixLabel || 'Your Personality Mix', {
      x: 55,
      y: y - 25,
      size: 13,
      font: fontBold,
      color: rgb(1, 0.84, 0)
    });

    const entries = Array.isArray(percentages) ? percentages : [];
    let rowY = y - 48;

    entries.forEach((item) => {
      const label = item.label || '';
      const value = Number(item.value || 0);

      page.drawText(label, {
        x: 55,
        y: rowY,
        size: 10,
        font: fontRegular,
        color: rgb(1, 1, 1)
      });

      page.drawRectangle({
        x: 180,
        y: rowY - 1,
        width: 280,
        height: 10,
        color: rgb(0.18, 0.22, 0.2)
      });

      page.drawRectangle({
        x: 180,
        y: rowY - 1,
        width: Math.max(0, Math.min(280, 280 * (value / 100))),
        height: 10,
        color: rgb(0.13, 0.77, 0.37)
      });

      page.drawText(`${value}%`, {
        x: 475,
        y: rowY,
        size: 10,
        font: fontBold,
        color: rgb(1, 0.84, 0)
      });

      rowY -= 24;
    });

    y -= 165;

    const sections = [
      { label: strengthLabel, text: strengthText },
      { label: shadowLabel, text: shadowText },
      { label: stepLabel, text: stepText }
    ];

    for (const section of sections) {
      if (y < 140) {
        page = pdfDoc.addPage([595.28, 841.89]);
        page.drawRectangle({
          x: 0,
          y: 0,
          width,
          height,
          color: rgb(0.04, 0.18, 0.12)
        });
        y = height - 60;
      }

      page.drawRectangle({
        x: 40,
        y: y - 95,
        width: width - 80,
        height: 85,
        color: rgb(0.09, 0.28, 0.19),
        borderColor: rgb(0.2, 0.7, 0.4),
        borderWidth: 1
      });

      page.drawText(section.label || '', {
        x: 55,
        y: y - 22,
        size: 13,
        font: fontBold,
        color: rgb(1, 0.84, 0)
      });

      drawParagraph(page, section.text || '', 55, y - 44, {
        font: fontRegular,
        size: 11,
        color: rgb(0.95, 0.97, 0.96),
        lineHeight: 16,
        maxCharsPerLine: 78
      });

      y -= 110;
    }

    const pdfBytes = await pdfDoc.save();
    const fileName = safeFilename(personalityName || 'Money_Personality_Report');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('PDF generation failed:', error);
    res.status(500).json({
      error: 'Failed to generate PDF',
      message: error.message
    });
  }
}
