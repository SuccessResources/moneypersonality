  import { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';

// ================================================================
// CRITICAL FIX: RFC 5987 ENCODING FOR HEADERS
// ================================================================

/**
 * Encode filename for safe HTTP header (handles ALL languages)
 * This is the KEY FIX for Chinese/multilingual filenames
 */
function encodeRFC5987Filename(filename) {
  const ascii = /^[\x20-\x7E]*$/.test(filename);
  
  if (ascii) {
    // Pure ASCII: "Report.pdf" → just quote it
    return `"${filename}"`;
  }

  // Non-ASCII (Chinese, Arabic, etc): UTF-8 percent-encode
  const encoded = Buffer.from(filename, 'utf8')
    .toString('binary')
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      return code < 128 && /^[\w\-.]$/.test(char) 
        ? char 
        : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');

  return {
    simple: String(filename || 'Report')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 100),
    extended: encoded
  };
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

function drawWrappedText(page, text, x, y, width, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, width);
  let currentY = y;
  for (const line of lines) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }
  return currentY;
}

function drawCentered(page, text, y, pageWidth, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1) } = options;
  const tw = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageWidth - tw) / 2, y, size, font, color });
}

function drawCenteredWrapped(page, text, y, pageWidth, maxWidth, options = {}) {
  const { font, size = 12, color = rgb(1, 1, 1), lineHeight = 18 } = options;
  const lines = wrapTextByWidth(text, font, size, maxWidth);
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

function drawGradientV(page, x, y, w, h, colorTop, colorBottom, steps = 24) {
  const stepH = h / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    page.drawRectangle({
      x, y: y + h - (i + 1) * stepH,
      width: w, height: stepH + 0.5,
      color: lerpColor(colorTop, colorBottom, t)
    });
  }
}

