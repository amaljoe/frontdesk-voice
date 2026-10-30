// The demo's narration, segment by segment. Each line is synthesized with AssemblyAI TTS (voice `reid`)
// so the video's own voiceover is built from the product it's demoing.
// Durations are the real audio length (filled in after synthesis) so the video can be cut to the voice.
export const NARRATION = [
  { id: 'intro',    text: "This is Frontdesk. A phone receptionist you can talk over, built entirely on AssemblyAI." },
  { id: 'pipeline', text: "Engine one is a pipeline we wired ourselves: streaming speech to text, the LLM gateway, and streaming text to speech. Watch the caller cut in — it stops instantly, and still books the appointment." },
  { id: 'va',       text: "Engine two is the AssemblyAI Voice Agent API. One socket, real tool calls. The booking you see is a genuine function call, not a guess." },
  { id: 'security', text: "Then, building on the real APIs, we found something. AssemblyAI's own quickstart ships a browser token it calls single-use. It isn't." },
  { id: 'security2',text: "One token opened five sessions at once, stayed valid for ten minutes, and worked across every product. We reproduced it on production and reported it responsibly." },
  { id: 'outro',    text: "A real product, a real vulnerability, built with AssemblyAI's own tools. Frontdesk." },
];
