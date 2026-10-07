import { it, expect } from 'vitest';

// Browser-free check of the playout scheduler: a decoded AudioData reports sampleRate 0 once closed, so reading it
// after close() turned the playout clock into Infinity and every frame after the first was dropped (silent voice).
it('voice playout keeps scheduling frames back to back', async () => {
  const starts: number[] = [];
  const node = () => ({ connect: (n: any) => n ?? node(), gain: { value: 1, setTargetAtTime() {} }, pan: { setTargetAtTime() {} }, frequency: { value: 0, setTargetAtTime() {} }, type: '' });
  (globalThis as any).AudioContext = class {
    currentTime = 1; state = 'running'; destination = node();
    createGain() { return node(); } createBiquadFilter() { return node(); } createStereoPanner() { return node(); }
    createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { buffer: null, connect() {}, start: (t: number) => starts.push(t) }; }
  };
  const { VoiceChat } = await import('../src/audio/voice');
  const v = new VoiceChat() as any;
  const sp = { gain: node(), next: 0 };
  const frame = () => { let closed = false; return { numberOfFrames: 960, get sampleRate() { return closed ? 0 : 48000; }, copyTo() {}, close() { closed = true; } }; };
  for (let i = 0; i < 5; i++) v.play(sp, frame());
  expect(starts.length).toBe(5);
  for (let i = 1; i < 5; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(0.02, 6);
});
