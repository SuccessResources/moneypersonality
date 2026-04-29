const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function embedImageFromUrl(pdfDoc, url) {
  if (!url) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('png')) return await pdfDoc.embedPng(bytes);
    return await pdfDoc.embedJpg(bytes);
  } catch (err) {
    console.error('Image embed failed:', err.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const {
      userName = '',
      personalityType = '',
      personalityName = 'Money Personality',
      description = '',
      characterImage = '',
    } = body;

    // =============================
    // 🔥 IMAGE FIX HERE
    // =============================
    const characterImageMap = {
      saver:
        'https://cch-files.edge.live.ds25.io/cch/v/a4e3489d-6bf3-48c8-affb-c268ba45a538/files/69d3c6fe60dcf_saver.png',
      spender:
        'https://cch-files.edge.live.ds25.io/cch/v/a4e3489d-6bf3-48c8-affb-c268ba45a538/files/69d3c6fe611cd_spender.png',
      monk:
        'https://cch-files.edge.live.ds25.io/cch/v/a4e3489d-6bf3-48c8-affb-c268ba45a538/files/69d3c6fe6114c_monk.png',
      avoider:
        'https://cch-files.edge.live.ds25.io/cch/v/a4e3489d-6bf3-48c8-affb-c268ba45a538/files/69d3c6fe610a0_avoider.png',
    };

    const selectedCharacterImage =
      characterImageMap[String(personalityType || '').toLowerCase()] ||
      characterImage;

    // =============================
    // CREATE PDF
    // =============================
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 800]);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let y = 750;

    page.drawText(`Name: ${userName}`, { x: 50, y, size: 12, font });
    y -= 20;

    page.drawText(`Personality: ${personalityName}`, {
      x: 50,
      y,
      size: 12,
      font,
    });
    y -= 40;

    page.drawText(description, {
      x: 50,
      y,
      size: 10,
      font,
      maxWidth: 500,
    });

    // =============================
    // DRAW IMAGE
    // =============================
    const character = await embedImageFromUrl(
      pdfDoc,
      selectedCharacterImage
    );

    if (character) {
      page.drawImage(character, {
        x: 200,
        y: 300,
        width: 200,
        height: 200,
      });
    }

    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="report.pdf"'
    );

    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'PDF generation failed' });
  }
};
