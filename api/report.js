import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ================================================================
// COLOR HELPERS
// ================================================================

function hexToRgb(hex) {
  const clean = String(hex || '#C9A227').replace('#', '');
  const bigint = parseInt(clean, 16);
  return rgb(
    ((bigint >> 16) & 255) / 255,
    ((bigint >> 8) & 255) / 255,
    (bigint & 255) / 255
  );
}

function lerpColor(c1, c2, t) {
  return rgb(
    c1.red + (c2.red - c1.red) * t,
    c1.green + (c2.green - c1.green) * t,
    c1.blue + (c2.blue - c1.blue) * t
  );
}

// ================================================================
// TEXT HELPERS
// ================================================================

function wrapText(text, font, fontSize, maxWidth) {
  if (!text) return [''];
  const words = String(text).split(/\s+/);
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

function drawWrapped(page, text, x, y, width, opts = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = opts;
  const lines = wrapText(text, font, size, width);
  let cy = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cy, size, font, color });
    cy -= lineHeight;
  }
  return cy;
}

function drawCentered(page, text, y, pageWidth, opts = {}) {
  const { font, size = 12, color = rgb(1, 1, 1) } = opts;
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageWidth - tw) / 2, y, size, font, color });
}

function drawCenteredWrapped(page, text, y, pageWidth, maxWidth, opts = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = opts;
  const lines = wrapText(text, font, size, maxWidth);
  let cy = y;
  for (const line of lines) {
    const tw = font.widthOfTextAtSize(line, size);
    page.drawText(line, { x: (pageWidth - tw) / 2, y: cy, size, font, color });
    cy -= lineHeight;
  }
  return cy;
}

// ================================================================
// DRAWING HELPERS
// ================================================================

function drawGradientRect(page, x, y, w, h, colorTop, colorBottom, steps = 20) {
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = lerpColor(colorTop, colorBottom, t);
    page.drawRectangle({
      x, y: y + h - (i + 1) * stepH,
      width: w, height: stepH + 0.5, color: c
    });
  }
}

function drawGradientBar(page, x, y, w, h, colorLeft, colorRight, steps = 30) {
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = lerpColor(colorLeft, colorRight, t);
    page.drawRectangle({
      x: x + i * stepW, y,
      width: stepW + 0.5, height: h, color: c
    });
  }
}

function drawDivider(page, x, y, w, color, thickness = 1) {
  page.drawRectangle({ x, y, width: w, height: thickness, color });
}

function drawCard(page, x, y, w, h, fillColor, borderColor = null, borderWidth = 1) {
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fillColor,
    borderColor: borderColor || undefined,
    borderWidth: borderColor ? borderWidth : 0
  });
}

function drawDecoCorner(page, x, y, size, color, flip = false) {
  const dir = flip ? -1 : 1;
  page.drawRectangle({ x, y, width: size * dir, height: 1.5, color });
  page.drawRectangle({ x, y, width: 1.5, height: size * dir, color });
}

function drawDiamond(page, cx, cy, size, color) {
  const s = size / 2;
  for (let i = -s; i <= s; i += 0.5) {
    const hw = s - Math.abs(i);
    if (hw > 0) {
      page.drawRectangle({
        x: cx - hw, y: cy + i,
        width: hw * 2, height: 0.6, color
      });
    }
  }
}

async function embedImage(pdfDoc, url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('png')) return pdfDoc.embedPng(bytes);
    return pdfDoc.embedJpg(bytes);
  } catch (err) {
    console.error('Image embed failed:', err.message);
    return null;
  }
}

