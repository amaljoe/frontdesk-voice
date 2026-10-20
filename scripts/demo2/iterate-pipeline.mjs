// Auto-iterate the pipeline take: try a barge-gap, record, score, adjust, repeat until GOOD.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const run = (c) => execSync(c, { encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe','pipe','pipe'] });
const mkMic = (bargeGap, tailGaps) => {
  // caller lines with explicit gaps (silence BEFORE each line). One barge-in: line 2 after bargeGap.
  const lines = [[1.0, "Hi! I'd like to book a teeth cleaning, please."], [bargeGap, 'Sorry, could you check Wednesday instead?'], [tailGaps, 'Wednesday at nine is perfect.'], [tailGaps, "My name is Alex Kim."], [tailGaps, 'Great, thank you. Bye!'], [6.0, null]];
  fs.writeFileSync('scripts/demo2/_lines.json', JSON.stringify(lines));
};
let gap = 4.2, tail = 7.0, best = null;
for (let i = 0; i < 5; i++) {
  mkMic(gap, tail);
  console.log(`\n--- iteration ${i+1}: bargeGap=${gap}s tailGap=${tail}s ---`);
  run('ASR_LINES=scripts/demo2/_lines.json node scripts/demo2/make-mic-tuned.mjs pipeline');
  const rec = run('node scripts/demo2/record-segment.mjs out/demo2/mic-pipeline.wav pipeline pipeline dental 32 2>&1 || true');
  const booked = /Appointment booked/.test(rec);
  run('ffmpeg -loglevel error -y -i out/demo2/audio-pipeline.webm out/demo2/audio-pipeline.wav');
  const score = run('node scripts/demo2/score-take.mjs out/demo2/audio-pipeline.wav');
  console.log(score.trim(), '\nbooked:', booked);
  const m = score.match(/spoke ([0-9.]+)s before/);
  const before = m ? +m[1] : 0;
  const good = /VERDICT: GOOD/.test(score) && booked;
  if (good) { console.log('\n*** GOOD TAKE — keeping iteration', i+1, '***'); fs.copyFileSync('out/demo2/audio-pipeline.webm', 'out/demo2/BEST-pipeline.webm'); process.exit(0); }
  // adjust: if agent cut too early, widen the barge gap
  if (before < 2.2) gap += 1.2; else if (/barge too late/.test(score)) gap -= 0.8;
  if (/too many cut-offs/.test(score)) tail += 1.0;
}
console.log('\n(no perfect take in 5 tries; last take kept for manual review)');
