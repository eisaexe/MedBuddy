// ── Disable SSL verification (needed for corporate/proxy networks) ──────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Groq = require('groq-sdk');

const app = express();
const PORT = 3000;

// ── API Key (hardcoded) ──────────────────────────────────────────────────────
const GROQ_API_KEY = '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';

function getGroq() {
  return new Groq({ apiKey: GROQ_API_KEY });
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/fa', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free')));

// ── File Upload ──────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Medi Buddy, a direct and efficient AI health assistant. You triage symptoms by asking short questions before giving any answer and you are savage for silly questions and non medical related questions.

TONE RULES (strict):
- Be direct and concise. No filler phrases like "I'm sorry to hear that", "That must be tough", or "I understand how you feel". Skip all of that.
- Get straight to the question. One sentence max before the question.
- Use **bold** for any important medical terms, key findings, or critical advice.
- Keep every response as short as possible.
- If the user ask you to do something that is not related to medical information, say that u dont answer to non medical information.
- give savage answers to silly questions like if the users says im male and i got periods and if he says im dead and i wana get revived. 


CONVERSATION RULES (NEVER break):
1. NEVER give a diagnosis or advice immediately. Always ask a clarifying question first.
2. Every question response MUST end with exactly 4 options: A), B), C), D).
3. One question per response only.
4. After 3-4 user answers, give a SHORT final summary (2-3 sentences max) + medicines.
5. Only elaborate if user says "tell me more" or "explain".
6. NEVER write "MEDICINES_JSON is not applicable" or "CONDITION_JSON is not applicable". Omit those tags entirely if not needed.
7. EMERGENCY: chest pain + left arm pain, sudden vision loss, or stroke signs → reply ONLY: "🚨 **Medical emergency.** Call 112 or go to the nearest ER immediately." Then stop.
8. Reply in the same language the user used.

QUESTION FORMAT:
[Max one short direct sentence.]

**[Question?]**

A) [option]
B) [option]
C) [option]
D) [option]

--- EXAMPLE ---
User: I have a stomach ache.
Medi Buddy: Quick question to narrow it down.

**Where exactly is the pain?**

A) Upper abdomen (below chest)
B) Lower abdomen (below belly button)
C) Left side
D) Right side
--- END EXAMPLE ---

FINAL SUMMARY FORMAT (SHORT — 2-3 sentences only):
**[Likely condition in bold.]** [One sentence explanation.] [One sentence on what to do.]
💊 **Relief:** [1 short sentence]
⚠️ **See a doctor if:** [1 red flag sentence]

_Want more details or home care tips?_

[Silently append — no labels, no explanation:]
MEDICINES_JSON:[{"name":"Med1","generic":"Generic","use":"Use","dosage":"Dose","type":"tablet"},{"name":"Med2","generic":"Generic","use":"Use","dosage":"Dose","type":"tablet"}]
CONDITION_JSON:{"condition":"ConditionName","severity":"mild/moderate/severe"}`;

// ── Analysis Prompt (file uploads — no follow-up questions) ──────────────────
const ANALYZE_PROMPT = `You are a medical report analyst. Analyze any medical report, image, or X-ray given to you and explain it directly.

RULES:
- Give a complete direct analysis immediately. Do NOT ask any follow-up questions.
- Use **bold** for key findings, abnormal values, and important medical terms.
- Keep language simple — translate medical jargon into plain words.
- At the end include 2-3 medicine recommendations if applicable.
- Silently append MEDICINES_JSON and CONDITION_JSON at the very end if relevant. Never write "not applicable".
- Only respond with medical information no matter what the user tells you.
- If the user ask you to do something that is not related to medical information, say that u dont answer to non medical information.
- give savage answers to silly questions like if the users says im male and i got periods and if he says im dead and i wana get revived. 

FORMAT:
**Findings:**
[Key findings, bold the abnormal values]

**What this means:**
[2-3 sentence plain English explanation]

**What to do:**
[1-2 actionable steps]

