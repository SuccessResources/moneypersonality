const {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFName,
  PDFString,
  PDFArray,
} = require('pdf-lib');

function safePdfText(value) {
  return String(value ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/©/g, '(c)')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function encodeFilename(filename) {
  return String(filename || 'Money_Personality_Report')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 100);
}

function lerpColor(c1, c2, t) {
  return rgb(
    c1.red + (c2.red - c1.red) * t,
    c1.green + (c2.green - c1.green) * t,
    c1.blue + (c2.blue - c1.blue) * t
  );
}

function drawGradientV(page, x, y, w, h, colorTop, colorBottom, steps = 24) {
  const stepH = h / steps;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    page.drawRectangle({
      x,
      y: y + h - (i + 1) * stepH,
      width: w,
      height: stepH + 0.5,
      color: lerpColor(colorTop, colorBottom, t),
    });
  }
}

function drawGradientH(page, x, y, w, h, colorLeft, colorRight, steps = 30) {
  const stepW = w / steps;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    page.drawRectangle({
      x: x + i * stepW,
      y,
      width: stepW + 0.5,
      height: h,
      color: lerpColor(colorLeft, colorRight, t),
    });
  }
}

function wrapTextByWidth(text, font, fontSize, maxWidth) {
  const safe = safePdfText(text);
  if (!safe) return [''];

  const words = safe.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
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
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, width);
  let currentY = y;

  for (const line of lines) {
    page.drawText(safePdfText(line), {
      x,
      y: currentY,
      size,
      font,
      color,
    });
    currentY -= lineHeight;
  }

  return currentY;
}

function drawCentered(page, text, y, pageWidth, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1) } = options;
  const safe = safePdfText(text);
  const textWidth = font.widthOfTextAtSize(safe, size);

  page.drawText(safe, {
    x: (pageWidth - textWidth) / 2,
    y,
    size,
    font,
    color,
  });
}

function drawCenteredWrapped(page, text, y, pageWidth, maxWidth, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, maxWidth);
  let currentY = y;

  for (const line of lines) {
    const safe = safePdfText(line);
    const textWidth = font.widthOfTextAtSize(safe, size);

    page.drawText(safe, {
      x: (pageWidth - textWidth) / 2,
      y: currentY,
      size,
      font,
      color,
    });

    currentY -= lineHeight;
  }

  return currentY;
}

function drawDivider(page, x, y, w, color, thickness = 1) {
  page.drawRectangle({ x, y, width: w, height: thickness, color });
}

function drawCard(page, x, y, w, h, fillColor, borderColor = null, borderWidth = 1) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: fillColor,
    borderColor: borderColor || fillColor,
    borderWidth: borderColor ? borderWidth : 0,
  });
}

function drawDecoCorner(page, x, y, size, color, flip = false) {
  const d = flip ? -1 : 1;
  page.drawRectangle({ x, y, width: size * d, height: 1.5, color });
  page.drawRectangle({ x, y, width: 1.5, height: size * d, color });
}

function drawDiamond(page, cx, cy, size, color) {
  const s = size / 2;

  for (let i = -s; i <= s; i += 0.5) {
    const halfWidth = s - Math.abs(i);

    if (halfWidth > 0) {
      page.drawRectangle({
        x: cx - halfWidth,
        y: cy + i,
        width: halfWidth * 2,
        height: 0.6,
        color,
      });
    }
  }
}

async function embedImageFromUrl(pdfDoc, url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('png')) {
      return await pdfDoc.embedPng(bytes);
    }

    return await pdfDoc.embedJpg(bytes);
  } catch (error) {
    console.error('Image embed failed:', error.message);
    return null;
  }
}

function addLinkAnnotation(pdfDoc, page, x, y, w, h, url) {
  const context = pdfDoc.context;

  const uriAction = context.obj({
    Type: 'Action',
    S: 'URI',
    URI: PDFString.of(url),
  });

  const annotation = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: uriAction,
    F: 4,
  });

  const annotationRef = context.register(annotation);
  const existing = page.node.get(PDFName.of('Annots'));

  if (existing instanceof PDFArray) {
    existing.push(annotationRef);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([annotationRef]));
  }
}

