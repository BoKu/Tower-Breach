// One-off: speaks every bot line (src/config/botLines.json) once with Gemini TTS: even-numbered lines (0, 2, …) in a male
// voice, odd ones in a female voice (the squad is two men and two women), and writes public/audio/voice/NNN.m4a
// (AAC, mono, 32 kbps via macOS afconvert): 100 clips in all. Needs GEMINI_API_KEY (never printed).
// Run: node scripts/gen-bot-voices.mjs        (skips clips that already exist; re-run to fill gaps)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY is not set'); process.exit(1); }
const model = process.env.GEMINI_TTS_MODEL ?? 'gemini-3.8-flash-tts';
const VOICES = { m: 'Orus', f: 'Kore' };
const lines = JSON.parse(fs.readFileSync('src/config/botLines.json', 'utf8'));
const jobs = [];
fs.mkdirSync('public/audio/voice', { recursive: true });
lines.forEach((text, i) => { const out = `public/audio/voice/${String(i).padStart(3, '0')}.m4a`; if (!fs.existsSync(out)) jobs.push({ text, voice: i % 2 ? VOICES.f : VOICES.m, out }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function one({ text, voice, out }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
    const j = await r.json();
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) { console.error(`${out}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`); return false; }
    const wav = out.replace(/\.m4a$/, '.wav');
    let audio = Buffer.from(part.inlineData.data, 'base64');
    if (audio.subarray(0, 4).toString() !== 'RIFF') { // older models send raw 16-bit PCM (audio/L16;rate=24000): add a WAV header
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000), h = Buffer.alloc(44);
      h.write('RIFF', 0); h.writeUInt32LE(36 + audio.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
      h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(audio.length, 40);
      audio = Buffer.concat([h, audio]);
    }
    fs.writeFileSync(wav, audio);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '32000', '-c', '1', wav, out]);
    fs.unlinkSync(wav);
    return true;
  }
  console.error(`${out}: gave up (rate limited)`);
  return false;
}
let done = 0, failed = 0;
const queue = [...jobs];
await Promise.all([0].map(async () => { while (queue.length) { const j = queue.shift(); (await one(j)) ? done++ : failed++; } }));
console.log(`made ${done}, failed ${failed}, of ${jobs.length}`);
