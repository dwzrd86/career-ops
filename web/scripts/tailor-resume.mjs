import { spawn } from "node:child_process";
import { ResumeGenerationError, providerFailure } from "./resume-generation-errors.mjs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseResumeDraft, tailoringBrief } from "../src/resumeTailoring.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const help = `Generate a reviewable resume draft with OpenCode's Z.AI Coding Plan provider.
Requires Node 22.18+ and OpenCode authenticated with Z.AI Coding Plan.

node web/scripts/tailor-resume.mjs --brief path/to/glm-brief.txt --out output/resume.txt --model zai-coding-plan/<model-id> --send-to-glm

--send-to-glm explicitly sends the brief's resume and posting to the provider.
Without it, validates inputs only. Never overwrites an existing output.
Import the resulting .txt in Resume Studio and review facts before export.
OpenCode retains its own local session history; account deletion does not remove it.`;

export function canonicalBrief(text) {
  const marker = "\nEVIDENCE JSON\n";
  const index = text.indexOf(marker);
  if (index < 0) throw new Error("Choose a GLM brief downloaded from Resume Studio.");
  let data;
  try { data = JSON.parse(text.slice(index + marker.length)); }
  catch { throw new Error("The brief evidence is not valid JSON."); }
  if (!data || typeof data !== "object" || !data.targetRole ||
      ![data.targetRole.company, data.targetRole.title, data.sourceResume, data.jobDescription]
        .every(value => typeof value === "string" && value.trim() && value.length <= 40000)) {
    throw new Error("The brief needs a target role, source resume, and posting within the text limits.");
  }
  // Rebuild trusted instructions rather than executing arbitrary text from a file.
  return tailoringBrief({ company: data.targetRole.company, title: data.targetRole.title },
    parseResumeDraft(data.sourceResume), parseResumeDraft(data.jobDescription));
}

