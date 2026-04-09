import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import https from 'https';
import http from 'http';

// ================================================================
// LANGUAGE / FONT HELPERS
// ================================================================

function containsCJK(text = '') {
  return /[\u3400-\u9FFF\uF900-\uFAFF\u4E00-\u9FFF]/.test(String(text));
}

function containsNonLatin(text = '') {
  return /[^\u0000-\u00FF]/.test(String(text));
}

function sanitizeText(text = '') {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getBaseUrl(req) {
  const proto =
    req.headers['x-forwarded-proto'] ||
    req.headers['X-Forwarded-Proto'] ||
    'https';
  const host =
    req.headers['x-forwarded-host'] ||
    req.headers['host'];

  return `${proto}://${host}`;
}

/**
 * Fetch with better error handling and logging
 */
async function fetchArrayBuffer(url) {
  console.log(`[Font] Fetching font from: ${url}`);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, { timeout: 30000 }, (response) => {
      console.log(`[Font] Response status: ${response.statusCode}`);
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }

      const chunks = [];
      let totalSize = 0;

      response.on('data', (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
        console.log(`[Font] Downloaded: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      });

      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[Font] Total size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
        resolve(buffer.buffer);
      });

      response.on('error', (err) => {
        console.error(`[Font] Stream error:`, err.message);
        reject(err);
      });
    }).on('error', (err) => {
      console.error(`[Font] Request error:`, err.message);
      reject(err);
    });
  });
}

/**
 * Load Unicode font with multiple fallback sources
 */
async function loadUnicodeFontBytes(req) {
  const baseUrl = getBaseUrl(req);

  // Priority: Local > Self-hosted > CDN
  const candidates = [
    {
      url: `${baseUrl}/fonts/NotoSansCJK-Regular.ttf`,
      name: 'Local TTF'
    },
    {
      url: `${baseUrl}/fonts/NotoSansCJK-Regular.otf`,
      name: 'Local OTF'
    },
    {
      url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
      name: 'GitHub OTF'
    },
    {
      url: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
      name: 'jsDelivr CDN'
    },
    {
      url: 'https://unpkg.com/@notofonts/noto-cjk@latest/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',
      name: 'unpkg CDN'
    }
  ];

  let lastError = null;

  for (const candidate of candidates) {
    try {
      console.log(`[Font] Trying ${candidate.name}: ${candidate.url}`);
      const bytes = await fetchArrayBuffer(candidate.url);
      console.log(`[Font] ✅ SUCCESS: ${candidate.name}`);
      return bytes;
    } catch (err) {
      console.warn(`[Font] ❌ FAILED ${candidate.name}: ${err.message}`);
      lastError = err;
      // Continue to next candidate
    }
  }

  console.error(`[Font] All font sources failed. Last error: ${lastError?.message}`);
  throw new Error(
    `Could not load CJK font from any source. Options:\n` +
    `1. Add local font: public/fonts/NotoSansCJK-Regular.otf\n` +
    `2. Check internet connection (CDN access)\n` +
    `Last error: ${lastError?.message}`
  );
}

/**
 * Get appropriate fonts with intelligent fallback
 */
async function getFonts(pdfDoc, req, allText) {
  console.log('[Font] Initializing fonts...');
  
  const regularLatin = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldLatin = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const obliqueLatin = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const hasNonLatin = containsNonLatin(allText);
  const hasCJK = containsCJK(allText);

  console.log(`[Font] Text analysis: hasNonLatin=${hasNonLatin}, hasCJK=${hasCJK}`);

  if (!hasNonLatin) {
    console.log('[Font] Using Latin-only fonts (Helvetica)');
    return {
      regular: regularLatin,
      bold: boldLatin,
      oblique: obliqueLatin,
      unicode: false,
      cjk: false
    };
  }

  // Load Unicode font
  console.log('[Font] Loading Unicode font (NotoSansCJK)...');
  try {
    pdfDoc.registerFontkit(fontkit);
    const unicodeBytes = await loadUnicodeFontBytes(req);
    
    console.log('[Font] Embedding font (WITHOUT subsetting)...');
    // TRY WITHOUT SUBSET FIRST - this is more reliable for CJK
    const unicodeFont = await pdfDoc.embedFont(unicodeBytes, { subset: false });
    
    console.log('[Font] ✅ Unicode font loaded successfully');
    return {
      regular: unicodeFont,
      bold: unicodeFont,
      oblique: unicodeFont,
      unicode: true,
      cjk: hasCJK
    };
  } catch (err) {
    console.error('[Font] ❌ Unicode font loading failed:', err.message);
    console.warn('[Font] Falling back to Latin fonts (Chinese will not render)');
    
    // Fallback: return Latin fonts anyway
    return {
      regular: regularLatin,
      bold: boldLatin,
      oblique: obliqueLatin,
      unicode: false,
      cjk: false,
      error: err.message
    };
  }
}

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

function wrapTextByWidth(text, font, fontSize, maxWidth) {
  const safeText = sanitizeText(text);
  if (!safeText) return [''];

  const paragraphs = safeText.split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }

    // For CJK text: wrap character-by-character
    if (containsCJK(paragraph)) {
      let current = '';
      for (const char of paragraph) {
        const test = current + char;
        try {
          const width = font.widthOfTextAtSize(test, fontSize);
          if (width <= maxWidth) {
            current = test;
          } else {
            if (current) lines.push(current);
            current = char;
          }
        } catch (err) {
          console.warn(`[Text] Width calculation failed for char: ${char}`, err.message);
          // If width calculation fails, just add char anyway
          if (current.length > 50) {
            // Arbitrary limit to prevent infinite lines
            lines.push(current);
            current = char;
          } else {
            current += char;
          }
        }
      }
      if (current) lines.push(current);
      continue;
    }

    // For Latin text: wrap by word
    const words = paragraph.split(/\s+/);
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
  }

  return lines.length ? lines : [''];
}

function drawWrappedText(page, text, x, y, width, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, width);
  let currentY = y;

  for (const line of lines) {
    if (line) {
      try {
        page.drawText(line, { x, y: currentY, size, font, color });
      } catch (err) {
        console.warn(`[Draw] Failed to draw text: ${line}`, err.message);
      }
    }
    currentY -= lineHeight;
  }

  return currentY;
}

function drawCentered(page, text, y, pageWidth, options = {}) {
  const safeText = sanitizeText(text);
  const { font, size = 12, color = rgb(1, 1, 1) } = options;
  
  try {
    const tw = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, { x: (pageWidth - tw) / 2, y, size, font, color });
  } catch (err) {
    console.warn(`[Draw] Failed to draw centered text: ${safeText}`, err.message);
  }
}

function drawCenteredWrapped(page, text, y, pageWidth, maxWidth, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, maxWidth);
  let cy = y;

  for (const line of lines) {
    if (line) {
      try {
        const tw = font.widthOfTextAtSize(line, size);
        page.drawText(line, { x: (pageWidth - tw) / 2, y: cy, size, font, color });
      } catch (err) {
        console.warn(`[Draw] Failed to draw centered wrapped text: ${line}`, err.message);
      }
    }
    cy -= lineHeight;
  }

  return cy;
}

// ================================================================
// DRAWING HELPERS
// ================================================================

function drawGradientV(page, x, y, w, h, colorTop, colorBottom, steps = 24) {
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    page.drawRectangle({
      x,
      y: y + h - (i + 1) * stepH,
      width: w,
      height: stepH + 0.5,
      color: lerpColor(colorTop, colorBottom, t)
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
      color: lerpColor(colorLeft, colorRight, t)
    });
  }
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
    borderWidth: borderColor ? borderWidth : 0
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
    const hw = s - Math.abs(i);
    if (hw > 0) {
      page.drawRectangle({ x: cx - hw, y: cy + i, width: hw * 2, height: 0.6, color });
    }
  }
}

/**
 * Sanitize filename for safe filesystem and HTTP header use
 */
function safeFilename(name) {
  return String(name || 'Money_Personality_Report')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

/**
 * Encode filename for RFC 5987 Content-Disposition header
 */
function encodeRFC5987Filename(filename) {
  const ascii = /^[\x20-\x7E]*$/.test(filename);
  
  if (ascii) {
    return `"${filename}"`;
  }

  const encoded = Buffer.from(filename, 'utf8')
    .toString('binary')
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      return code < 128 && /^[\w\-.]$/.test(char) ? char : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');

  return {
    simple: safeFilename(filename),
    extended: encoded
  };
}

async function embedImageFromUrl(pdfDoc, url) {
  if (!url) return null;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('png')) return await pdfDoc.embedPng(bytes);
    return await pdfDoc.embedJpg(bytes);
  } catch (err) {
    console.error('Image embed failed:', err.message);
    return null;
  }
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

  const existing = page.node.get(PDFName.of('Annots'));
  if (existing instanceof PDFArray) {
    existing.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([annotRef]));
  }
}

// ================================================================
// MAIN HANDLER
// ================================================================

export default async function handler(req, res) {
  try {
    console.log('[API] Request received:', {
      method: req.method,
      path: req.url
    });

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

    console.log('[API] Input data:', {
      userName,
      personalityName,
      hasDescription: !!description,
      format
    });

    // Collect all text for language detection
    const allText = [
      userName,
      personalityName,
      description,
      strengthLabel,
      strengthText,
      shadowLabel,
      shadowText,
      stepLabel,
      stepText,
      mixLabel,
      bestMatchName,
      bestMatchReason,
      ...percentages.map(p => `${p?.label || ''} ${p?.value || ''}`)
    ].join(' ');

    console.log('[API] Creating PDF document...');
    const pdfDoc = await PDFDocument.create();
    const width = 595.28;
    const height = 841.89;

    // Smart font loading with debugging
    console.log('[API] Loading fonts...');
    const fonts = await getFonts(pdfDoc, req, allText);
    const fontRegular = fonts.regular;
    const fontBold = fonts.bold;
    const fontOblique = fonts.oblique;

    console.log('[API] Font loading result:', {
      unicode: fonts.unicode,
      cjk: fonts.cjk,
      error: fonts.error || 'none'
    });

    // Rest of the PDF generation code (pages 1-4) remains the same...
    // [PAGES IMPLEMENTATION FOLLOWS BELOW]

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
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // ================================================================
    // PAGE 1 - COVER
    // ================================================================
    console.log('[PDF] Creating page 1 (cover)...');
    const page1 = pdfDoc.addPage([width, height]);

    drawGradientV(page1, 0, 0, width, height, rgb(0.07, 0.07, 0.07), midnight, 30);
    drawGradientH(page1, 0, height - 4, width, 4, gold, successGreen, 40);
    drawDecoCorner(page1, 35, height - 40, 30, goldDim);
    drawDecoCorner(page1, width - 35, 40, 30, goldDim, true);

    try {
      const srLogo = await embedImageFromUrl(pdfDoc, 'https://sr-event.com/sr-logo');
      if (srLogo) {
        const logoH = 40;
        const logoW = logoH * (srLogo.width / srLogo.height);
        page1.drawImage(srLogo, {
          x: (width - logoW) / 2,
          y: height - 80,
          width: logoW,
          height: logoH
        });
      }
    } catch (err) {
      console.error('SR logo failed:', err.message);
    }

    drawCentered(page1, 'MILLIONAIRE MIND', height - 100, width, {
      font: fontBold, size: 12, color: gold
    });
    drawDivider(page1, width / 2 - 60, height - 116, 120, goldDim);

    drawCentered(page1, 'MONEY PERSONALITY', height - 158, width, {
      font: fontBold, size: 28, color: white
    });
    drawCentered(page1, 'ASSESSMENT REPORT', height - 190, width, {
      font: fontBold, size: 28, color: gold
    });

    if (userName) {
      drawCentered(page1, 'Prepared exclusively for', height - 232, width, {
        font: fontOblique, size: 11, color: softGray
      });
      drawCentered(page1, sanitizeText(userName), height - 256, width, {
        font: fontBold, size: 22, color: offWhite
      });
    }

    drawCentered(page1, displayDate, height - 284, width, {
      font: fontRegular, size: 10, color: softGray
    });

    try {
      const img = await embedImageFromUrl(pdfDoc, characterImage);
      if (img) {
        const imgSize = 180;
        page1.drawImage(img, {
          x: (width - imgSize) / 2,
          y: height - 495,
          width: imgSize,
          height: imgSize
        });
      }
    } catch (err) {
      console.error('Character image failed:', err);
    }

    const badgeW = 360;
    const badgeH = 48;
    const badgeX = (width - badgeW) / 2;
    const badgeY = height - 548;
    drawGradientH(page1, badgeX, badgeY, badgeW, badgeH, accentDim, accent, 20);
    drawDivider(page1, badgeX, badgeY + badgeH - 1, badgeW, gold, 1);
    drawDivider(page1, badgeX, badgeY, badgeW, gold, 1);
    drawCentered(page1, sanitizeText(personalityName).toUpperCase(), badgeY + 15, width, {
      font: fontBold, size: 20, color: white
    });

    drawCenteredWrapped(page1, sanitizeText(description), badgeY - 28, width, 440, {
      font: fontRegular, size: 11, color: offWhite, lineHeight: 17
    });

    drawDivider(page1, 40, 65, width - 80, goldDim, 0.5);
    drawCentered(page1, 'CONFIDENTIAL  |  PERSONAL ASSESSMENT', 45, width, {
      font: fontRegular, size: 8, color: softGray
    });

    // ================================================================
    // PAGE 2 - PERSONALITY MIX + BEST MATCH
    // ================================================================
    console.log('[PDF] Creating page 2 (personality blueprint)...');
    const page2 = pdfDoc.addPage([width, height]);

    drawGradientV(page2, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page2, 0, height - 3, width, 3, gold, successGreen, 40);

    page2.drawText('02', {
      x: 40, y: height - 52, size: 36, font: fontBold, color: goldDim
    });
    page2.drawText('YOUR PERSONALITY BLUEPRINT', {
      x: 92, y: height - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(page2, 40, height - 62, width - 80, goldDim, 0.5);

    const mixCardY = height - 380;
    const mixCardH = 290;
    drawCard(page2, 40, mixCardY, width - 80, mixCardH, cardDark, cardMid);

    page2.drawText(sanitizeText(mixLabel).toUpperCase(), {
      x: 65, y: mixCardY + mixCardH - 35, size: 12, font: fontBold, color: gold
    });
    drawDivider(page2, 65, mixCardY + mixCardH - 48, 160, goldDim, 0.5);

    let barY = mixCardY + mixCardH - 82;
    const barMaxW = 260;
    const barH = 18;
    const maxVal = Math.max(...percentages.map(p => Number(p?.value || 0)), 1);

    percentages.forEach((item) => {
      const label = sanitizeText(item?.label || '');
      const value = Number(item?.value || 0);
      const isTop = value >= maxVal;

      page2.drawText(label, {
        x: 65, y: barY + 3,
        size: 11, font: isTop ? fontBold : fontRegular,
        color: isTop ? white : offWhite
      });

      page2.drawRectangle({
        x: 210, y: barY - 2, width: barMaxW, height: barH,
        color: rgb(0.18, 0.18, 0.20)
      });

      const fillW = Math.max(0, Math.min(barMaxW, barMaxW * (value / 100)));
      if (fillW > 2) {
        drawGradientH(page2, 210, barY - 2, fillW, barH,
          isTop ? accent : goldDim,
          isTop ? gold : mutedGold,
          15
        );
      }

      page2.drawText(`${value}%`, {
        x: 485, y: barY + 3,
        size: 11, font: fontBold, color: isTop ? gold : softGray
      });

      barY -= 44;
    });

    const matchCardY = mixCardY - 180;
    const matchCardH = 150;
    drawCard(page2, 40, matchCardY, width - 80, matchCardH, cardDark, successGreen, 1.5);
    page2.drawRectangle({
      x: 40, y: matchCardY, width: 4, height: matchCardH, color: successGreen
    });

    page2.drawText('BEST COMPATIBLE PERSONALITY', {
      x: 65, y: matchCardY + matchCardH - 30,
      size: 10, font: fontBold, color: greenLight
    });
    page2.drawText(sanitizeText(bestMatchName || '-'), {
      x: 65, y: matchCardY + matchCardH - 58,
      size: 20, font: fontBold, color: white
    });
    drawWrappedText(page2, sanitizeText(bestMatchReason || ''), 65, matchCardY + matchCardH - 80, width - 140, {
      font: fontRegular, size: 10, color: offWhite, lineHeight: 15
    });

    const quoteY = matchCardY - 80;
    drawCentered(page2, '"Your relationship with money is a mirror', quoteY, width, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(page2, 'of your relationship with yourself."', quoteY - 18, width, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(page2, '- T. Harv Eker', quoteY - 42, width, {
      font: fontBold, size: 10, color: gold
    });

    drawDivider(page2, 40, 45, width - 80, goldDim, 0.5);
    page2.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fontRegular, color: softGray
    });
    if (userName) {
      const nameW = fontRegular.widthOfTextAtSize(sanitizeText(userName), 8);
      page2.drawText(sanitizeText(userName), {
        x: width - 40 - nameW, y: 28, size: 8, font: fontRegular, color: softGray
      });
    }

    // ================================================================
    // PAGE 3 - DEEP PERSONALITY INSIGHTS
    // ================================================================
    console.log('[PDF] Creating page 3 (insights)...');
    const page3 = pdfDoc.addPage([width, height]);

    drawGradientV(page3, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page3, 0, height - 3, width, 3, gold, successGreen, 40);

    page3.drawText('03', {
      x: 40, y: height - 52, size: 36, font: fontBold, color: goldDim
    });
    page3.drawText('DEEP PERSONALITY INSIGHTS', {
      x: 92, y: height - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(page3, 40, height - 62, width - 80, goldDim, 0.5);

    const sections = [
      { label: strengthLabel, text: strengthText, accentColor: successGreen },
      { label: shadowLabel, text: shadowText, accentColor: rgb(0.75, 0.45, 0.12) },
      { label: stepLabel, text: stepText, accentColor: accent }
    ];

    let sectionY = height - 100;

    sections.forEach((section) => {
      const cardH = 195;
      const cy = sectionY - cardH;

      drawCard(page3, 40, cy, width - 80, cardH, cardDark, cardMid);

      page3.drawRectangle({
        x: 40, y: cy, width: 4, height: cardH, color: section.accentColor
      });

      page3.drawText(sanitizeText(section.label).toUpperCase(), {
        x: 65, y: cy + cardH - 32,
        size: 14, font: fontBold, color: gold
      });

      drawDivider(page3, 65, cy + cardH - 46, 200, goldDim, 0.5);

      drawWrappedText(page3, sanitizeText(section.text || ''), 65, cy + cardH - 68, width - 140, {
        font: fontRegular, size: 11, color: offWhite, lineHeight: 16
      });

      sectionY = cy - 22;
    });

    drawDivider(page3, 40, 45, width - 80, goldDim, 0.5);
    page3.drawText('Money Personality Assessment Report', {
      x: 40, y: 28, size: 8, font: fontRegular, color: softGray
    });

    // ================================================================
    // PAGE 4 - CTA
    // ================================================================
    console.log('[PDF] Creating page 4 (CTA)...');
    const page4 = pdfDoc.addPage([width, height]);

    drawGradientV(page4, 0, 0, width, height, rgb(0.06, 0.12, 0.07), midnight, 40);
    drawGradientH(page4, 0, height - 4, width, 4, gold, successGreen, 40);
    drawDecoCorner(page4, 35, height - 40, 30, gold);
    drawDecoCorner(page4, width - 35, 40, 30, gold, true);

    drawCentered(page4, 'NOW YOU KNOW YOUR', height - 120, width, {
      font: fontBold, size: 15, color: softGray
    });
    drawCentered(page4, 'MONEY PERSONALITY.', height - 142, width, {
      font: fontBold, size: 15, color: softGray
    });

    drawCentered(page4, "IT'S TIME TO", height - 198, width, {
      font: fontBold, size: 32, color: white
    });
    drawCentered(page4, 'REWRITE YOUR', height - 236, width, {
      font: fontBold, size: 32, color: gold
    });
    drawCentered(page4, 'MONEY BLUEPRINT.', height - 274, width, {
      font: fontBold, size: 32, color: gold
    });

    drawDivider(page4, width / 2 - 80, height - 300, 160, gold, 1.5);

    const evtCardW = 430;
    const evtCardH = 195;
    const evtCardX = (width - evtCardW) / 2;
    const evtCardY = height - 520;

    drawCard(page4, evtCardX, evtCardY, evtCardW, evtCardH, cardDark, gold, 1.5);

    drawCentered(page4, 'MILLIONAIRE MIND HYBRID', evtCardY + evtCardH - 35, width, {
      font: fontBold, size: 19, color: gold
    });
    drawCentered(page4, 'LIVE ONLINE EVENT', evtCardY + evtCardH - 60, width, {
      font: fontBold, size: 12, color: white
    });

    drawDivider(page4, evtCardX + 40, evtCardY + evtCardH - 75, evtCardW - 80, goldDim, 0.5);

    const bullets = [
      'Discover the 17 wealth principles of millionaires',
      'Reset your financial thermostat in 3 days',
      'Join thousands transforming their money blueprint',
      "Learn directly from T. Harv Eker's proven system"
    ];

    let bulletY = evtCardY + evtCardH - 100;
    bullets.forEach((b) => {
      const textStr = '    ' + b;
      const tw = fontRegular.widthOfTextAtSize(textStr, 10);
      const textX = (width - tw) / 2;
      drawDiamond(page4, textX + 4, bulletY + 3, 5, gold);
      drawCentered(page4, textStr, bulletY, width, {
        font: fontRegular, size: 10, color: offWhite
      });
      bulletY -= 22;
    });

    const ctaW = 340;
    const ctaH = 54;
    const ctaX = (width - ctaW) / 2;
    const ctaY = evtCardY - 78;

    drawGradientH(page4, ctaX, ctaY, ctaW, ctaH, gold, goldLight, 20);
    drawDivider(page4, ctaX, ctaY + ctaH - 1, ctaW, rgb(1, 0.9, 0.5), 1);
    drawDivider(page4, ctaX, ctaY, ctaW, mutedGold, 1);

    drawCentered(page4, 'CLAIM YOUR SEAT NOW', ctaY + 18, width, {
      font: fontBold, size: 17, color: midnight
    });

    addLinkAnnotation(pdfDoc, page4, ctaX, ctaY, ctaW, ctaH,
      'http://www.millionairemind.online');

    const urlStr = 'www.millionairemind.online';
    drawCentered(page4, urlStr, ctaY - 28, width, {
      font: fontBold, size: 12, color: gold
    });

    const urlTextW = fontBold.widthOfTextAtSize(urlStr, 12);
    const urlTextX = (width - urlTextW) / 2;
    addLinkAnnotation(pdfDoc, page4, urlTextX - 5, ctaY - 34, urlTextW + 10, 18,
      'http://www.millionairemind.online');

    if (userName) {
      drawCentered(page4, `${sanitizeText(userName)}, your blueprint is waiting to be rewritten.`, ctaY - 78, width, {
        font: fontOblique, size: 12, color: offWhite
      });
    }
    drawCentered(page4, 'The knowledge you need. The transformation you deserve.', ctaY - 105, width, {
      font: fontOblique, size: 11, color: softGray
    });

    drawDivider(page4, 40, 65, width - 80, goldDim, 0.5);
    drawCentered(page4, 'MILLIONAIRE MIND  x  SUCCESS RESOURCES', 45, width, {
      font: fontBold, size: 9, color: gold
    });
    drawCentered(page4, '(c) 2026 Success Resources. All rights reserved.', 28, width, {
      font: fontRegular, size: 7, color: softGray
    });

    // ================================================================
    // GENERATE OUTPUT
    // ================================================================
    console.log('[PDF] Saving PDF...');
    const pdfBytes = await pdfDoc.save();

    const baseFilename = `${userName ? sanitizeText(userName) + '_' : ''}${sanitizeText(personalityName)}_Report`;
    const safeSimpleFilename = safeFilename(baseFilename);
    const encodingInfo = encodeRFC5987Filename(baseFilename);

    console.log('[API] PDF generated successfully:', {
      size: `${(pdfBytes.length / 1024).toFixed(2)}KB`,
      filename: safeSimpleFilename,
      pages: pdfDoc.getPageCount()
    });

    if (format === 'thumbnail') {
      const base64 = Buffer.from(pdfBytes).toString('base64');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        pdfBase64: base64,
        fileName: typeof encodingInfo === 'object' 
          ? `${encodingInfo.simple}.pdf` 
          : safeSimpleFilename + '.pdf',
        pageCount: pdfDoc.getPageCount()
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    
    if (typeof encodingInfo === 'object') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodingInfo.simple}.pdf"; filename*=UTF-8''${encodingInfo.extended}.pdf`
      );
    } else {
      res.setHeader('Content-Disposition', `attachment; filename=${encodingInfo}`);
    }

    console.log('[API] Sending PDF download...');
    return res.status(200).send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('[API] ❌ PDF generation failed:', error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
