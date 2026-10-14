import { spawn } from "node:child_process";
import { ResumeGenerationError, providerFailure } from "./resume-generation-errors.mjs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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
      OPENCODE_DISABLE_AUTOUPDATE: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true" };
    const events = await new Promise((accept, reject) => {
      const child = spawn(executable, ["run", "--pure", "--format", "json", "--model", model,
        "--agent", "resume-tailor", "--file", attachment, "--", "Tailor the attached factual resume brief."],
      { cwd: workspace, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", size = 0, failure;
      const timer = setTimeout(() => { failure = new ResumeGenerationError("timeout"); child.kill("SIGKILL"); }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 1000000) { failure = new Error("OpenCode exceeded the output limit; no draft saved."); child.kill("SIGKILL"); }
        else stdout += chunk.toString();
      });
      // Never echo provider errors or logs: they may contain personal evidence or credentials.
      child.stderr.resume();
      child.on("error", () => { clearTimeout(timer); reject(new ResumeGenerationError("unavailable")); });
      child.on("close", code => {
        clearTimeout(timer);
        if (failure || code !== 0) reject(failure || new ResumeGenerationError("failed"));
        else accept(stdout);
      });
    });
    const draft = draftFromEvents(events);
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