export function draftFromEvents(stdout) {
  const texts = [];
  let completed = false;
  for (const line of stdout.split(/\r?\n/).filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error("OpenCode returned an invalid event stream; no draft saved."); }
    if (event.type === "error") throw providerFailure(event.error);
    if (event.type === "tool_use") throw new Error("The agent attempted a tool action; no draft saved.");
    if (event.type === "text" && typeof event.part?.text === "string") texts.push(event.part.text);
    if (event.type === "step_finish" && event.part?.reason === "stop") completed = true;
  }
  if (!completed) throw new ResumeGenerationError("incomplete");
  const draft = parseResumeDraft(texts.join("\n"));
  if (/```/.test(draft)) throw new Error("The agent returned Markdown fences instead of a plain text resume; no draft saved.");
  return draft;
}

export function sessionFromEvents(stdout) {
  const ids = new Set(stdout.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line).sessionID));
  if (ids.size !== 1 || !/^ses_[a-zA-Z0-9]+$/.test([...ids][0] ?? "")) {
    throw new ResumeGenerationError("incomplete");
  }
  return [...ids][0];
}

export function draftFromSession(session, { sessionID, model, workspace }) {
  const invalid = () => { throw new ResumeGenerationError("incomplete"); };
  if (session?.info?.id !== sessionID || session.info.directory !== workspace ||
      !Array.isArray(session.messages) || session.messages.length !== 2) invalid();
  const [user, assistant] = session.messages;
  const info = assistant?.info;
  if (user?.info?.role !== "user" || info?.role !== "assistant" || info.sessionID !== sessionID ||
      info.agent !== "resume-tailor" || `${info.providerID}/${info.modelID}` !== model) invalid();
  if (info.error) throw providerFailure(info.error);
  if (info.finish !== "stop" || !Number.isFinite(info.time?.completed) || !Array.isArray(assistant.parts)) invalid();
  if (assistant.parts.some(part => part.sessionID !== sessionID || part.messageID !== info.id)) invalid();
  if (assistant.parts.some(part => part.type === "tool")) {
    throw new Error("The agent attempted a tool action; no draft saved.");
  }
  // Reuse the same strict validation as the event stream. An export is not a retry.
  return draftFromEvents(assistant.parts.map(part => JSON.stringify({
    type: part.type === "step-finish" ? "step_finish" : part.type, part,
  })).join("\n"));
}

// OpenCode may exit before a pipe drains. Capture both run and export output
// in a private regular file so completed events survive CLI teardown.
async function captureOpenCode({ executable, args, workspace, env, timeoutMs, filename }) {
  const file = join(workspace, filename);
  const handle = await open(file, "wx", 0o600);
  try {
    await new Promise((accept, reject) => {
      const child = spawn(executable, args,
        { cwd: workspace, env, stdio: ["ignore", handle.fd, "ignore"] });
      let failure;
      const timer = setTimeout(() => { failure = new ResumeGenerationError("timeout"); child.kill("SIGKILL"); }, timeoutMs);
      const limit = setInterval(async () => {
        try {
          if ((await handle.stat()).size > 1000000) {
            failure = new Error("OpenCode exceeded the output limit; no draft saved."); child.kill("SIGKILL");
          }
        } catch { /* close handler owns cleanup */ }
      }, 50);
      child.on("error", () => { clearTimeout(timer); clearInterval(limit); reject(new ResumeGenerationError("unavailable")); });
      child.on("close", code => {
        clearTimeout(timer); clearInterval(limit);
        if (failure || code !== 0) reject(failure || new ResumeGenerationError("failed"));
        else accept();
      });
    });
    if ((await handle.stat()).size > 1000000) throw new Error("OpenCode exceeded the output limit; no draft saved.");
    return await readFile(file, "utf8");
  } finally { await handle.close(); }
}

async function recoverDraft({ events, executable, workspace, model, env, timeoutMs }) {
  const sessionID = sessionFromEvents(events);
  const content = await captureOpenCode({ executable, args: ["export", sessionID, "--pure"],
    workspace, env, timeoutMs, filename: "session.json" });
  let session;
  try { session = JSON.parse(content); }
  catch { throw new ResumeGenerationError("incomplete"); }
  return draftFromSession(session, { sessionID, model, workspace });
}

export async function runTailoring({ brief, out, model, send = false }, {
  executable = "opencode", timeoutMs = 180000, env = process.env,
} = {}) {
  if (!/^zai-coding-plan\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model ?? "")) {
    throw new Error("Select an explicit zai-coding-plan/<model-id>. Other providers and paid API fallback are disabled.");
  }
  const output = resolve(root, out);
  if (!output.startsWith(root) || !output.endsWith(".txt")) throw new Error("Output must be a .txt file inside career-ops.");
  const parent = await realpath(dirname(output));
  if (parent !== root.slice(0, -1) && !parent.startsWith(root)) throw new Error("Output parent must remain inside career-ops.");
  if ((await stat(resolve(brief))).size > 400000) throw new Error("Brief files must be smaller than 400 KB.");
  const content = await readFile(resolve(brief));
  if (content.length > 400000) throw new Error("Brief files must be smaller than 400 KB.");
  const prompt = canonicalBrief(new TextDecoder("utf-8", { fatal: true }).decode(content));
  try { await access(output); throw new Error("Output already exists. Choose a new filename."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!send) return "Inputs validated. No AI call made. Add --send-to-glm to generate the draft.";

  const local = join(root, "agent/.local/resume-runs");
  await mkdir(local, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(local, "run-"));
  try {
    const attachment = join(workspace, "brief.txt");
    await writeFile(attachment, prompt, { mode: 0o600 });
    const config = {
      enabled_providers: ["zai-coding-plan"], share: "disabled", snapshot: false,
      autoupdate: false, permission: { "*": "deny" },
      agent: { "resume-tailor": { description: "Factual resume drafting without tools", mode: "primary",
        model, permission: { "*": "deny" },
        prompt: "Follow the factual tailoring rules in the attached brief. Return only the resume. Never use tools." } },
    };
    const childEnv = { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_PERMISSION: JSON.stringify({ "*": "deny" }), OPENCODE_AUTO_SHARE: "false",
      OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true" };
    const started = Date.now();
    const events = await captureOpenCode({ executable,
      args: ["run", "--pure", "--dir", workspace, "--format", "json", "--model", model,
        "--agent", "resume-tailor", "--file", attachment, "--", "Tailor the attached factual resume brief."],
      workspace, env: childEnv, timeoutMs, filename: "events.jsonl" });
    let draft;
    try { draft = draftFromEvents(events); }
    catch (error) {
      if (!(error instanceof ResumeGenerationError) || error.code !== "incomplete") throw error;
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new ResumeGenerationError("timeout");
      draft = await recoverDraft({ events, executable, workspace, model, env: childEnv, timeoutMs: remaining });
    }
    await writeFile(output, draft + "\n", { flag: "wx", mode: 0o600 });
    return "Draft saved. Import it in Resume Studio, compare against source evidence, and review before exporting.";
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { brief: { type: "string" }, out: { type: "string" },
      model: { type: "string" }, "send-to-glm": { type: "boolean" }, help: { type: "boolean" } } });
    if (values.help) console.log(help);
    else {
      if (!values.brief || !values.out) throw new Error("--brief and --out are required. Use --help for instructions.");
      console.log(await runTailoring({ brief: values.brief, out: values.out, model: values.model, send: values["send-to-glm"] }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
