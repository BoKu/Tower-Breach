// One-off: generates public/portraits/squad1..4.png with Gemini from docs/portrait-prompts.json (files squad*.png).
// Needs GEMINI_API_KEY in the environment (never printed). Model: GEMINI_IMAGE_MODEL or gemini-3-pro-image-preview.
// Run: node scripts/gen-squad-portraits.mjs [squad2.png ...]   (no args = all four)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY is not set'); process.exit(1); }
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview';
const only = process.argv.slice(2);
const prompts = JSON.parse(fs.readFileSync('docs/portrait-prompts.json', 'utf8'))
  .filter((p) => p.file.startsWith('squad') && (!only.length || only.includes(p.file)));
for (const p of prompts) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: p.prompt }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }),
  });
  const j = await r.json();
  const part = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
  if (!part) { console.error(`${p.file}: no image (${r.status}) ${JSON.stringify(j).slice(0, 300)}`); process.exitCode = 1; continue; }
  const raw = `public/portraits/${p.file}.raw`;
  fs.writeFileSync(raw, Buffer.from(part.inlineData.data, 'base64'));
  // any format/size in -> 512x512 PNG out (macOS sips)
  execFileSync('sips', ['-s', 'format', 'png', '-z', '512', '512', raw, '--out', `public/portraits/${p.file}`], { stdio: 'ignore' });
  fs.unlinkSync(raw);
  console.log(`wrote public/portraits/${p.file}`);
}
