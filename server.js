// ── Disable SSL verification (needed for corporate/proxy networks) ──────────
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const Groq    = require('groq-sdk');

const app  = express();
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
const SYSTEM_PROMPT = `You are MedBuddy, a compassionate, knowledgeable, and friendly AI medical assistant.

Your core responsibilities:
1. Answer medical questions in clear, simple language anyone can understand. Avoid jargon, explain it when used.
2. CRITICAL: Always respond in the EXACT SAME LANGUAGE the user writes in. Hindi→Hindi, Arabic→Arabic, Tamil→Tamil etc.
3. Be warm, empathetic, and reassuring — never alarming or dismissive.
4. Always end with a gentle reminder to consult a real doctor for serious conditions.
5. Highlight important information by using **bold** text.

FOLLOW-UP QUESTIONS FORMAT:
When symptoms are vague or you need more context, you MUST ask a follow-up question and provide multiple-choice options for the user to select.
Include this EXACT format at the end of your response:
FOLLOWUP_JSON:{"question":"Your clear question here?","options":["Option 1","Option 2","Option 3","Other/Not sure"]}

MEDICINE RECOMMENDATIONS FORMAT:
When recommending medicines, include at the very end in this EXACT format:
MEDICINES_JSON:[{"name":"Medicine Name","generic":"Generic Name","use":"What it treats","dosage":"Recommended dosage","type":"tablet/syrup/capsule/cream/etc"}]

CONDITION DETECTION FORMAT:
When you identify a condition, include:
CONDITION_JSON:{"condition":"Exact Condition Name","severity":"mild/moderate/severe"}

Remember: You are NOT a replacement for professional medical advice. Prioritize patient safety above all else.`;

// ── Chat ─────────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    const groq = getGroq();
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7,
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
          { role: 'system', content: SYSTEM_PROMPT },
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: `Analyze this medical image and explain in simple terms what you see.${context ? ` Patient note: "${context}"` : ''}` },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]}
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
app.get('/api/hospitals', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    let hospitals = [];
    const radii = [5000, 10000, 20000]; // Search up to 20km
    
    for (const radius of radii) {
      const query = `[out:json][timeout:25];
(
  node["amenity"="hospital"](around:${radius},${lat},${lon});
  node["amenity"="clinic"](around:${radius},${lat},${lon});
  node["healthcare"="hospital"](around:${radius},${lat},${lon});
  node["healthcare"="clinic"](around:${radius},${lat},${lon});
  way["amenity"="hospital"](around:${radius},${lat},${lon});
  way["amenity"="clinic"](around:${radius},${lat},${lon});
);
out center 20;`;

      const data = await new Promise((resolve, reject) => {
        const postData = Buffer.from(query, 'utf8');
        const options = {
          hostname: 'overpass-api.de',
          path: '/api/interpreter',
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'Content-Length': postData.length,
            'User-Agent': 'MedBuddy/1.0'
          },
          timeout: 25000,
          rejectUnauthorized: false
        };
        const r = https.request(options, response => {
          let body = '';
          response.on('data', c => body += c);
          response.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Bad response from hospital API')); }
          });
        });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(); reject(new Error('Hospital search timed out')); });
        r.write(postData);
        r.end();
      });

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

      if (hospitals.length > 0) {
        break; // Found some hospitals, stop expanding radius
      }
    }

    res.json({ hospitals });
  } catch (err) {
    console.error('Hospital error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function calcDist(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   🏥  MedBuddy is now running!       ║');
  console.log(`║   👉  http://localhost:${PORT}           ║`);
  console.log('╚══════════════════════════════════════╝\n');
});