function drawGradientH(page, x, y, w, h, colorLeft, colorRight, steps = 30) {
  const stepW = w / steps;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    page.drawRectangle({
      x: x + i * stepW, y,
      width: stepW + 0.5, height: h,
      color: lerpColor(colorLeft, colorRight, t)
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
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  const {
    userName = '',
    language = 'en',
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
    personalityColor = '#C9A227',
    bestMatchName = '',
    bestMatchReason = '',
    percentages = [],
    quizDate = '',
    format = 'pdf'
  } = body || {};

    const deepInsights = {
  saver: {
    strength: {
      en: `You are naturally wired for security, structure, and control when it comes to money.

You do not approach money carelessly. You think ahead, consider consequences, and make decisions with caution. This gives you a major advantage that many people never build: stability.

Because of this, you are often the kind of person who prepares before problems happen. You are less likely to fall into financial chaos and more likely to create a foundation that can support long-term peace of mind.

When this strength is used well, it becomes one of your greatest assets. It allows you to build trust, consistency, and real financial resilience over time.`,
      de: `Du bist bei Geld ganz natürlich auf Sicherheit, Struktur und Kontrolle ausgerichtet.

Du gehst nicht leichtfertig mit Geld um. Du denkst voraus, berücksichtigst Folgen und triffst Entscheidungen mit Vorsicht. Das verschafft dir einen großen Vorteil, den viele Menschen nie wirklich aufbauen: Stabilität.

Dadurch bist du oft die Art von Mensch, die sich vorbereitet, bevor Probleme entstehen. Du gerätst seltener in finanzielles Chaos und schaffst eher ein Fundament, das langfristige Ruhe tragen kann.

Wenn du diese Stärke bewusst nutzt, wird sie zu einem deiner größten Vorteile. Sie hilft dir, Vertrauen, Beständigkeit und echte finanzielle Widerstandskraft aufzubauen.`,
      es: `Tu manera natural de relacionarte con el dinero está basada en la seguridad, la estructura y el control.

No tomas el dinero a la ligera. Piensas con anticipación, consideras las consecuencias y tomas decisiones con cuidado. Esto te da una gran ventaja que muchas personas nunca desarrollan: estabilidad.

Gracias a eso, sueles ser la clase de persona que se prepara antes de que aparezcan los problemas. Es menos probable que caigas en caos financiero y más probable que construyas una base que sostenga tranquilidad a largo plazo.

Cuando usas bien esta fortaleza, se convierte en uno de tus mayores activos. Te permite construir confianza, constancia y verdadera resiliencia financiera con el tiempo.`
    },
    shadow: {
      en: `The same instinct that protects you can also limit you.

Because you value certainty, you may hesitate when opportunities involve risk, change, or unfamiliar territory. You may overanalyze, delay action, or wait too long for the “perfect” moment.

This does not come from weakness. It comes from wanting to stay safe.

But over time, too much caution can quietly become expensive. It can keep you from making bold decisions, growing wealth, or stepping into bigger possibilities that require trust and calculated movement.

Your challenge is not recklessness. It is learning when safety is serving you — and when it is silently holding you back.`,
      de: `Derselbe Instinkt, der dich schützt, kann dich auch begrenzen.

Weil du Sicherheit schätzt, zögerst du möglicherweise, wenn Chancen mit Risiko, Veränderung oder Unsicherheit verbunden sind. Du analysierst zu lange, verschiebst Entscheidungen oder wartest auf den „perfekten“ Moment.

Das kommt nicht aus Schwäche. Es kommt aus dem Wunsch, sicher zu bleiben.

Doch mit der Zeit kann zu viel Vorsicht still und leise teuer werden. Sie kann dich davon abhalten, mutige Entscheidungen zu treffen, Vermögen aufzubauen oder größere Möglichkeiten zu nutzen, die Vertrauen und bewusstes Handeln erfordern.

Deine Herausforderung ist nicht Leichtsinn. Sondern zu erkennen, wann Sicherheit dir dient — und wann sie dich heimlich zurückhält.`,
      es: `El mismo instinto que te protege también puede limitarte.

Como valoras la certeza, puede que dudes cuando las oportunidades implican riesgo, cambio o territorio desconocido. Puedes analizar demasiado, retrasar la acción o esperar demasiado por el “momento perfecto”.

Eso no nace de una debilidad. Nace de tu deseo de mantenerte seguro.

Pero con el tiempo, demasiada cautela puede salir cara sin que lo notes. Puede impedirte tomar decisiones valientes, hacer crecer tu riqueza o avanzar hacia oportunidades mayores que requieren confianza y movimiento calculado.

Tu reto no es volverte imprudente. Es aprender a reconocer cuándo la seguridad te está ayudando — y cuándo te está frenando en silencio.`
    },
    step: {
      en: `Your next step is not simply to save more.

It is to expand your relationship with money beyond protection and into growth.

That means learning how to invest wisely, take measured risks, and let your money do more than sit still. You do not need to become aggressive. You just need to become more comfortable with movement.

Start with one action that stretches your financial identity: learn one growth strategy, review one opportunity, or set aside a portion of money specifically for building, not just preserving.

Your greatest breakthrough will come when security stops being the finish line — and becomes the foundation for freedom.`,
      de: `Dein nächster Schritt ist nicht einfach, noch mehr zu sparen.

Es geht darum, deine Beziehung zu Geld über Schutz hinaus in Richtung Wachstum zu erweitern.

Das bedeutet, klug zu investieren, bewusste Risiken einzugehen und dein Geld mehr tun zu lassen, als nur still dazuliegen. Du musst nicht aggressiv werden. Du musst nur lernen, dich mit Bewegung wohler zu fühlen.

Beginne mit einer Handlung, die deine finanzielle Identität erweitert: lerne eine Wachstumsstrategie, prüfe eine konkrete Chance oder reserviere einen Teil deines Geldes ausdrücklich für Aufbau statt nur für Absicherung.

Dein größter Durchbruch kommt dann, wenn Sicherheit nicht mehr das Endziel ist — sondern das Fundament für Freiheit.`,
      es: `Tu siguiente paso no es simplemente ahorrar más.

Es ampliar tu relación con el dinero, pasando de la protección al crecimiento.

Eso significa aprender a invertir con inteligencia, asumir riesgos medidos y permitir que tu dinero haga más que quedarse quieto. No necesitas volverte agresivo. Solo necesitas sentirte más cómodo con el movimiento.

Empieza con una acción que expanda tu identidad financiera: aprende una estrategia de crecimiento, evalúa una oportunidad o separa una parte de tu dinero específicamente para construir, no solo para preservar.

Tu mayor avance llegará cuando la seguridad deje de ser la meta final — y se convierta en la base de tu libertad.`
    }
  },

  spender: {
    strength: {
      en: `You naturally connect money with energy, enjoyment, and the ability to experience life fully.

You are not afraid to use money. You understand that money can create joy, momentum, generosity, and memorable experiences. This gives you a sense of openness and emotional freedom that many people struggle to access.

You often bring warmth and excitement into the way you live. You know how to celebrate progress, enjoy the present, and make life feel meaningful in real time.

When this strength is directed well, it becomes powerful. It allows you to create a life that feels alive, expressive, and emotionally rich — rather than one built only on restriction and fear.`,
      de: `Du verbindest Geld ganz natürlich mit Energie, Genuss und der Fähigkeit, das Leben intensiv zu erleben.

Du hast keine Angst davor, Geld zu nutzen. Du verstehst, dass Geld Freude, Dynamik, Großzügigkeit und unvergessliche Erlebnisse schaffen kann. Das gibt dir eine Offenheit und emotionale Freiheit, die viele Menschen nur schwer erreichen.

Du bringst oft Wärme und Begeisterung in die Art, wie du lebst. Du weißt, wie man Fortschritte feiert, den Moment genießt und das Leben direkt im Hier und Jetzt bedeutsam macht.

Wenn du diese Stärke gezielt einsetzt, wird sie sehr kraftvoll. Sie hilft dir, ein Leben zu gestalten, das lebendig, ausdrucksstark und emotional reich ist — statt nur von Einschränkung und Angst geprägt zu sein.`,
      es: `Conectas el dinero de manera natural con la energía, el disfrute y la capacidad de vivir plenamente.

No tienes miedo de usar el dinero. Entiendes que el dinero puede crear alegría, impulso, generosidad y experiencias memorables. Eso te da una apertura y una libertad emocional a la que muchas personas no logran acceder.

Sueles aportar calidez y entusiasmo a la manera en que vives. Sabes celebrar el progreso, disfrutar el presente y hacer que la vida se sienta significativa en tiempo real.

Cuando esta fortaleza se canaliza bien, se vuelve muy poderosa. Te permite crear una vida que se siente viva, expresiva y emocionalmente rica — en lugar de una construida solo sobre restricción y miedo.`
    },
    shadow: {
      en: `The challenge is that pleasure without structure can become instability.

Because you are drawn to what feels good now, you may spend before thinking, reward yourself too quickly, or underestimate the long-term effect of repeated financial decisions.

It is not that you do not care about the future. It is that the present tends to feel louder.

Over time, this can create cycles where money flows in but never seems to stay. You may feel frustrated by the gap between how hard you work and how little lasting progress you feel financially.

Your pattern is not about irresponsibility. It is about learning how to pair freedom with discipline so your enjoyment stops costing your future.`,
      de: `Die Herausforderung ist, dass Genuss ohne Struktur schnell zu Instabilität werden kann.

Weil du dich stark von dem angezogen fühlst, was sich jetzt gut anfühlt, gibst du vielleicht aus, bevor du nachdenkst, belohnst dich zu früh oder unterschätzt die langfristige Wirkung wiederholter Geldentscheidungen.

Es ist nicht so, dass dir die Zukunft egal ist. Es ist nur so, dass die Gegenwart oft lauter wirkt.

Mit der Zeit kann das zu einem Kreislauf führen, in dem Geld hereinkommt, aber nie wirklich bleibt. Du spürst vielleicht Frust über den Abstand zwischen deiner harten Arbeit und dem geringen dauerhaften Fortschritt.

Dein Muster ist nicht Verantwortungslosigkeit. Es geht darum zu lernen, Freiheit mit Disziplin zu verbinden, damit dein Genuss nicht länger deine Zukunft kostet.`,
      es: `El desafío es que el placer sin estructura puede convertirse en inestabilidad.

Como te atrae mucho lo que se siente bien ahora, puedes gastar antes de pensar, recompensarte demasiado pronto o subestimar el efecto a largo plazo de tus decisiones financieras repetidas.

No es que no te importe el futuro. Es que el presente suele sentirse más fuerte.

Con el tiempo, esto puede crear ciclos en los que el dinero entra pero nunca parece quedarse. Puede frustrarte la distancia entre lo duro que trabajas y lo poco duradero que se siente tu progreso financiero.

Tu patrón no trata de irresponsabilidad. Trata de aprender a unir libertad con disciplina para que tu disfrute deje de costarle a tu futuro.`
    },
    step: {
      en: `Your next step is not to stop enjoying life.

It is to build a structure strong enough to support your lifestyle instead of fighting against it.

You do not need to become a different person. You need a system that protects your future before emotion decides where your money goes. That can mean automatic savings, spending categories, or clear rules for when to celebrate and when to pause.

Start by putting one simple wealth habit in place before you spend: save first, automate one transfer, or set a limit that protects your long-term goals.

When your natural joy is matched with structure, you become far more powerful with money than you realize.`,
      de: `Dein nächster Schritt ist nicht, aufzuhören, das Leben zu genießen.

Es geht darum, eine Struktur aufzubauen, die deinen Lebensstil trägt, statt gegen ihn zu arbeiten.

Du musst kein anderer Mensch werden. Du brauchst ein System, das deine Zukunft schützt, bevor Emotionen entscheiden, wohin dein Geld fließt. Das kann automatisches Sparen, Ausgabenkategorien oder klare Regeln dafür sein, wann gefeiert wird und wann bewusst pausiert wird.

Beginne damit, eine einfache Vermögensgewohnheit einzubauen, bevor du Geld ausgibst: zuerst sparen, eine Überweisung automatisieren oder ein Limit setzen, das deine langfristigen Ziele schützt.

Wenn deine natürliche Freude mit Struktur verbunden wird, wirst du finanziell viel stärker, als dir bewusst ist.`,
      es: `Tu siguiente paso no es dejar de disfrutar la vida.

Es construir una estructura lo suficientemente fuerte como para sostener tu estilo de vida en lugar de ir en contra de él.

No necesitas convertirte en otra persona. Necesitas un sistema que proteja tu futuro antes de que la emoción decida a dónde va tu dinero. Eso puede significar ahorro automático, categorías de gasto o reglas claras para saber cuándo celebrar y cuándo frenar.

Empieza incorporando un hábito simple de riqueza antes de gastar: ahorra primero, automatiza una transferencia o define un límite que proteja tus metas a largo plazo.

Cuando tu alegría natural se combina con estructura, te vuelves mucho más poderoso con el dinero de lo que imaginas.`
    }
  },

  monk: {
    strength: {
      en: `You naturally place more value on peace, simplicity, and inner balance than on status or material display.

That gives you a rare strength. You are less likely to let money define your worth, and less likely to be emotionally controlled by pressure, comparison, or the need to impress others.

Because of this, you often bring calmness into financial situations that would overwhelm other people. You can detach from unnecessary noise and focus on what truly matters.

When this strength is developed intentionally, it becomes wisdom. It allows you to make grounded decisions and build a life that feels aligned, not just successful on the surface.`,
      de: `Du legst ganz natürlich mehr Wert auf Frieden, Einfachheit und innere Balance als auf Status oder materiellen Eindruck.

Das gibt dir eine seltene Stärke. Es ist weniger wahrscheinlich, dass Geld deinen Wert bestimmt oder dass du emotional von Druck, Vergleichen oder dem Wunsch, andere zu beeindrucken, gesteuert wirst.

Dadurch bringst du oft Ruhe in finanzielle Situationen, die andere Menschen überfordern würden. Du kannst unnötigen Lärm ausblenden und dich auf das konzentrieren, was wirklich wichtig ist.

Wenn diese Stärke bewusst weiterentwickelt wird, wird sie zu Weisheit. Sie hilft dir, geerdete Entscheidungen zu treffen und ein Leben aufzubauen, das sich stimmig anfühlt — nicht nur oberflächlich erfolgreich.`,
      es: `De forma natural valoras más la paz, la simplicidad y el equilibrio interior que el estatus o la apariencia material.

Eso te da una fortaleza poco común. Es menos probable que dejes que el dinero defina tu valor, y menos probable que quedes emocionalmente controlado por la presión, la comparación o la necesidad de impresionar a otros.

Gracias a eso, a menudo aportas calma a situaciones financieras que abrumarían a otras personas. Puedes separarte del ruido innecesario y centrarte en lo que realmente importa.

Cuando esta fortaleza se desarrolla con intención, se convierte en sabiduría. Te permite tomar decisiones con los pies en la tierra y construir una vida que se sienta alineada, no solo exitosa en apariencia.`
    },
    shadow: {
      en: `The risk is that peace can quietly turn into disengagement.

Because money is not your main focus, you may not fully engage with it. You may avoid learning how wealth works, dismiss financial growth as unimportant, or underestimate how useful money can be in supporting your purpose.

This does not make you incapable. It simply means your attention is not naturally pulled toward financial expansion.

Over time, this can create a subtle ceiling. You may settle for enough when you are capable of building far more freedom, impact, and contribution than you realize.

Your limitation is not greed. It is underestimating what money can make possible when it is used in alignment with your values.`,
      de: `Das Risiko besteht darin, dass Frieden still und leise in Distanz kippen kann.

Weil Geld nicht dein Hauptfokus ist, beschäftigst du dich vielleicht nicht vollständig damit. Du lernst nicht wirklich, wie Vermögen funktioniert, hältst finanzielles Wachstum für weniger wichtig oder unterschätzt, wie nützlich Geld sein kann, um deinen Lebenszweck zu unterstützen.

Das macht dich nicht unfähig. Es bedeutet nur, dass deine Aufmerksamkeit nicht automatisch in Richtung finanzieller Entwicklung geht.

Mit der Zeit kann das zu einer unsichtbaren Grenze werden. Du gibst dich mit genug zufrieden, obwohl du in der Lage wärst, viel mehr Freiheit, Wirkung und Beitrag aufzubauen.

Deine Begrenzung ist nicht Gier. Sondern die Unterschätzung dessen, was Geld möglich machen kann, wenn es im Einklang mit deinen Werten eingesetzt wird.`,
      es: `El riesgo es que la paz se convierta silenciosamente en desconexión.

Como el dinero no es tu enfoque principal, puede que no te involucres plenamente con él. Puede que evites aprender cómo funciona la riqueza, minimices la importancia del crecimiento financiero o subestimes lo útil que puede ser el dinero para apoyar tu propósito.

Eso no significa que no seas capaz. Solo significa que tu atención no se dirige naturalmente hacia la expansión financiera.

Con el tiempo, esto puede crear un techo sutil. Puedes conformarte con “lo suficiente” cuando en realidad eres capaz de construir mucha más libertad, impacto y contribución de lo que imaginas.

Tu limitación no es la codicia. Es subestimar todo lo que el dinero puede hacer posible cuando se usa en alineación con tus valores.`
    },
    step: {
      en: `Your next step is not to become materialistic.

It is to build a healthier relationship with wealth as a tool.

Money does not have to pull you away from who you are. In fact, used wisely, it can protect your peace, expand your options, and help you support the people and causes that matter to you.

Begin by reframing wealth as support rather than distraction. Learn one practical money skill, make one intentional growth decision, or choose one financial goal that serves your lifestyle and values.

When peace and prosperity work together, you stop choosing between meaning and money — and start using both with purpose.`,
      de: `Dein nächster Schritt ist nicht, materialistisch zu werden.

Es geht darum, eine gesündere Beziehung zu Wohlstand als Werkzeug aufzubauen.

Geld muss dich nicht von dir selbst entfernen. Im Gegenteil: klug eingesetzt kann es deinen Frieden schützen, deine Möglichkeiten erweitern und dir helfen, Menschen und Anliegen zu unterstützen, die dir wichtig sind.

Beginne damit, Wohlstand als Unterstützung statt als Ablenkung zu sehen. Lerne eine praktische Geldkompetenz, triff eine bewusste Wachstumsentscheidung oder setze dir ein finanzielles Ziel, das zu deinem Lebensstil und deinen Werten passt.

Wenn Frieden und Wohlstand zusammenwirken, musst du nicht länger zwischen Sinn und Geld wählen — du kannst beides bewusst nutzen.`,
      es: `Tu siguiente paso no es volverte materialista.

Es construir una relación más sana con la riqueza como herramienta.

El dinero no tiene por qué alejarte de quien eres. De hecho, bien utilizado, puede proteger tu paz, ampliar tus opciones y ayudarte a apoyar a las personas y causas que realmente te importan.

Empieza por replantear la riqueza como apoyo en lugar de distracción. Aprende una habilidad práctica sobre dinero, toma una decisión consciente de crecimiento o elige una meta financiera que sirva a tu estilo de vida y a tus valores.

Cuando la paz y la prosperidad trabajan juntas, dejas de elegir entre significado y dinero — y empiezas a usar ambos con intención.`
    }
  },

  avoider: {
    strength: {
      en: `Even if it does not feel like it yet, you have more potential with money than you may realize.

People with your pattern are often more emotionally aware than they think. You can feel when money is creating stress, tension, or avoidance — and that awareness matters. It means the issue is not hidden from you. It is simply uncomfortable.

Once you decide to engage, you are capable of making meaningful change surprisingly quickly.

You do not need to become a financial expert overnight. Your strength is that breakthrough can happen fast once avoidance is replaced with consistent action.

That means your real power begins the moment you stop running from the subject and start facing it one step at a time.`,
      de: `Auch wenn es sich vielleicht noch nicht so anfühlt: Du hast beim Thema Geld mehr Potenzial, als du glaubst.

Menschen mit deinem Muster sind oft emotional bewusster, als sie denken. Du spürst, wenn Geld Stress, Druck oder Vermeidung auslöst — und genau dieses Bewusstsein ist wichtig. Das Problem ist für dich nicht unsichtbar. Es ist nur unangenehm.

Sobald du dich entscheidest, hinzuschauen, kannst du überraschend schnell echte Veränderungen erreichen.

Du musst nicht über Nacht zum Finanzexperten werden. Deine Stärke liegt darin, dass Durchbrüche schnell entstehen können, wenn Vermeidung durch konsequente Schritte ersetzt wird.

Deine eigentliche Kraft beginnt in dem Moment, in dem du aufhörst davonzulaufen und anfängst, das Thema Schritt für Schritt anzugehen.`,
      es: `Aunque todavía no lo sientas así, tienes más potencial con el dinero del que imaginas.

Las personas con tu patrón suelen ser más conscientes emocionalmente de lo que creen. Puedes sentir cuándo el dinero genera estrés, tensión o evitación — y esa conciencia importa. Significa que el problema no está oculto para ti. Simplemente es incómodo.

Cuando decides involucrarte, eres capaz de generar cambios importantes sorprendentemente rápido.

No necesitas convertirte en un experto financiero de la noche a la mañana. Tu fortaleza está en que el avance puede llegar rápido cuando la evitación se reemplaza por acción constante.

Eso significa que tu verdadero poder comienza en el momento en que dejas de huir del tema y empiezas a enfrentarlo paso a paso.`
    },
    shadow: {
      en: `Your main challenge is not lack of intelligence or ability. It is avoidance.

When money feels stressful, confusing, or emotionally heavy, your instinct may be to delay, ignore, or disconnect from it. In the short term, that can feel like relief.

But in the long term, avoidance gives money more power over your life.

Bills become more stressful. Decisions feel heavier. Small problems grow larger simply because they were left untouched for too long.

This pattern can create shame, frustration, and the feeling that you are always behind. But the truth is that the cycle continues not because you are incapable — but because avoidance has been protecting you from discomfort while quietly increasing the pressure.`,
      de: `Deine größte Herausforderung ist nicht mangelnde Intelligenz oder fehlende Fähigkeit. Es ist Vermeidung.

Wenn sich Geld stressig, verwirrend oder emotional belastend anfühlt, ist dein erster Impuls vielleicht, es aufzuschieben, zu ignorieren oder dich davon zu distanzieren. Kurzfristig fühlt sich das wie Erleichterung an.

Langfristig gibt Vermeidung dem Geld jedoch mehr Macht über dein Leben.

Rechnungen werden belastender. Entscheidungen fühlen sich schwerer an. Kleine Probleme werden größer, weil sie zu lange unberührt bleiben.

Dieses Muster kann Scham, Frust und das Gefühl erzeugen, immer hinterherzuhinken. Doch der Kreislauf geht nicht weiter, weil du unfähig bist — sondern weil Vermeidung dich vor Unbehagen schützt und dabei still den Druck erhöht.`,
      es: `Tu principal desafío no es la falta de inteligencia ni de capacidad. Es la evitación.

Cuando el dinero se siente estresante, confuso o emocionalmente pesado, tu instinto puede ser posponerlo, ignorarlo o desconectarte de él. A corto plazo, eso puede sentirse como alivio.

Pero a largo plazo, la evitación le da al dinero más poder sobre tu vida.

Las cuentas se vuelven más estresantes. Las decisiones se sienten más pesadas. Los problemas pequeños crecen simplemente porque quedaron sin atender durante demasiado tiempo.

Este patrón puede generar vergüenza, frustración y la sensación de estar siempre atrasado. Pero la verdad es que el ciclo no continúa porque no seas capaz — sino porque la evitación te ha estado protegiendo del malestar mientras aumenta silenciosamente la presión.`
    },
    step: {
      en: `Your next step is not perfection. It is momentum.

You do not need to fix your whole financial life in one day. You only need to create movement where there has been delay.

Start small, but start clearly. Review one account. Track one expense category. Pay one overdue item. Set one simple money routine that you can repeat without overthinking.

The goal is not to become impressive overnight. The goal is to rebuild trust with yourself.

The more consistently you take small actions, the less scary money becomes. And once fear starts shrinking, confidence starts growing. That is how real control is built — one honest step at a time.`,
      de: `Dein nächster Schritt ist nicht Perfektion. Sondern Bewegung.

Du musst nicht dein ganzes finanzielles Leben an einem Tag in Ordnung bringen. Du musst nur dort Bewegung erzeugen, wo bisher Aufschub war.

Fang klein an, aber klar. Prüfe ein Konto. Verfolge eine Ausgabenkategorie. Bezahle eine überfällige Rechnung. Lege eine einfache Geldroutine fest, die du ohne großes Nachdenken wiederholen kannst.

Das Ziel ist nicht, über Nacht beeindruckend zu werden. Das Ziel ist, das Vertrauen in dich selbst wieder aufzubauen.

Je konsequenter du kleine Schritte machst, desto weniger bedrohlich wirkt Geld. Und sobald die Angst kleiner wird, wächst das Selbstvertrauen. So entsteht echte Kontrolle — ein ehrlicher Schritt nach dem anderen.`,
      es: `Tu siguiente paso no es la perfección. Es el impulso.

No necesitas arreglar toda tu vida financiera en un solo día. Solo necesitas generar movimiento donde antes había retraso.

Empieza pequeño, pero empieza con claridad. Revisa una cuenta. Controla una categoría de gasto. Paga algo atrasado. Establece una rutina simple con el dinero que puedas repetir sin sobrepensar.

La meta no es parecer impresionante de la noche a la mañana. La meta es reconstruir la confianza contigo mismo.

Cuanto más constantes sean tus pequeñas acciones, menos miedo dará el dinero. Y cuando el miedo empieza a reducirse, la confianza empieza a crecer. Así se construye el verdadero control: un paso honesto a la vez.`
    }
  }
};

const normalizedLanguage = ['en', 'de', 'es'].includes(language) ? language : 'en';
const normalizedType = String(personalityType || '').toLowerCase().trim();

const resolvedStrengthText =
  deepInsights[normalizedType]?.strength?.[normalizedLanguage] ||
  deepInsights[normalizedType]?.strength?.en ||
  strengthText;

const resolvedShadowText =
  deepInsights[normalizedType]?.shadow?.[normalizedLanguage] ||
  deepInsights[normalizedType]?.shadow?.en ||
  shadowText;

const resolvedStepText =
  deepInsights[normalizedType]?.step?.[normalizedLanguage] ||
  deepInsights[normalizedType]?.step?.en ||
  stepText;

    const pdfText = {
  en: {
    page2Title: 'YOUR PERSONALITY BLUEPRINT',
    bestCompatible: 'BEST COMPATIBLE PERSONALITY',
    quote1: '"Your relationship with money is a mirror',
    quote2: 'of your relationship with yourself."',
    reportFooter: 'Money Personality Assessment Report',

    page3Title: 'DEEP PERSONALITY INSIGHTS',

    page4Top1: 'NOW YOU KNOW YOUR',
    page4Top2: 'MONEY PERSONALITY.',
    page4Hero1: "IT'S TIME TO",
    page4Hero2: 'REWRITE YOUR',
    page4Hero3: 'MONEY BLUEPRINT.',
    eventTitle: 'MILLIONAIRE MIND HYBRID',
    eventSubtitle: 'LIVE ONLINE EVENT',
    bullet1: 'Discover the 17 wealth principles of millionaires',
    bullet2: 'Reset your financial thermostat in 3 days',
    bullet3: 'Join thousands transforming their money blueprint',
    bullet4: "Learn directly from T. Harv Eker's proven system",
    cta: 'CLAIM YOUR SEAT NOW',
    closing1: `${userName}, your blueprint is waiting to be rewritten.`,
    closing2: 'The knowledge you need. The transformation you deserve.',
    footerBrand: 'MILLIONAIRE MIND  x  SUCCESS RESOURCES',
    footerCopyright: '(c) 2026 Success Resources. All rights reserved.',
    confidential: 'CONFIDENTIAL  |  PERSONAL ASSESSMENT',
    coverTitle1: 'MONEY PERSONALITY',
    coverTitle2: 'ASSESSMENT REPORT',
    preparedFor: 'Prepared exclusively for'
  },

  de: {
    page2Title: 'DEIN PERSÖNLICHKEITS-PLAN',
    bestCompatible: 'BESTE PASSENDE PERSÖNLICHKEIT',
    quote1: '"Deine Beziehung zu Geld ist ein Spiegel',
    quote2: 'deiner Beziehung zu dir selbst."',
    reportFooter: 'Bericht zur Geldpersönlichkeit',

    page3Title: 'TIEFE PERSÖNLICHE EINBLICKE',

    page4Top1: 'JETZT KENNST DU DEINE',
    page4Top2: 'GELDPERSÖNLICHKEIT.',
    page4Hero1: 'ES IST ZEIT,',
    page4Hero2: 'DEINEN',
    page4Hero3: 'GELD-BAUPLAN NEU ZU SCHREIBEN.',
    eventTitle: 'MILLIONAIRE MIND HYBRID',
    eventSubtitle: 'LIVE-ONLINE-EVENT',
    bullet1: 'Entdecke die 17 Wohlstandsprinzipien der Millionäre',
    bullet2: 'Setze deinen finanziellen Thermostat in 3 Tagen neu',
    bullet3: 'Schließe dich Tausenden an, die ihren Geld-Bauplan verändern',
    bullet4: 'Lerne direkt aus dem bewährten System von T. Harv Eker',
    cta: 'SICHERE DIR JETZT DEINEN PLATZ',
    closing1: `${userName}, dein Geld-Bauplan wartet darauf, neu geschrieben zu werden.`,
    closing2: 'Das Wissen, das du brauchst. Die Veränderung, die du verdienst.',
    footerBrand: 'MILLIONAIRE MIND  x  SUCCESS RESOURCES',
    footerCopyright: '(c) 2026 Success Resources. Alle Rechte vorbehalten.',
    confidential: 'VERTRAULICH  |  PERSÖNLICHE AUSWERTUNG',
    coverTitle1: 'GELDPERSÖNLICHKEIT',
    coverTitle2: 'AUSWERTUNGSBERICHT',
    preparedFor: 'Exklusiv erstellt für'
  },

  es: {
    page2Title: 'TU MAPA DE PERSONALIDAD',
    bestCompatible: 'PERSONALIDAD MÁS COMPATIBLE',
    quote1: '"Tu relación con el dinero es un reflejo',
    quote2: 'de tu relación contigo mismo."',
    reportFooter: 'Informe de personalidad del dinero',

    page3Title: 'INSIGHTS PROFUNDOS DE TU PERSONALIDAD',

    page4Top1: 'AHORA YA CONOCES TU',
    page4Top2: 'PERSONALIDAD DEL DINERO.',
    page4Hero1: 'ES MOMENTO DE',
    page4Hero2: 'REESCRIBIR TU',
    page4Hero3: 'PLANO FINANCIERO.',
    eventTitle: 'MILLIONAIRE MIND HYBRID',
    eventSubtitle: 'EVENTO EN VIVO ONLINE',
    bullet1: 'Descubre los 17 principios de riqueza de los millonarios',
    bullet2: 'Reprograma tu termostato financiero en 3 días',
    bullet3: 'Únete a miles que están transformando su plano financiero',
    bullet4: 'Aprende directamente del sistema probado de T. Harv Eker',
    cta: 'RESERVA TU LUGAR AHORA',
    closing1: `${userName}, tu plano financiero está esperando ser reescrito.`,
    closing2: 'El conocimiento que necesitas. La transformación que mereces.',
    footerBrand: 'MILLIONAIRE MIND  x  SUCCESS RESOURCES',
    footerCopyright: '(c) 2026 Success Resources. Todos los derechos reservados.',
    confidential: 'CONFIDENCIAL  |  EVALUACIÓN PERSONAL',
    coverTitle1: 'PERSONALIDAD DEL DINERO',
    coverTitle2: 'INFORME DE EVALUACIÓN',
    preparedFor: 'Preparado exclusivamente para'
  }
};

const t = pdfText[normalizedLanguage] || pdfText.en;

    const pdfDoc = await PDFDocument.create();
    const width = 595.28;
    const height = 841.89;

    // Standard fonts (no external fetch needed)
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

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

    drawCentered(page1, t.coverTitle1, height - 158, width, {
      font: fontBold, size: 28, color: white
    });
    drawCentered(page1, t.coverTitle2, height - 190, width, {
      font: fontBold, size: 28, color: gold
    });

    if (userName) {
      drawCentered(page1, t.preparedFor, height - 232, width, {
        font: fontOblique, size: 11, color: softGray
      });
      drawCentered(page1, userName, height - 256, width, {
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
    drawCentered(page1, personalityName.toUpperCase(), badgeY + 15, width, {
      font: fontBold, size: 20, color: white
    });

    drawCenteredWrapped(page1, description, badgeY - 28, width, 440, {
      font: fontRegular, size: 11, color: offWhite, lineHeight: 17
    });

    drawDivider(page1, 40, 65, width - 80, goldDim, 0.5);
    drawCentered(page1, t.confidential, 45, width, {
      font: fontRegular, size: 8, color: softGray
    });

    // ================================================================
    // PAGE 2 - PERSONALITY MIX + BEST MATCH
    // ================================================================
    const page2 = pdfDoc.addPage([width, height]);

    drawGradientV(page2, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page2, 0, height - 3, width, 3, gold, successGreen, 40);

    page2.drawText('02', {
      x: 40, y: height - 52, size: 36, font: fontBold, color: goldDim
    });
    page2.drawText(t.page2Title, {
      x: 92, y: height - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(page2, 40, height - 62, width - 80, goldDim, 0.5);

    const mixCardY = height - 380;
    const mixCardH = 290;
    drawCard(page2, 40, mixCardY, width - 80, mixCardH, cardDark, cardMid);

    page2.drawText(mixLabel.toUpperCase(), {
      x: 65, y: mixCardY + mixCardH - 35, size: 12, font: fontBold, color: gold
    });
    drawDivider(page2, 65, mixCardY + mixCardH - 48, 160, goldDim, 0.5);

    let barY = mixCardY + mixCardH - 82;
    const barMaxW = 260;
    const barH = 18;
    const maxVal = Math.max(...percentages.map(p => Number(p?.value || 0)), 1);

    percentages.forEach((item) => {
      const label = String(item?.label || '');
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

    page2.drawText(t.bestCompatible, {
      x: 65, y: matchCardY + matchCardH - 30,
      size: 10, font: fontBold, color: greenLight
    });
    page2.drawText(bestMatchName || '-', {
      x: 65, y: matchCardY + matchCardH - 58,
      size: 20, font: fontBold, color: white
    });
    drawWrappedText(page2, bestMatchReason || '', 65, matchCardY + matchCardH - 80, width - 140, {
      font: fontRegular, size: 10, color: offWhite, lineHeight: 15
    });

    const quoteY = matchCardY - 80;
    drawCentered(page2, t.quote1, quoteY, width, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(page2, t.quote2, quoteY - 18, width, {
      font: fontOblique, size: 12, color: softGray
    });
    drawCentered(page2, '- T. Harv Eker', quoteY - 48, width, {
      font: fontBold, size: 12, color: gold
    });

    drawDivider(page2, 40, 45, width - 80, goldDim, 0.5);
    page2.drawText(t.reportFooter, {
      x: 40, y: 28, size: 8, font: fontRegular, color: softGray
    });
    if (userName) {
      const nameW = fontRegular.widthOfTextAtSize(userName, 8);
      page2.drawText(userName, {
        x: width - 40 - nameW, y: 28, size: 8, font: fontRegular, color: softGray
      });
    }

    // ================================================================
    // PAGE 3 - DEEP PERSONALITY INSIGHTS
    // ================================================================
    const page3 = pdfDoc.addPage([width, height]);

    drawGradientV(page3, 0, 0, width, height, rgb(0.06, 0.06, 0.06), midnight, 30);
    drawGradientH(page3, 0, height - 3, width, 3, gold, successGreen, 40);

    page3.drawText('03', {
      x: 40, y: height - 52, size: 36, font: fontBold, color: goldDim
    });
    page3.drawText(t.page3Title, {
      x: 92, y: height - 42, size: 13, font: fontBold, color: gold
    });
    drawDivider(page3, 40, height - 62, width - 80, goldDim, 0.5);

    const sections = [
      { label: strengthLabel, text: resolvedStrengthText, accentColor: successGreen },
      { label: shadowLabel, text: resolvedShadowText, accentColor: rgb(0.75, 0.45, 0.12) },
      { label: stepLabel, text: resolvedStepText, accentColor: accent }
    ];

    let sectionY = height - 100;

    sections.forEach((section) => {
      const cardH = 195;
      const cy = sectionY - cardH;

      drawCard(page3, 40, cy, width - 80, cardH, cardDark, cardMid);

      page3.drawRectangle({
        x: 40, y: cy, width: 4, height: cardH, color: section.accentColor
      });

      page3.drawText(section.label.toUpperCase(), {
        x: 65, y: cy + cardH - 32,
        size: 14, font: fontBold, color: gold
      });

      drawDivider(page3, 65, cy + cardH - 46, 200, goldDim, 0.5);

      drawWrappedText(page3, section.text || '', 65, cy + cardH - 68, width - 140, {
        font: fontRegular, size: 11, color: offWhite, lineHeight: 16
      });

      sectionY = cy - 22;
    });

    drawDivider(page3, 40, 45, width - 80, goldDim, 0.5);
    page3.drawText(t.reportFooter, {
      x: 40, y: 28, size: 8, font: fontRegular, color: softGray
    });

    // ================================================================
    // PAGE 4 - CTA
    // ================================================================
    const page4 = pdfDoc.addPage([width, height]);

    drawGradientV(page4, 0, 0, width, height, rgb(0.06, 0.12, 0.07), midnight, 40);
    drawGradientH(page4, 0, height - 4, width, 4, gold, successGreen, 40);
    drawDecoCorner(page4, 35, height - 40, 30, gold);
    drawDecoCorner(page4, width - 35, 40, 30, gold, true);

    drawCentered(page4, t.page4Top1, height - 120, width, {
      font: fontBold, size: 15, color: softGray
    });
    drawCentered(page4, t.page4Top2, height - 142, width, {
      font: fontBold, size: 15, color: softGray
    });

    drawCentered(page4, t.page4Hero1, height - 198, width, {
      font: fontBold, size: 32, color: white
    });
    drawCentered(page4, t.page4Hero2, height - 236, width, {
      font: fontBold, size: 32, color: gold
    });
    drawCentered(page4, t.page4Hero3, height - 274, width, {
      font: fontBold, size: 32, color: gold
    });

    drawDivider(page4, width / 2 - 80, height - 300, 160, gold, 1.5);

    const evtCardW = 430;
    const evtCardH = 195;
    const evtCardX = (width - evtCardW) / 2;
    const evtCardY = height - 520;

    drawCard(page4, evtCardX, evtCardY, evtCardW, evtCardH, cardDark, gold, 1.5);

    drawCentered(page4, t.eventTitle, evtCardY + evtCardH - 35, width, {
      font: fontBold, size: 19, color: gold
    });
    drawCentered(page4, t.eventSubtitle, evtCardY + evtCardH - 60, width, {
      font: fontBold, size: 12, color: white
    });

    drawDivider(page4, evtCardX + 40, evtCardY + evtCardH - 75, evtCardW - 80, goldDim, 0.5);

    const bullets = [
      t.bullet1,
      t.bullet2,
      t.bullet3,
      t.bullet4
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

    drawCentered(page4, t.cta, ctaY + 18, width, {
      font: fontBold, size: 17, color: midnight
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

    const urlStr = 'www.millionairemind.online';
    drawCentered(page4, urlStr, ctaY - 28, width, {
      font: fontBold, size: 12, color: gold
    });

    const urlTextW = fontRegular.widthOfTextAtSize(urlStr, 12);
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
      drawCentered(page4, t.closing1, ctaY - 78, width, {
        font: fontOblique, size: 12, color: offWhite
      });
    }

    drawCentered(page4, t.closing2, ctaY - 105, width, {
      font: fontOblique, size: 11, color: softGray
    });

    drawDivider(page4, 40, 65, width - 80, goldDim, 0.5);
    drawCentered(page4, t.footerBrand, 45, width, {
      font: fontBold, size: 9, color: gold
    });
    drawCentered(page4, t.footerCopyright, 28, width, {
      font: fontRegular, size: 7, color: softGray
    });

    // ================================================================
    // GENERATE OUTPUT - FIX IS HERE!
    // ================================================================
    const pdfBytes = await pdfDoc.save();

    // Build filename
    const baseFilename = `${userName ? userName + '_' : ''}${personalityName}_Report`;
    const encodingInfo = encodeRFC5987Filename(baseFilename);

    // Thumbnail mode
    if (format === 'thumbnail') {
      const base64 = Buffer.from(pdfBytes).toString('base64');
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        pdfBase64: base64,
        fileName: typeof encodingInfo === 'object' 
          ? `${encodingInfo.simple}.pdf` 
          : encodingInfo.replace(/"/g, '').split(';')[0] + '.pdf',
        pageCount: pdfDoc.getPageCount()
      });
    }

    // ⭐ KEY FIX: Proper RFC 5987 header encoding
    res.setHeader('Content-Type', 'application/pdf');
    
    if (typeof encodingInfo === 'object') {
      // Non-ASCII filename: use both filename and filename*
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodingInfo.simple}.pdf"; filename*=UTF-8''${encodingInfo.extended}.pdf`
      );
    } else {
      // ASCII filename: use simple format
      res.setHeader('Content-Disposition', `attachment; filename=${encodingInfo}`);
    }

    return res.status(200).send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('PDF generation failed:', error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      message: error.message
    });
  }
}