async function fetchFontBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font fetch failed: ${response.status} ${url}`);
  return await response.arrayBuffer();
}

function safeFilename(name) {
  return String(name || 'Money_Personality_Report')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ================================================================
// CLICKABLE LINK ANNOTATION
// ================================================================

function addLinkAnnotation(pdfDoc, page, x, y, w, h, url) {
  const context = pdfDoc.context;

  const uriAction = context.obj({
    Type: 'Action',
    S: 'URI',
    URI: PDFString.of(url)
  });

  const annotDict = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: uriAction,
    F: 4
  });

  const annotRef = context.register(annotDict);

  const existingAnnots = page.node.get(PDFName.of('Annots'));
  if (existingAnnots instanceof PDFArray) {
    existingAnnots.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  }
}

// ================================================================
// FONT LOADING - Google Fonts via GitHub raw TTF files
// ================================================================

const FONT_URLS = {
  oswaldBold: 'https://github.com/googlefonts/OswaldFont/raw/main/fonts/ttf/Oswald-Bold.ttf',
  oswaldExtraBold: 'https://github.com/googlefonts/OswaldFont/raw/main/fonts/ttf/Oswald-ExtraBold.ttf',
  openSansRegular: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-Regular.ttf',
  openSansSemiBold: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-SemiBold.ttf',
  openSansBold: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-Bold.ttf',
  openSansItalic: 'https://github.com/googlefonts/opensans/raw/main/fonts/ttf/OpenSans-Italic.ttf'
};

async function loadFonts(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);

  try {
    const [oswBold, oswExBold, osReg, osSemiBold, osBold, osItalic] =
      await Promise.all([
        fetchFontBytes(FONT_URLS.oswaldBold),
        fetchFontBytes(FONT_URLS.oswaldExtraBold),
        fetchFontBytes(FONT_URLS.openSansRegular),
        fetchFontBytes(FONT_URLS.openSansSemiBold),
        fetchFontBytes(FONT_URLS.openSansBold),
        fetchFontBytes(FONT_URLS.openSansItalic)
      ]);

    return {
      heading: await pdfDoc.embedFont(oswExBold, { subset: true }),
      headingSm: await pdfDoc.embedFont(oswBold, { subset: true }),
      body: await pdfDoc.embedFont(osReg, { subset: true }),
      bodySemiBold: await pdfDoc.embedFont(osSemiBold, { subset: true }),
      bodyBold: await pdfDoc.embedFont(osBold, { subset: true }),
      bodyItalic: await pdfDoc.embedFont(osItalic, { subset: true }),
      isCustom: true
    };
  } catch (err) {
    console.warn('Custom font load failed, using standard fonts:', err.message);
    return {
      heading: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      headingSm: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      body: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bodySemiBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      bodyBold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      bodyItalic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
      isCustom: false
    };
  }
}

// ================================================================
// MAIN HANDLER
// ================================================================

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
      personalityColor = '#C9A227',
      bestMatchName = '',
      bestMatchReason = '',
      percentages = [],
      quizDate = '',
      format = 'pdf'
    } = body || {};

    const pdfDoc = await PDFDocument.create();
    const W = 595.28;
    const H = 841.89;

    const fonts = await loadFonts(pdfDoc);

    // Brand palette
    const midnight = rgb(0.051, 0.051, 0.051);
    const cardDark = rgb(0.11, 0.11, 0.13);
    const cardMid = rgb(0.14, 0.14, 0.16);
    const gold = rgb(0.788, 0.635, 0.153);
    const goldLight = rgb(0.878, 0.745, 0.302);
    const goldDim = rgb(0.55, 0.45, 0.15);
    const successGreen = rgb(0.173, 0.373, 0.180);
    const greenLight = rgb(0.22, 0.48, 0.23);
    const white = rgb(1, 1, 1);
    const offWhite = rgb(0.96, 0.96, 0.94);
    const softGray = rgb(0.65, 0.65, 0.62);
    const mutedGold = rgb(0.45, 0.38, 0.14);
    const accent = hexToRgb(personalityColor);
    const accentDim = lerpColor(accent, midnight, 0.6);

    const displayDate = quizDate || new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // ================================================================
    // PAGE 1 - COVER
    // ================================================================
    const p1 = pdfDoc.addPage([W, H]);

    drawGradientRect(p1, 0, 0, W, H, rgb(0.07, 0.07, 0.07), midnight, 30);
    drawGradientBar(p1, 0, H - 4, W, 4, gold, successGreen, 40);
    drawDecoCorner(p1, 35, H - 40, 30, goldDim);
    drawDecoCorner(p1, W - 35, 40, 30, goldDim, true);

    drawCentered(p1, 'MILLIONAIRE MIND', H - 75, W, {
      font: fonts.heading, size: 13, color: gold
    });
    drawCentered(p1, 'x  SUCCESS RESOURCES', H - 92, W, {
      font: fonts.body, size: 9, color: softGray
    });

    drawDivider(p1, W / 2 - 60, H - 108, 120, goldDim);

    drawCentered(p1, 'MONEY PERSONALITY', H - 160, W, {
      font: fonts.heading, size: 32, color: white
    });
    drawCentered(p1, 'ASSESSMENT REPORT', H - 195, W, {
      font: fonts.heading, size: 32, color: gold
    });

    if (userName) {
      drawCentered(p1, 'Prepared exclusively for', H - 238, W, {
        font: fonts.bodyItalic, size: 11, color: softGray
      });
      drawCentered(p1, userName, H - 262, W, {
        font: fonts.heading, size: 24, color: offWhite
      });
    }

    drawCentered(p1, displayDate, H - 290, W, {
      font: fonts.body, size: 10, color: softGray
    });

    // Character image
    try {
      const img = await embedImage(pdfDoc, characterImage);
      if (img) {
        const imgSize = 180;
        p1.drawImage(img, {
          x: (W - imgSize) / 2, y: H - 500,
          width: imgSize, height: imgSize
        });
      }
    } catch (err) {
      console.error('Character image failed:', err.message);
    }

    // Personality name badge
    const badgeW = 360;
    const badgeH = 52;
    const badgeX = (W - badgeW) / 2;
    const badgeY = H - 555;
    drawGradientBar(p1, badgeX, badgeY, badgeW, badgeH, accentDim, accent, 20);
    drawDivider(p1, badgeX, badgeY + badgeH - 1, badgeW, gold, 1);
    drawDivider(p1, badgeX, badgeY, badgeW, gold, 1);
    drawCentered(p1, personalityName.toUpperCase(), badgeY + 16, W, {
      font: fonts.heading, size: 22, color: white
    });

    // Description
    drawCenteredWrapped(p1, description, badgeY - 30, W, 440, {
      font: fonts.body, size: 11, color: offWhite, lineHeight: 17
    });

    // Footer
    drawDivider(p1, 40, 65, W - 80, goldDim, 0.5);
    drawCentered(p1, 'CONFIDENTIAL  |  PERSONAL ASSESSMENT', 45, W, {
      font: fonts.body, size: 8, color: softGray
    });

    // ================================================================
    // PAGE 2 - PERSONALITY MIX + BEST MATCH
    // ================================================================
    const p2 = pdfDoc.addPage([W, H]);
    drawGradientRect(p2, 0, 0, W, H, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientBar(p2, 0, H - 3, W, 3, gold, successGreen, 40);

    p2.drawText('02', { x: 40, y: H - 52, size: 38, font: fonts.heading, color: goldDim });
    p2.drawText('YOUR PERSONALITY BLUEPRINT', {
      x: 95, y: H - 42, size: 14, font: fonts.heading, color: gold
    });
    drawDivider(p2, 40, H - 62, W - 80, goldDim, 0.5);

    // Mix card
    const mixCardY = H - 380;
    const mixCardH = 290;
    drawCard(p2, 40, mixCardY, W - 80, mixCardH, cardDark, cardMid);

    p2.drawText(mixLabel.toUpperCase(), {
      x: 65, y: mixCardY + mixCardH - 35,
      size: 13, font: fonts.headingSm, color: gold
    });
    drawDivider(p2, 65, mixCardY + mixCardH - 48, 160, goldDim, 0.5);

    let barY = mixCardY + mixCardH - 82;
    const barMaxW = 260;
    const barH = 18;
    const maxVal = Math.max(...percentages.map(p => Number(p?.value || 0)), 1);

    percentages.forEach((item) => {
      const label = String(item?.label || '');
      const value = Number(item?.value || 0);
      const isTop = value >= maxVal;

      p2.drawText(label, {
        x: 65, y: barY + 3,
        size: 11, font: isTop ? fonts.bodyBold : fonts.body,
        color: isTop ? white : offWhite
      });

      p2.drawRectangle({
        x: 210, y: barY - 2, width: barMaxW, height: barH,
        color: rgb(0.18, 0.18, 0.20)
      });

      const fillW = Math.max(0, Math.min(barMaxW, barMaxW * (value / 100)));
      if (fillW > 2) {
        drawGradientBar(p2, 210, barY - 2, fillW, barH,
          isTop ? accent : goldDim,
          isTop ? gold : mutedGold,
          15
        );
      }

      p2.drawText(`${value}%`, {
        x: 485, y: barY + 3,
        size: 11, font: fonts.bodyBold, color: isTop ? gold : softGray
      });

      barY -= 44;
    });

    // Best match
    const matchCardY = mixCardY - 180;
    const matchCardH = 150;
    drawCard(p2, 40, matchCardY, W - 80, matchCardH, cardDark, successGreen, 1.5);
    p2.drawRectangle({
      x: 40, y: matchCardY, width: 4, height: matchCardH, color: successGreen
    });

    p2.drawText('BEST COMPATIBLE PERSONALITY', {
      x: 65, y: matchCardY + matchCardH - 30,
      size: 10, font: fonts.headingSm, color: greenLight
    });
    p2.drawText(bestMatchName || '-', {
      x: 65, y: matchCardY + matchCardH - 58,
      size: 20, font: fonts.heading, color: white
    });
    drawWrapped(p2, bestMatchReason || '', 65, matchCardY + matchCardH - 80, W - 140, {
      font: fonts.body, size: 10, color: offWhite, lineHeight: 15
    });

    // Harv Eker quote
    const quoteY = matchCardY - 80;
    drawCentered(p2, '"Your relationship with money is a mirror', quoteY, W, {
      font: fonts.bodyItalic, size: 12, color: softGray
    });
    drawCentered(p2, 'of your relationship with yourself."', quoteY - 18, W, {
      font: fonts.bodyItalic, size: 12, color: softGray
    });
    drawCentered(p2, '- T. Harv Eker', quoteY - 42, W, {
      font: fonts.bodyBold, size: 10, color: gold
    });

    // Footer
    drawDivider(p2, 40, 45, W - 80, goldDim, 0.5);
    p2.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fonts.body, color: softGray
    });
    if (userName) {
      const nameW = fonts.body.widthOfTextAtSize(userName, 8);
      p2.drawText(userName, {
        x: W - 40 - nameW, y: 28, size: 8, font: fonts.body, color: softGray
      });
    }

    // ================================================================
    // PAGE 3 - DEEP PERSONALITY INSIGHTS
    // ================================================================
    const p3 = pdfDoc.addPage([W, H]);
    drawGradientRect(p3, 0, 0, W, H, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientBar(p3, 0, H - 3, W, 3, gold, successGreen, 40);

    p3.drawText('03', { x: 40, y: H - 52, size: 38, font: fonts.heading, color: goldDim });
    p3.drawText('DEEP PERSONALITY INSIGHTS', {
      x: 95, y: H - 42, size: 14, font: fonts.heading, color: gold
    });
    drawDivider(p3, 40, H - 62, W - 80, goldDim, 0.5);

    const sections = [
      { label: strengthLabel, text: strengthText, accentColor: successGreen },
      { label: shadowLabel, text: shadowText, accentColor: rgb(0.75, 0.45, 0.12) },
      { label: stepLabel, text: stepText, accentColor: accent }
    ];

    let sectionY = H - 100;

    sections.forEach((section) => {
      const cardH = 195;
      const cy = sectionY - cardH;

      drawCard(p3, 40, cy, W - 80, cardH, cardDark, cardMid);
      p3.drawRectangle({
        x: 40, y: cy, width: 4, height: cardH, color: section.accentColor
      });

      p3.drawText(section.label.toUpperCase(), {
        x: 65, y: cy + cardH - 32,
        size: 14, font: fonts.heading, color: gold
      });

      drawDivider(p3, 65, cy + cardH - 46, 200, goldDim, 0.5);

      drawWrapped(p3, section.text || '', 65, cy + cardH - 68, W - 140, {
        font: fonts.body, size: 11, color: offWhite, lineHeight: 16
      });

      sectionY = cy - 22;
    });

    drawDivider(p3, 40, 45, W - 80, goldDim, 0.5);
    p3.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fonts.body, color: softGray
    });

    // ================================================================
    // PAGE 4 - CTA: JOIN MILLIONAIRE MIND HYBRID
    // ================================================================
    const p4 = pdfDoc.addPage([W, H]);

    drawGradientRect(p4, 0, 0, W, H, rgb(0.06, 0.12, 0.07), midnight, 40);
    drawGradientBar(p4, 0, H - 4, W, 4, gold, successGreen, 40);
    drawDecoCorner(p4, 35, H - 40, 30, gold);
    drawDecoCorner(p4, W - 35, 40, 30, gold, true);

    drawCentered(p4, 'NOW YOU KNOW YOUR', H - 120, W, {
      font: fonts.headingSm, size: 15, color: softGray
    });
    drawCentered(p4, 'MONEY PERSONALITY.', H - 142, W, {
      font: fonts.headingSm, size: 15, color: softGray
    });

    drawCentered(p4, "IT'S TIME TO", H - 195, W, {
      font: fonts.heading, size: 34, color: white
    });
    drawCentered(p4, 'REWRITE YOUR', H - 235, W, {
      font: fonts.heading, size: 34, color: gold
    });
    drawCentered(p4, 'MONEY BLUEPRINT.', H - 275, W, {
      font: fonts.heading, size: 34, color: gold
    });

    drawDivider(p4, W / 2 - 80, H - 300, 160, gold, 1.5);

    // Event card
    const evtCardW = 430;
    const evtCardH = 195;
    const evtCardX = (W - evtCardW) / 2;
    const evtCardY = H - 520;

    drawCard(p4, evtCardX, evtCardY, evtCardW, evtCardH, cardDark, gold, 1.5);

    drawCentered(p4, 'MILLIONAIRE MIND HYBRID', evtCardY + evtCardH - 35, W, {
      font: fonts.heading, size: 20, color: gold
    });
    drawCentered(p4, 'LIVE EVENT  |  1-3 MAY 2026', evtCardY + evtCardH - 60, W, {
      font: fonts.bodyBold, size: 12, color: white
    });

    drawDivider(p4, evtCardX + 40, evtCardY + evtCardH - 75, evtCardW - 80, goldDim, 0.5);

    const bullets = [
      'Discover the 17 wealth principles of millionaires',
      'Reset your financial thermostat in 3 days',
      'Join thousands transforming their money blueprint',
      "Learn directly from T. Harv Eker's proven system"
    ];

    let bulletY = evtCardY + evtCardH - 100;
    bullets.forEach((b) => {
      const textStr = '    ' + b;
      const tw = fonts.body.widthOfTextAtSize(textStr, 10);
      const textX = (W - tw) / 2;
      drawDiamond(p4, textX + 4, bulletY + 3, 5, gold);
      drawCentered(p4, textStr, bulletY, W, {
        font: fonts.body, size: 10, color: offWhite
      });
      bulletY -= 22;
    });

    // CTA button
    const ctaW = 340;
    const ctaH = 56;
    const ctaX = (W - ctaW) / 2;
    const ctaY = evtCardY - 80;

    drawGradientBar(p4, ctaX, ctaY, ctaW, ctaH, gold, goldLight, 20);
    drawDivider(p4, ctaX, ctaY + ctaH - 1, ctaW, rgb(1, 0.9, 0.5), 1);
    drawDivider(p4, ctaX, ctaY, ctaW, mutedGold, 1);

    drawCentered(p4, 'CLAIM YOUR SEAT NOW', ctaY + 19, W, {
      font: fonts.heading, size: 18, color: midnight
    });

    // Make CTA button clickable
    addLinkAnnotation(pdfDoc, p4, ctaX, ctaY, ctaW, ctaH, 'http://www.millionairemind.online');

    // URL text below button (also clickable)
    const urlStr = 'www.millionairemind.online';
    drawCentered(p4, urlStr, ctaY - 28, W, {
      font: fonts.bodyBold, size: 12, color: gold
    });
    const urlTextW = fonts.bodyBold.widthOfTextAtSize(urlStr, 12);
    const urlTextX = (W - urlTextW) / 2;
    addLinkAnnotation(pdfDoc, p4, urlTextX - 5, ctaY - 34, urlTextW + 10, 18, 'http://www.millionairemind.online');

    // Personalized closing
    if (userName) {
      drawCentered(p4, `${userName}, your blueprint is waiting to be rewritten.`, ctaY - 80, W, {
        font: fonts.bodyItalic, size: 12, color: offWhite
      });
    }

    drawCentered(p4, 'The knowledge you need. The transformation you deserve.', ctaY - 108, W, {
      font: fonts.bodyItalic, size: 11, color: softGray
    });

    // Footer
    drawDivider(p4, 40, 65, W - 80, goldDim, 0.5);
    drawCentered(p4, 'MILLIONAIRE MIND  x  SUCCESS RESOURCES', 45, W, {
      font: fonts.headingSm, size: 9, color: gold
    });
    drawCentered(p4, '(c) 2026 Success Resources. All rights reserved.', 28, W, {
      font: fonts.body, size: 7, color: softGray
    });

    // ================================================================
    // GENERATE OUTPUT
    // ================================================================
    const pdfBytes = await pdfDoc.save();

    // Thumbnail mode: render page 1 as PNG
    if (format === 'thumbnail') {
      try {
        const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = getDocument({ data: pdfBytes });
        const pdfJsDoc = await loadingTask.promise;
        const pg = await pdfJsDoc.getPage(1);

        const scale = 1.5;
        const viewport = pg.getViewport({ scale });

        const { createCanvas } = await import('canvas');
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        await pg.render({ canvasContext: context, viewport }).promise;

        const pngBuffer = canvas.toBuffer('image/png');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(200).send(pngBuffer);
      } catch (thumbErr) {
        console.warn('Thumbnail generation failed, returning PDF:', thumbErr.message);
        // Fall through to PDF
      }
    }

    const fileName = safeFilename(`${userName ? userName + '_' : ''}${personalityName}_Report`);

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
