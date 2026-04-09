import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

// ── Color Helpers ──────────────────────────────────────────────

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

// ── Text Helpers ───────────────────────────────────────────────

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

// ── Drawing Helpers ────────────────────────────────────────────

function drawGradientRect(page, x, y, w, h, colorTop, colorBottom, steps = 20) {
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = lerpColor(colorTop, colorBottom, t);
    page.drawRectangle({
      x,
      y: y + h - (i + 1) * stepH,
      width: w,
      height: stepH + 0.5,
      color: c
    });
  }
}

function drawGradientBar(page, x, y, w, h, colorLeft, colorRight, steps = 30) {
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = lerpColor(colorLeft, colorRight, t);
    page.drawRectangle({
      x: x + i * stepW,
      y,
      width: stepW + 0.5,
      height: h,
      color: c
    });
  }
}

function drawDivider(page, x, y, w, color, thickness = 1) {
  page.drawRectangle({ x, y, width: w, height: thickness, color });
}

function drawRoundedCard(page, x, y, w, h, fillColor, borderColor = null, borderWidth = 1) {
  // pdf-lib doesn't support rounded corners natively, so we draw a clean rect with subtle border
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

async function embedImage(pdfDoc, url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('png')) return pdfDoc.embedPng(bytes);
  return pdfDoc.embedJpg(bytes);
}

