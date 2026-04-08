import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function hexToRgb(hex) {
  const clean = String(hex || '#FFD700').replace('#', '');
  const bigint = parseInt(clean, 16);
  return rgb(
    ((bigint >> 16) & 255) / 255,
    ((bigint >> 8) & 255) / 255,
    (bigint & 255) / 255
  );
}

function wrapTextByWidth(text, font, fontSize, maxWidth) {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);

    if (width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function drawWrappedText(page, text, x, y, width, options = {}) {
  const {
    font,
    size = 12,
    color = rgb(1, 1, 1),
    lineHeight = 18
  } = options;

  const lines = wrapTextByWidth(text, font, size, width);
  let currentY = y;

  for (const line of lines) {
    page.drawText(line, {
      x,
      y: currentY,
      size,
      font,
      color
    });
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

  if (contentType.includes('png')) return await pdfDoc.embedPng(bytes);
  return await pdfDoc.embedJpg(bytes);
}

function drawCard(page, x, y, w, h, fillColor, borderColor = null) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: fillColor,
    borderColor: borderColor || fillColor,
    borderWidth: borderColor ? 1 : 0
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      userName = '',
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
    const page1 = pdfDoc.addPage([595.28, 841.89]); // A4
    const page2 = pdfDoc.addPage([595.28, 841.89]);

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const width = 595.28;
    const height = 841.89;

    const bg = rgb(0.04, 0.18, 0.12);
    const card = rgb(0.09, 0.28, 0.19);
    const cardSoft = rgb(0.11, 0.31, 0.21);
    const gold = rgb(1, 0.84, 0);
    const white = rgb(1, 1, 1);
    const softWhite = rgb(0.92, 0.96, 0.94);
    const muted = rgb(0.72, 0.80, 0.75);
    const accent = hexToRgb(personalityColor);
    const barBg = rgb(0.16, 0.22, 0.19);

    // ===== PAGE 1 =====
    page1.drawRectangle({ x: 0, y: 0, width, height, color: bg });

    // top brand line
    page1.drawText('MILLIONAIRE MIND x SUCCESS RESOURCES', {
      x: 40,
      y: 795,
      size: 10,
      font: fontBold,
      color: gold
    });

    page1.drawText(
      userName ? `${userName}, this is your formal Money Personality report` : 'Your formal Money Personality report',
      {
        x: 40,
        y: 765,
        size: 18,
        font: fontBold,
        color: white
      }
    );

    // hero card
    drawCard(page1, 40, 470, 515, 255, card, accent);

    // character image
    try {
      const img = await embedImageFromUrl(pdfDoc, characterImage);
      if (img) {
        const imgW = 150;
        const imgH = 150;
        page1.drawImage(img, {
          x: (width - imgW) / 2,
          y: 545,
          width: imgW,
          height: imgH
        });
      }
    } catch (err) {
      console.error('Character image failed:', err);
    }

    page1.drawText(personalityName, {
      x: 40,
      y: 520,
      size: 30,
      font: fontBold,
      color: accent
    });

    drawWrappedText(page1, description, 40, 490, 515, {
      font: fontRegular,
      size: 12,
      color: softWhite,
      lineHeight: 18
    });

    // best match box
    drawCard(page1, 40, 365, 515, 80, cardSoft, gold);

    page1.drawText('BEST COMPATIBLE PERSONALITY', {
      x: 55,
      y: 425,
      size: 10,
      font: fontBold,
      color: gold
    });

    page1.drawText(bestMatchName || '-', {
      x: 55,
      y: 398,
      size: 18,
      font: fontBold,
      color: white
    });

    drawWrappedText(page1, bestMatchReason || '', 210, 410, 320, {
      font: fontRegular,
      size: 10,
      color: softWhite,
      lineHeight: 14
    });

    // personality mix card
    drawCard(page1, 40, 150, 515, 185, card, gold);

    page1.drawText(mixLabel, {
      x: 55,
      y: 305,
      size: 13,
      font: fontBold,
      color: gold
    });

    let rowY = 275;
    percentages.forEach((item) => {
      const label = String(item?.label || '');
      const value = Number(item?.value || 0);

      page1.drawText(label, {
        x: 55,
        y: rowY,
        size: 10,
        font: fontRegular,
        color: white
      });

      page1.drawRectangle({
        x: 210,
        y: rowY - 3,
        width: 220,
        height: 12,
        color: barBg
      });

      page1.drawRectangle({
        x: 210,
        y: rowY - 3,
        width: Math.max(0, Math.min(220, 220 * (value / 100))),
        height: 12,
        color: accent
      });

      page1.drawText(`${value}%`, {
        x: 450,
        y: rowY,
        size: 10,
        font: fontBold,
        color: gold
      });

      rowY -= 30;
    });

    page1.drawText('Formal Assessment Report', {
      x: 40,
      y: 30,
      size: 10,
      font: fontRegular,
      color: muted
    });

    // ===== PAGE 2 =====
    page2.drawRectangle({ x: 0, y: 0, width, height, color: bg });

    page2.drawText('PERSONALITY INSIGHTS', {
      x: 40,
      y: 785,
      size: 12,
      font: fontBold,
      color: gold
    });

    const sections = [
      { label: strengthLabel, text: strengthText, y: 620 },
      { label: shadowLabel, text: shadowText, y: 455 },
      { label: stepLabel, text: stepText, y: 290 }
    ];

    sections.forEach((section) => {
      drawCard(page2, 40, section.y, 515, 120, card, accent);

      page2.drawText(section.label || '', {
        x: 60,
        y: section.y + 88,
        size: 15,
        font: fontBold,
        color: gold
      });

      drawWrappedText(page2, section.text || '', 60, section.y + 58, 475, {
        font: fontRegular,
        size: 12,
        color: softWhite,
        lineHeight: 18
      });
    });

    page2.drawText('Millionaire Mind x Success Resources', {
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