⚠️ **See a doctor if:** [one specific red flag]`;

// ── Chat ─────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const groq = getGroq();
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.3,
      max_tokens: 2048,
    });
    res.json({ content: response.choices[0].message.content });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── File Analysis ─────────────────────────────────────────────────────────────
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const groq = getGroq();
    const { context } = req.body;
    const isPDF = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
    let content;

    if (isPDF) {
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(fs.readFileSync(filePath));
      const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: ANALYZE_PROMPT },
          { role: 'user', content: `Analyze this medical report and explain it simply:\n${context ? `Patient note: "${context}"\n` : ''}Document:\n${pdfData.text.slice(0, 8000)}` }
        ],
        temperature: 0.6, max_tokens: 2048,
      });
      content = result.choices[0].message.content;
    } else {
      const base64Image = fs.readFileSync(filePath).toString('base64');
      const mimeType = req.file.mimetype || 'image/jpeg';
      const result = await groq.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: ANALYZE_PROMPT },
          {
            role: 'user', content: [
              { type: 'text', text: `Analyze this medical image and explain in simple terms what you see.${context ? ` Patient note: "${context}"` : ''}` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        temperature: 0.6, max_tokens: 2048,
      });
      content = result.choices[0].message.content;
    }

    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ content });
  } catch (err) {
    console.error('Analyze error:', err.message);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: err.message });
  }
});

// ── Nearby Hospitals ──────────────────────────────────────────────────────────
// Helper: POST to Overpass API, tries two mirrors
function overpassPost(query) {
  const mirrors = ['overpass-api.de', 'overpass.kumi.systems'];
  const postData = Buffer.from(query, 'utf8');
  let attempt = 0;

  function tryNext(resolve, reject) {
    if (attempt >= mirrors.length) return reject(new Error('All Overpass mirrors failed'));
    const hostname = mirrors[attempt++];
    const opts = {
      hostname, path: '/api/interpreter', method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Content-Length': postData.length, 'User-Agent': 'MedBuddy/1.0' },
      timeout: 20000, rejectUnauthorized: false
    };
    const r = https.request(opts, res2 => {
      let body = '';
      res2.on('data', c => body += c);
      res2.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { tryNext(resolve, reject); }
      });
    });
    r.on('error', () => tryNext(resolve, reject));
    r.on('timeout', () => { r.destroy(); tryNext(resolve, reject); });
    r.write(postData);
    r.end();
  }
  return new Promise(tryNext);
}

app.get('/api/hospitals', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    let hospitals = [];
    const radii = [5000, 10000, 20000];

    for (const radius of radii) {
      const query = `[out:json][timeout:20];
(
  node["amenity"="hospital"](around:${radius},${lat},${lon});
  node["amenity"="clinic"](around:${radius},${lat},${lon});
  node["healthcare"="hospital"](around:${radius},${lat},${lon});
  node["healthcare"="clinic"](around:${radius},${lat},${lon});
  way["amenity"="hospital"](around:${radius},${lat},${lon});
  way["amenity"="clinic"](around:${radius},${lat},${lon});
);
out center 20;`;

      const data = await overpassPost(query);

      hospitals = data.elements.map(el => {
        const elLat = el.lat || el.center?.lat;
        const elLon = el.lon || el.center?.lon;
        if (!elLat || !elLon) return null;
        const dist = calcDist(parseFloat(lat), parseFloat(lon), elLat, elLon);
        const addr = [el.tags?.['addr:housenumber'], el.tags?.['addr:street'], el.tags?.['addr:suburb'], el.tags?.['addr:city']].filter(Boolean).join(', ');
        return {
          id: el.id,
          name: el.tags?.name || el.tags?.['name:en'] || 'Hospital / Clinic',
          type: el.tags?.amenity || el.tags?.healthcare || 'hospital',
          specialty: el.tags?.['healthcare:speciality'] || null,
          address: addr || 'Address not available',
          phone: el.tags?.phone || el.tags?.['contact:phone'] || null,
          emergency: el.tags?.emergency === 'yes',
          lat: elLat, lon: elLon,
          distanceKm: dist.toFixed(1),
          mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${elLat},${elLon}`
        };
      }).filter(Boolean).sort((a, b) => parseFloat(a.distanceKm) - parseFloat(b.distanceKm)).slice(0, 12);

      if (hospitals.length > 0) break;
    }

    res.json({ hospitals });
  } catch (err) {
    console.error('Hospital error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function calcDist(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   🏥  MedBuddy is now running!       ║');
  console.log(`║   👉  http://localhost:${PORT}           ║`);
  console.log('╚══════════════════════════════════════╝\n');
});
