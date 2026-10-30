// Judge a stereo take (L=agent, R=caller): how long does the agent speak before the first barge-in,
// and how many times is the agent cut off? Prints a verdict.
import { execSync } from 'node:child_process';
const wav = process.argv[2];
const regions = (ch) => {
  const out = execSync(`ffmpeg -loglevel info -i "${wav}" -af "pan=mono|c0=c${ch},silencedetect=noise=-38dB:d=0.25" -f null - 2>&1 | grep -iE "silence_(start|end)"`, { encoding: 'utf8', shell: '/bin/bash' });
  const ev = [...out.matchAll(/silence_(start|end): ([0-9.]+)/g)].map((m) => ({ k: m[1], t: +m[2] }));
  // speech = between a silence_end and the next silence_start
  const speech = []; let on = null;
  for (const e of ev) { if (e.k === 'end') on = e.t; else if (on != null) { speech.push([on, e.t]); on = null; } }
  if (on != null) speech.push([on, 999]);
  return speech;
};
const agent = regions(0), caller = regions(1);
const firstAgent = agent[0]?.[0] ?? null;
// first caller barge = first caller speech that starts AFTER the agent has started speaking
const firstAgentStart = agent.find((s) => s[0] > 0.3)?.[0] ?? 0;
const barge = caller.find((c) => c[0] > firstAgentStart + 0.3);
const agentSpokeBeforeBarge = barge ? +(barge[0] - firstAgentStart).toFixed(2) : null;
// count agent utterances that are cut short (<1.2s) by a caller onset within 0.5s of the agent stopping
let cuts = 0;
for (const [s, e] of agent) { if (caller.some((c) => Math.abs(c[0] - e) < 0.6) && (e - s) < 2.5) cuts++; }
console.log(`agent first speaks at: ${firstAgentStart.toFixed(2)}s`);
console.log(`first barge-in at: ${barge ? barge[0].toFixed(2) : 'none'}s`);
console.log(`=> agent spoke ${agentSpokeBeforeBarge ?? 'N/A'}s before the barge-in`);
console.log(`agent utterances cut short: ~${cuts}`);
const good = agentSpokeBeforeBarge >= 2.2 && agentSpokeBeforeBarge <= 4.5 && cuts <= 1;
console.log(good ? 'VERDICT: GOOD — agent clearly speaks, one clean barge-in' : 'VERDICT: RETRY — ' + (agentSpokeBeforeBarge < 2.2 ? 'agent cut too early' : cuts > 1 ? 'too many cut-offs' : 'barge too late'));