function safeFilename(name) {
  return String(name || 'Money_Personality_Report')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ── Main Handler ───────────────────────────────────────────────

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
      quizDate = ''
    } = body || {};

    const pdfDoc = await PDFDocument.create();
    const W = 595.28;
    const H = 841.89;

    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // ── Brand Palette ──
    const midnight = rgb(0.051, 0.051, 0.051);       // #0D0D0D
    const deepCharcoal = rgb(0.09, 0.09, 0.09);
    const cardDark = rgb(0.11, 0.11, 0.13);
    const cardMid = rgb(0.14, 0.14, 0.16);
    const gold = rgb(0.788, 0.635, 0.153);            // #C9A227
    const goldLight = rgb(0.878, 0.745, 0.302);
    const goldDim = rgb(0.55, 0.45, 0.15);
    const successGreen = rgb(0.173, 0.373, 0.180);    // #2C5F2E
    const greenLight = rgb(0.22, 0.48, 0.23);
    const white = rgb(1, 1, 1);
    const offWhite = rgb(0.96, 0.96, 0.94);           // #F5F5F0
    const softGray = rgb(0.65, 0.65, 0.62);
    const mutedGold = rgb(0.45, 0.38, 0.14);
    const accent = hexToRgb(personalityColor);
    const accentDim = lerpColor(accent, midnight, 0.6);

    const displayDate = quizDate || new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // ═══════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ═══════════════════════════════════════════════════════════
    const p1 = pdfDoc.addPage([W, H]);

    // Full-page gradient background
    drawGradientRect(p1, 0, 0, W, H, rgb(0.07, 0.07, 0.07), midnight, 30);

    // Top accent stripe
    drawGradientBar(p1, 0, H - 4, W, 4, gold, successGreen, 40);

    // Decorative corner accents
    drawDecoCorner(p1, 35, H - 40, 30, goldDim);
    drawDecoCorner(p1, W - 35, 40, 30, goldDim, true);

    // Brand header
    drawCentered(p1, 'MILLIONAIRE MIND', H - 75, W, {
      font: fontBold, size: 11, color: gold
    });
    drawCentered(p1, 'x  SUCCESS RESOURCES', H - 92, W, {
      font: fontReg, size: 9, color: softGray
    });

    // Thin gold divider
    drawDivider(p1, W / 2 - 60, H - 108, 120, goldDim);

    // Report title
    drawCentered(p1, 'MONEY PERSONALITY', H - 155, W, {
      font: fontBold, size: 28, color: white
    });
    drawCentered(p1, 'ASSESSMENT REPORT', H - 185, W, {
      font: fontBold, size: 28, color: gold
    });

    // Personalized greeting
    if (userName) {
      drawCentered(p1, `Prepared exclusively for`, H - 228, W, {
        font: fontOblique, size: 11, color: softGray
      });
      drawCentered(p1, userName, H - 252, W, {
        font: fontBold, size: 22, color: offWhite
      });
    }

    drawCentered(p1, displayDate, H - 280, W, {
      font: fontReg, size: 10, color: softGray
    });

    // Character image (centered, larger)
    try {
      const img = await embedImage(pdfDoc, characterImage);
      if (img) {
        const imgSize = 180;
        p1.drawImage(img, {
          x: (W - imgSize) / 2,
          y: H - 490,
          width: imgSize,
          height: imgSize
        });
      }
    } catch (err) {
      console.error('Character image failed:', err);
    }

    // Personality name badge
    const badgeW = 340;
    const badgeH = 50;
    const badgeX = (W - badgeW) / 2;
    const badgeY = H - 540;
    drawGradientBar(p1, badgeX, badgeY, badgeW, badgeH, accentDim, accent, 20);
    drawCentered(p1, personalityName.toUpperCase(), badgeY + 16, W, {
      font: fontBold, size: 20, color: white
    });

    // Description block
    drawCenteredWrapped(p1, description, badgeY - 30, W, 440, {
      font: fontReg, size: 11, color: offWhite, lineHeight: 17
    });

    // Bottom stamp
    drawDivider(p1, 40, 65, W - 80, goldDim, 0.5);
    drawCentered(p1, 'CONFIDENTIAL  ·  PERSONAL ASSESSMENT', 45, W, {
      font: fontReg, size: 8, color: softGray
    });

    // ═══════════════════════════════════════════════════════════
    // PAGE 2 — PERSONALITY MIX + BEST MATCH
    // ═══════════════════════════════════════════════════════════
    const p2 = pdfDoc.addPage([W, H]);
    drawGradientRect(p2, 0, 0, W, H, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientBar(p2, 0, H - 3, W, 3, gold, successGreen, 40);

    // Page header
    p2.drawText('02', { x: 40, y: H - 50, size: 36, font: fontBold, color: goldDim });
    p2.drawText('YOUR PERSONALITY BLUEPRINT', {
      x: 90, y: H - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(p2, 40, H - 62, W - 80, goldDim, 0.5);

    // Personality Mix card
    const mixCardY = H - 370;
    const mixCardH = 280;
    drawRoundedCard(p2, 40, mixCardY, W - 80, mixCardH, cardDark, cardMid);

    p2.drawText(mixLabel.toUpperCase(), {
      x: 65, y: mixCardY + mixCardH - 35, size: 12, font: fontBold, color: gold
    });
    drawDivider(p2, 65, mixCardY + mixCardH - 48, 150, goldDim, 0.5);

    let barY = mixCardY + mixCardH - 80;
    const barMaxW = 260;
    const barH = 16;

    percentages.forEach((item) => {
      const label = String(item?.label || '');
      const value = Number(item?.value || 0);
      const isTop = value >= Math.max(...percentages.map(p => Number(p?.value || 0)));

      // Label
      p2.drawText(label, {
        x: 65, y: barY + 2, size: 11, font: isTop ? fontBold : fontReg, color: isTop ? white : offWhite
      });

      // Bar background
      p2.drawRectangle({
        x: 210, y: barY - 2, width: barMaxW, height: barH, color: rgb(0.18, 0.18, 0.20)
      });

      // Bar fill with gradient
      const fillW = Math.max(0, Math.min(barMaxW, barMaxW * (value / 100)));
      if (fillW > 2) {
        drawGradientBar(p2, 210, barY - 2, fillW, barH,
          isTop ? accent : goldDim,
          isTop ? gold : mutedGold,
          15
        );
      }

      // Percentage
      p2.drawText(`${value}%`, {
        x: 485, y: barY + 2, size: 11, font: fontBold, color: isTop ? gold : softGray
      });

      barY -= 42;
    });

    // Best Match card
    const matchCardY = mixCardY - 175;
    const matchCardH = 145;
    drawRoundedCard(p2, 40, matchCardY, W - 80, matchCardH, cardDark, successGreen, 1.5);

    // Green accent bar on left
    p2.drawRectangle({
      x: 40, y: matchCardY, width: 4, height: matchCardH, color: successGreen
    });

    p2.drawText('BEST COMPATIBLE PERSONALITY', {
      x: 65, y: matchCardY + matchCardH - 30, size: 10, font: fontBold, color: greenLight
    });

    p2.drawText(bestMatchName || '-', {
      x: 65, y: matchCardY + matchCardH - 58, size: 20, font: fontBold, color: white
    });

    drawWrapped(p2, bestMatchReason || '', 65, matchCardY + matchCardH - 80, W - 140, {
      font: fontReg, size: 10, color: offWhite, lineHeight: 15
    });

    // Insight quote
    const quoteY = matchCardY - 80;
    drawCentered(p2, '"Your relationship with money is a mirror', quoteY, W, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(p2, 'of your relationship with yourself."', quoteY - 18, W, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(p2, '— T. Harv Eker', quoteY - 42, W, {
      font: fontBold, size: 10, color: gold
    });

    // Footer
    drawDivider(p2, 40, 45, W - 80, goldDim, 0.5);
    p2.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fontReg, color: softGray
    });
    if (userName) {
      const nameW = fontReg.widthOfTextAtSize(userName, 8);
      p2.drawText(userName, {
        x: W - 40 - nameW, y: 28, size: 8, font: fontReg, color: softGray
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PAGE 3 — DEEP INSIGHTS
    // ═══════════════════════════════════════════════════════════
    const p3 = pdfDoc.addPage([W, H]);
    drawGradientRect(p3, 0, 0, W, H, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientBar(p3, 0, H - 3, W, 3, gold, successGreen, 40);

    p3.drawText('03', { x: 40, y: H - 50, size: 36, font: fontBold, color: goldDim });
    p3.drawText('DEEP PERSONALITY INSIGHTS', {
      x: 90, y: H - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(p3, 40, H - 62, W - 80, goldDim, 0.5);

    const sections = [
      { icon: '✦', label: strengthLabel, text: strengthText, accentColor: successGreen },
      { icon: '⚠', label: shadowLabel, text: shadowText, accentColor: rgb(0.75, 0.45, 0.12) },
      { icon: '→', label: stepLabel, text: stepText, accentColor: accent }
    ];

    let sectionY = H - 100;

    sections.forEach((section) => {
      const cardH = 190;
      const cy = sectionY - cardH;

      drawRoundedCard(p3, 40, cy, W - 80, cardH, cardDark, cardMid);

      // Left accent bar
      p3.drawRectangle({
        x: 40, y: cy, width: 4, height: cardH, color: section.accentColor
      });

      // Section label
      p3.drawText(section.label.toUpperCase(), {
        x: 65, y: cy + cardH - 32, size: 13, font: fontBold, color: gold
      });

      drawDivider(p3, 65, cy + cardH - 44, 180, goldDim, 0.5);

      // Section body text
      drawWrapped(p3, section.text || '', 65, cy + cardH - 65, W - 140, {
        font: fontReg, size: 11, color: offWhite, lineHeight: 16
      });

      sectionY = cy - 22;
    });

    // Footer
    drawDivider(p3, 40, 45, W - 80, goldDim, 0.5);
    p3.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fontReg, color: softGray
    });

    // ═══════════════════════════════════════════════════════════
    // PAGE 4 — CTA: JOIN MILLIONAIRE MIND HYBRID
    // ═══════════════════════════════════════════════════════════
    const p4 = pdfDoc.addPage([W, H]);

    // Dramatic gradient: dark green to black
    drawGradientRect(p4, 0, 0, W, H, rgb(0.06, 0.12, 0.07), midnight, 40);
    drawGradientBar(p4, 0, H - 4, W, 4, gold, successGreen, 40);

    // Decorative corners
    drawDecoCorner(p4, 35, H - 40, 30, gold);
    drawDecoCorner(p4, W - 35, 40, 30, gold, true);

    // Headline
    drawCentered(p4, 'NOW YOU KNOW YOUR', H - 120, W, {
      font: fontBold, size: 14, color: softGray
    });
    drawCentered(p4, 'MONEY PERSONALITY.', H - 145, W, {
      font: fontBold, size: 14, color: softGray
    });

    drawCentered(p4, "IT'S TIME TO", H - 195, W, {
      font: fontBold, size: 30, color: white
    });
    drawCentered(p4, 'REWRITE YOUR', H - 230, W, {
      font: fontBold, size: 30, color: gold
    });
    drawCentered(p4, 'MONEY BLUEPRINT.', H - 265, W, {
      font: fontBold, size: 30, color: gold
    });

    // Divider
    drawDivider(p4, W / 2 - 80, H - 290, 160, gold, 1.5);

    // Event details card
    const evtCardW = 420;
    const evtCardH = 180;
    const evtCardX = (W - evtCardW) / 2;
    const evtCardY = H - 500;

    drawRoundedCard(p4, evtCardX, evtCardY, evtCardW, evtCardH, cardDark, gold, 1.5);

    drawCentered(p4, 'MILLIONAIRE MIND HYBRID', evtCardY + evtCardH - 35, W, {
      font: fontBold, size: 18, color: gold
    });

    drawCentered(p4, 'LIVE EVENT  ·  1 – 3 MAY 2026', evtCardY + evtCardH - 60, W, {
      font: fontBold, size: 12, color: white
    });

    drawDivider(p4, evtCardX + 40, evtCardY + evtCardH - 72, evtCardW - 80, goldDim, 0.5);

    const bullets = [
      'Discover the 17 wealth principles of millionaires',
      'Reset your financial thermostat in 3 days',
      'Join thousands transforming their money blueprint',
      'Learn directly from T. Harv Eker's proven system'
    ];

    let bulletY = evtCardY + evtCardH - 95;
    bullets.forEach((b) => {
      drawCentered(p4, `✦  ${b}`, bulletY, W, {
        font: fontReg, size: 10, color: offWhite
      });
      bulletY -= 20;
    });

    // CTA box
    const ctaW = 320;
    const ctaH = 52;
    const ctaX = (W - ctaW) / 2;
    const ctaY = evtCardY - 70;

    drawGradientBar(p4, ctaX, ctaY, ctaW, ctaH, gold, goldLight, 20);

    drawCentered(p4, 'CLAIM YOUR SEAT NOW', ctaY + 18, W, {
      font: fontBold, size: 16, color: midnight
    });

    // URL
    drawCentered(p4, 'www.millionairemind.online', ctaY - 25, W, {
      font: fontBold, size: 12, color: gold
    });

    // Add clickable link annotation
    const urlText = 'www.millionairemind.online';
    const urlW = fontBold.widthOfTextAtSize(urlText, 12);
    const urlX = (W - urlW) / 2;
    p4.node.set(
      pdfDoc.context.obj({}), // placeholder — annotation added below
    );

    // Personalized closing
    if (userName) {
      drawCentered(p4, `${userName}, your blueprint is waiting to be rewritten.`, ctaY - 75, W, {
        font: fontOblique, size: 12, color: offWhite
      });
    }

    drawCentered(p4, 'The knowledge you need. The transformation you deserve.', ctaY - 100, W, {
      font: fontOblique, size: 11, color: softGray
    });

    // Footer
    drawDivider(p4, 40, 65, W - 80, goldDim, 0.5);
    drawCentered(p4, 'MILLIONAIRE MIND  x  SUCCESS RESOURCES', 45, W, {
      font: fontBold, size: 9, color: gold
    });
    drawCentered(p4, '© 2026 Success Resources. All rights reserved.', 28, W, {
      font: fontReg, size: 7, color: softGray
    });

    // ── Add clickable URL annotation to page 4 ──
    try {
      const linkAnnotation = pdfDoc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [urlX - 5, ctaY - 30, urlX + urlW + 5, ctaY - 14],
        Border: [0, 0, 0],
        A: {
          Type: 'Action',
          S: 'URI',
          URI: pdfDoc.context.flateStream
            ? 'http://www.millionairemind.online'
            : pdfDoc.context.obj('http://www.millionairemind.online')
        }
      });

      const annots = p4.node.get(pdfDoc.context.obj('Annots'));
      if (!p4.node.get(pdfDoc.context.obj('Annots'))) {
        p4.node.set(
          pdfDoc.context.obj('Annots'),
          pdfDoc.context.obj([pdfDoc.context.register(linkAnnotation)])
        );
      }
    } catch (err) {
      // Link annotation is a nice-to-have; PDF works without it
      console.warn('Link annotation skipped:', err.message);
    }

    // ── Generate ──
    const pdfBytes = await pdfDoc.save();
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