const deepInsights = {
  saver: {
    strength:
      'You are naturally wired for security, structure, and control when it comes to money. You think ahead, consider consequences, and make decisions with caution. This gives you a major advantage: stability.',
    shadow:
      'The same instinct that protects you can also limit you. Because you value certainty, you may hesitate when opportunities involve risk, change, or unfamiliar territory.',
    step:
      'Your next step is not simply to save more. It is to expand your relationship with money beyond protection and into growth. Learn how to invest wisely, take measured risks, and let your money work for you.',
  },
  spender: {
    strength:
      'You naturally connect money with energy, enjoyment, generosity, and memorable experiences. You know how to celebrate progress and make life feel meaningful in real time.',
    shadow:
      'The challenge is that pleasure without structure can become instability. You may spend before thinking or underestimate the long-term effect of repeated financial decisions.',
    step:
      'Your next step is not to stop enjoying life. It is to build a structure strong enough to support your lifestyle. Save first, automate one transfer, or set limits that protect your goals.',
  },
  monk: {
    strength:
      'You naturally place more value on peace, simplicity, and inner balance than on status or material display. You are less likely to let money define your worth.',
    shadow:
      'The risk is that peace can quietly turn into disengagement. You may avoid learning how wealth works or underestimate how useful money can be in supporting your purpose.',
    step:
      'Your next step is not to become materialistic. It is to build a healthier relationship with wealth as a tool that protects your peace, expands your options, and supports what matters.',
  },
  avoider: {
    strength:
      'Even if it does not feel like it yet, you have more potential with money than you may realize. Once you decide to engage, meaningful change can happen surprisingly quickly.',
    shadow:
      'Your main challenge is not lack of intelligence or ability. It is avoidance. When money feels stressful, your instinct may be to delay, ignore, or disconnect from it.',
    step:
      'Your next step is not perfection. It is momentum. Review one account, track one expense category, pay one overdue item, or set one simple money routine.',
  },
};

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const {
      userName = '',
      personalityType = '',
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
      bestMatchName = '',
      bestMatchReason = '',
      percentages = [],
      quizDate = '',
      format = 'pdf',
    } = body;

    const normalizedType = String(personalityType || '').toLowerCase().trim();

    const resolvedStrengthText =
      deepInsights[normalizedType]?.strength || strengthText;

    const resolvedShadowText =
      deepInsights[normalizedType]?.shadow || shadowText;

    const resolvedStepText =
      deepInsights[normalizedType]?.step || stepText;

    const pdfDoc = await PDFDocument.create();
    const width = 595.28;
    const height = 841.89;

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const midnight = rgb(0.04, 0.18, 0.12);
    const forestDeep = rgb(0.06, 0.24, 0.16);
    const cardDark = rgb(0.1, 0.32, 0.22);
    const cardMid = rgb(0.12, 0.38, 0.27);
    const accent = rgb(0.13, 0.77, 0.37);
    const accentDim = rgb(0.1, 0.45, 0.24);
    const successGreen = rgb(0.13, 0.77, 0.37);
    const greenLight = rgb(0.24, 0.84, 0.47);
    const gold = rgb(1, 0.84, 0);
    const goldLight = rgb(1, 0.91, 0.35);
    const goldDim = rgb(0.62, 0.5, 0.12);
    const mutedGold = rgb(0.78, 0.66, 0.18);
    const white = rgb(1, 1, 1);
    const offWhite = rgb(0.95, 0.97, 0.95);
    const softGray = rgb(0.72, 0.78, 0.74);

    const displayDate =
      quizDate ||
      new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

    const page1 = pdfDoc.addPage([width, height]);

    drawGradientV(page1, 0, 0, width, height, midnight, forestDeep, 30);
    drawGradientH(page1, 0, height - 4, width, 4, gold, successGreen, 40);
    drawDecoCorner(page1, 35, height - 40, 30, goldDim);
    drawDecoCorner(page1, width - 35, 40, 30, goldDim, true);

    drawCentered(page1, 'MILLIONAIRE MIND', height - 100, width, {
      font: fontBold,
      size: 12,
      color: gold,
    });

    drawDivider(page1, width / 2 - 60, height - 116, 120, goldDim);

    drawCentered(page1, 'MONEY PERSONALITY', height - 158, width, {
      font: fontBold,
      size: 28,
      color: white,
    });

    drawCentered(page1, 'ASSESSMENT REPORT', height - 190, width, {
      font: fontBold,
      size: 28,
      color: gold,
    });

    if (userName) {
      drawCentered(page1, 'Prepared exclusively for', height - 232, width, {
        font: fontOblique,
        size: 11,
        color: softGray,
      });

      drawCentered(page1, userName, height - 256, width, {
        font: fontBold,
        size: 22,
        color: offWhite,
      });
    }

    drawCentered(page1, displayDate, height - 284, width, {
      font: fontRegular,
      size: 10,
      color: softGray,
    });

    const character = await embedImageFromUrl(pdfDoc, characterImage);

    if (character) {
      const imageSize = 180;
      page1.drawImage(character, {
        x: (width - imageSize) / 2,
        y: height - 495,
        width: imageSize,
        height: imageSize,
      });
    }

    const badgeW = 360;
    const badgeH = 48;
    const badgeX = (width - badgeW) / 2;
    const badgeY = height - 548;

    drawGradientH(page1, badgeX, badgeY, badgeW, badgeH, accentDim, accent, 20);
    drawDivider(page1, badgeX, badgeY + badgeH - 1, badgeW, gold, 1);
    drawDivider(page1, badgeX, badgeY, badgeW, gold, 1);

    drawCentered(page1, personalityName.toUpperCase(), badgeY + 15, width, {
      font: fontBold,
      size: 20,
      color: white,
    });

    drawCenteredWrapped(page1, description, badgeY - 28, width, 440, {
      font: fontRegular,
      size: 11,
      color: offWhite,
      lineHeight: 17,
    });

    drawDivider(page1, 40, 65, width - 80, goldDim, 0.5);

    drawCentered(page1, 'CONFIDENTIAL | PERSONAL ASSESSMENT', 45, width, {
      font: fontRegular,
      size: 8,
      color: softGray,
    });

    const page2 = pdfDoc.addPage([width, height]);

    drawGradientV(page2, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page2, 0, height - 3, width, 3, gold, successGreen, 40);

    page2.drawText('02', {
      x: 40,
      y: height - 52,
      size: 36,
      font: fontBold,
      color: goldDim,
    });

    page2.drawText('YOUR PERSONALITY BLUEPRINT', {
      x: 92,
      y: height - 42,
      size: 13,
      font: fontBold,
      color: gold,
    });

    drawDivider(page2, 40, height - 62, width - 80, goldDim, 0.5);

    const mixCardY = height - 380;
    const mixCardH = 290;

    drawCard(page2, 40, mixCardY, width - 80, mixCardH, cardDark, cardMid);

    page2.drawText(safePdfText(mixLabel).toUpperCase(), {
      x: 65,
      y: mixCardY + mixCardH - 35,
      size: 12,
      font: fontBold,
      color: gold,
    });

    drawDivider(page2, 65, mixCardY + mixCardH - 48, 160, goldDim, 0.5);

    let barY = mixCardY + mixCardH - 82;
    const barMaxW = 260;
    const barH = 18;
    const maxVal = Math.max(...percentages.map((p) => Number(p?.value || 0)), 1);

    percentages.forEach((item) => {
      const label = safePdfText(item?.label || '');
      const value = Number(item?.value || 0);
      const isTop = value >= maxVal;

      page2.drawText(label, {
        x: 65,
        y: barY + 3,
        size: 11,
        font: isTop ? fontBold : fontRegular,
        color: isTop ? white : offWhite,
      });

      page2.drawRectangle({
        x: 210,
        y: barY - 2,
        width: barMaxW,
        height: barH,
        color: rgb(0.18, 0.18, 0.2),
      });

      const fillW = Math.max(0, Math.min(barMaxW, barMaxW * (value / 100)));

      if (fillW > 2) {
        drawGradientH(
          page2,
          210,
          barY - 2,
          fillW,
          barH,
          isTop ? accent : goldDim,
          isTop ? gold : mutedGold,
          15
        );
      }

      page2.drawText(`${value}%`, {
        x: 485,
        y: barY + 3,
        size: 11,
        font: fontBold,
        color: isTop ? gold : softGray,
      });

      barY -= 44;
    });

    const matchCardY = mixCardY - 180;
    const matchCardH = 150;

    drawCard(page2, 40, matchCardY, width - 80, matchCardH, cardDark, successGreen, 1.5);

    page2.drawRectangle({
      x: 40,
      y: matchCardY,
      width: 4,
      height: matchCardH,
      color: successGreen,
    });

    page2.drawText('BEST COMPATIBLE PERSONALITY', {
      x: 65,
      y: matchCardY + matchCardH - 30,
      size: 10,
      font: fontBold,
      color: greenLight,
    });

    page2.drawText(safePdfText(bestMatchName || '-'), {
      x: 65,
      y: matchCardY + matchCardH - 58,
      size: 20,
      font: fontBold,
      color: white,
    });

    drawWrappedText(page2, bestMatchReason || '', 65, matchCardY + matchCardH - 80, width - 140, {
      font: fontRegular,
      size: 10,
      color: offWhite,
      lineHeight: 15,
    });

    const quoteY = matchCardY - 80;

    drawCentered(page2, '"Your relationship with money is a mirror', quoteY, width, {
      font: fontOblique,
      size: 12,
      color: softGray,
    });

    drawCentered(page2, 'of your relationship with yourself."', quoteY - 18, width, {
      font: fontOblique,
      size: 12,
      color: softGray,
    });

    drawCentered(page2, '- T. Harv Eker', quoteY - 48, width, {
      font: fontBold,
      size: 12,
      color: gold,
    });

    drawDivider(page2, 40, 45, width - 80, goldDim, 0.5);

    page2.drawText('Money Personality Assessment Report', {
      x: 40,
      y: 28,
      size: 8,
      font: fontRegular,
      color: softGray,
    });

    const page3 = pdfDoc.addPage([width, height]);

    drawGradientV(page3, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page3, 0, height - 3, width, 3, gold, successGreen, 40);

    page3.drawText('03', {
      x: 40,
      y: height - 52,
      size: 36,
      font: fontBold,
      color: goldDim,
    });

    page3.drawText('DEEP PERSONALITY INSIGHTS', {
      x: 92,
      y: height - 42,
      size: 13,
      font: fontBold,
      color: gold,
    });

    drawDivider(page3, 40, height - 62, width - 80, goldDim, 0.5);

    const sections = [
      {
        label: strengthLabel,
        text: resolvedStrengthText,
        accentColor: successGreen,
      },
      {
        label: shadowLabel,
        text: resolvedShadowText,
        accentColor: rgb(0.75, 0.45, 0.12),
      },
      {
        label: stepLabel,
        text: resolvedStepText,
        accentColor: accent,
      },
    ];

    let sectionY = height - 100;

    sections.forEach((section) => {
      const cardH = 195;
      const cardY = sectionY - cardH;

      drawCard(page3, 40, cardY, width - 80, cardH, cardDark, cardMid);

      page3.drawRectangle({
        x: 40,
        y: cardY,
        width: 4,
        height: cardH,
        color: section.accentColor,
      });

      page3.drawText(safePdfText(section.label).toUpperCase(), {
        x: 65,
        y: cardY + cardH - 32,
        size: 14,
        font: fontBold,
        color: gold,
      });

      drawDivider(page3, 65, cardY + cardH - 46, 200, goldDim, 0.5);

      drawWrappedText(page3, section.text || '', 65, cardY + cardH - 68, width - 140, {
        font: fontRegular,
        size: 11,
        color: offWhite,
        lineHeight: 16,
      });

      sectionY = cardY - 22;
    });

    drawDivider(page3, 40, 45, width - 80, goldDim, 0.5);

    page3.drawText('Money Personality Assessment Report', {
      x: 40,
      y: 28,
      size: 8,
      font: fontRegular,
      color: softGray,
    });

    const page4 = pdfDoc.addPage([width, height]);

    drawGradientV(page4, 0, 0, width, height, rgb(0.06, 0.12, 0.07), midnight, 40);
    drawGradientH(page4, 0, height - 4, width, 4, gold, successGreen, 40);
    drawDecoCorner(page4, 35, height - 40, 30, gold);
    drawDecoCorner(page4, width - 35, 40, 30, gold, true);

    drawCentered(page4, 'NOW YOU KNOW YOUR', height - 120, width, {
      font: fontBold,
      size: 15,
      color: softGray,
    });

    drawCentered(page4, 'MONEY PERSONALITY.', height - 142, width, {
      font: fontBold,
      size: 15,
      color: softGray,
    });

    drawCentered(page4, "IT'S TIME TO", height - 198, width, {
      font: fontBold,
      size: 32,
      color: white,
    });

    drawCentered(page4, 'REWRITE YOUR', height - 236, width, {
      font: fontBold,
      size: 32,
      color: gold,
    });

    drawCentered(page4, 'MONEY BLUEPRINT.', height - 274, width, {
      font: fontBold,
      size: 32,
      color: gold,
    });

    drawDivider(page4, width / 2 - 80, height - 300, 160, gold, 1.5);

    const eventCardW = 430;
    const eventCardH = 195;
    const eventCardX = (width - eventCardW) / 2;
    const eventCardY = height - 520;

    drawCard(page4, eventCardX, eventCardY, eventCardW, eventCardH, cardDark, accent, 1.5);

    drawCentered(page4, 'MILLIONAIRE MIND HYBRID', eventCardY + eventCardH - 35, width, {
      font: fontBold,
      size: 19,
      color: gold,
    });

    drawCentered(page4, 'LIVE ONLINE EVENT', eventCardY + eventCardH - 60, width, {
      font: fontBold,
      size: 12,
      color: white,
    });

    drawDivider(page4, eventCardX + 40, eventCardY + eventCardH - 75, eventCardW - 80, goldDim, 0.5);

    const bullets = [
      'Discover the 17 wealth principles of millionaires',
      'Reset your financial thermostat in 3 days',
      'Join thousands transforming their money blueprint',
      "Learn directly from T. Harv Eker's proven system",
    ];

    let bulletY = eventCardY + eventCardH - 100;

    bullets.forEach((bullet) => {
      const text = `    ${bullet}`;
      const textWidth = fontRegular.widthOfTextAtSize(text, 10);
      const textX = (width - textWidth) / 2;

      drawDiamond(page4, textX + 4, bulletY + 3, 5, gold);

      drawCentered(page4, text, bulletY, width, {
        font: fontRegular,
        size: 10,
        color: offWhite,
      });

      bulletY -= 22;
    });

    const ctaW = 340;
    const ctaH = 54;
    const ctaX = (width - ctaW) / 2;
    const ctaY = eventCardY - 78;

    drawGradientH(page4, ctaX, ctaY, ctaW, ctaH, gold, goldLight, 20);

    drawCentered(page4, 'CLAIM YOUR SEAT NOW', ctaY + 18, width, {
      font: fontBold,
      size: 17,
      color: midnight,
    });

    addLinkAnnotation(
      pdfDoc,
      page4,
      ctaX,
      ctaY,
      ctaW,
      ctaH,
      'https://www.millionairemind.online/'
    );

    const urlText = 'www.millionairemind.online';

    drawCentered(page4, urlText, ctaY - 28, width, {
      font: fontBold,
      size: 12,
      color: gold,
    });

    const urlTextW = fontRegular.widthOfTextAtSize(urlText, 12);
    const urlTextX = (width - urlTextW) / 2;

    addLinkAnnotation(
      pdfDoc,
      page4,
      urlTextX - 5,
      ctaY - 34,
      urlTextW + 10,
      18,
      'https://www.millionairemind.online/'
    );

    if (userName) {
      drawCentered(
        page4,
        `${userName}, your blueprint is waiting to be rewritten.`,
        ctaY - 78,
        width,
        {
          font: fontOblique,
          size: 12,
          color: offWhite,
        }
      );
    }

    drawCentered(
      page4,
      'The knowledge you need. The transformation you deserve.',
      ctaY - 105,
      width,
      {
        font: fontOblique,
        size: 11,
        color: softGray,
      }
    );

    drawDivider(page4, 40, 65, width - 80, goldDim, 0.5);

    drawCentered(page4, 'MILLIONAIRE MIND x SUCCESS RESOURCES', 45, width, {
      font: fontBold,
      size: 9,
      color: gold,
    });

    drawCentered(page4, '(c) 2026 Success Resources. All rights reserved.', 28, width, {
      font: fontRegular,
      size: 7,
      color: softGray,
    });

    const pdfBytes = await pdfDoc.save();
    const baseFilename = encodeFilename(
      `${userName ? `${userName}_` : ''}${personalityName}_Report`
    );

    if (format === 'thumbnail') {
      return res.status(200).json({
        pdfBase64: Buffer.from(pdfBytes).toString('base64'),
        fileName: `${baseFilename}.pdf`,
        pageCount: pdfDoc.getPageCount(),
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);

    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('PDF generation failed:', error);

    return res.status(500).json({
      error: 'Failed to generate PDF',
      message: error.message,
    });
  }
};
