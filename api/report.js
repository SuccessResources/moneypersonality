import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function wrapText(text, maxCharsPerLine = 80) {
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
    maxCharsPerLine = 80
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

async function embedImageFromUrl(pdfDoc, url) {
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image: ${url}`);

  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('png')) {
    return await pdfDoc.embedPng(bytes);
  }

  return await pdfDoc.embedJpg(bytes);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      userName = '',
      language = 'en',
      personalityName = 'Money Personality',
      description = '',
      strengthLabel = 'Your Strengths',
      strengthText = '',
      shadowLabel = 'Watch Out For',
      shadowText = '',
      stepLabel = 'Your Next Step',
      stepText = '',
      mixLabel = 'Your Personality Mix',
      characterImage = '',
      personalityColor = '#FFD700',
      bestMatchName = '',
      bestMatchReason = '',
      percentages = []
    } = body || {};

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const gold = rgb(1, 0.84, 0);
    const white = rgb(1, 1, 1);
    const softWhite = rgb(0.92, 0.96, 0.94);
    const greenDark = rgb(0.04, 0.18, 0.12);
    const card = rgb(0.09, 0.28, 0.19);
    const barBg = rgb(0.18, 0.22, 0.20);
    const barFill = rgb(0.13, 0.77, 0.37);

    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: greenDark
    });

    page.drawText('Millionaire Mind × Success Resources', {
      x: 40,
      y: height - 40,
      size: 11,
      font: fontBold,
      color: gold
    });

    page.drawText(
      userName ? `${userName}, here is your personalized result` : 'Here is your personalized result',
      {
        x: 40,
        y: height - 68,
        size: 18,
        font: fontBold,
        color: white
      }
    );

    let imageTopY = height - 110;

    try {
      const embeddedImage = await embedImageFromUrl(pdfDoc, characterImage);
      if (embeddedImage) {
        const imgWidth = 150;
        const imgHeight = 150;
        page.drawImage(embeddedImage, {
          x: (width - imgWidth) / 2,
          y: imageTopY - imgHeight,
          width: imgWidth,
          height: imgHeight
        });
      }
    } catch (err) {
      console.error('Character image embed failed:', err);
    }

    page.drawText(personalityName, {
      x: 40,
      y: 510,
      size: 28,
      font: fontBold,
      color: gold
    });

    let y = 480;
    y = drawParagraph(page, description, 40, y, {
      font: fontRegular,
      size: 12,
      color: softWhite,
      lineHeight: 18,
      maxCharsPerLine: 78
    });

    y -= 15;

    page.drawRectangle({
      x: 40,
      y: y - 85,
      width: width - 80,
      height: 75,
      color: card
    });

    page.drawText('Best Compatible Personality', {
      x: 55,
      y: y - 24,
      size: 12,
      font: fontBold,
      color: gold
    });

    page.drawText(bestMatchName || '-', {
      x: 55,
      y: y - 46,
      size: 16,
      font: fontBold,
      color: white
    });

    drawParagraph(page, bestMatchReason || '', 200, y - 28, {
      font: fontRegular,
      size: 10,
      color: softWhite,
      lineHeight: 14,
      maxCharsPerLine: 48
    });

    y -= 110;

    page.drawRectangle({
      x: 40,
      y: y - 140,
      width: width - 80,
      height: 130,
      color: card
    });

    page.drawText(mixLabel, {
      x: 55,
      y: y - 24,
      size: 13,
      font: fontBold,
      color: gold
    });

    let rowY = y - 50;

    percentages.forEach((item) => {
      const label = String(item?.label || '');
      const value = Number(item?.value || 0);

      page.drawText(label, {
        x: 55,
        y: rowY,
        size: 10,
        font: fontRegular,
        color: white
      });

      page.drawRectangle({
        x: 190,
        y: rowY - 2,
        width: 230,
        height: 10,
        color: barBg
      });

      page.drawRectangle({
        x: 190,
        y: rowY - 2,
        width: Math.max(0, Math.min(230, 230 * (value / 100))),
        height: 10,
        color: barFill
      });

      page.drawText(`${value}%`, {
        x: 440,
        y: rowY,
        size: 10,
        font: fontBold,
        color: gold
      });

      rowY -= 22;
    });

    page = pdfDoc.addPage([595.28, 841.89]);

    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: greenDark
    });

    let y2 = height - 50;

    const sections = [
      { label: strengthLabel, text: strengthText },
      { label: shadowLabel, text: shadowText },
      { label: stepLabel, text: stepText }
    ];

    sections.forEach((section) => {
      page.drawRectangle({
        x: 40,
        y: y2 - 110,
        width: width - 80,
        height: 95,
        color: card
      });

      page.drawText(section.label || '', {
        x: 55,
        y: y2 - 28,
        size: 14,
        font: fontBold,
        color: gold
      });

      drawParagraph(page, section.text || '', 55, y2 - 52, {
        font: fontRegular,
        size: 11,
        color: softWhite,
        lineHeight: 16,
        maxCharsPerLine: 78
      });

      y2 -= 125;
    });

    page.drawText('Millionaire Mind × Success Resources', {
      x: 40,
      y: 30,
      size: 10,
      font: fontBold,
      color: gold
    });

    const pdfBytes = await pdfDoc.save();
    const fileName = safeFilename(`${userName ? userName + '_' : ''}${personalityName}`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.pdf"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('PDF generation failed:', error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      message: error.message
    });
  }
}
