import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(__dirname, "../../..");
const plugin = join(repo, "plugins/annotatie");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function frontmatter(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return Object.fromEntries(
    (m[1] ?? "").split(/\r?\n/).filter((l) => /^[\w-]+:/.test(l)).map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
  );
}

function runHook(script: string, input: object, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(plugin, "hooks", script)], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ANNOTATIE_LOCAL_QUESTIONS: "", CLAUDE_PROJECT_DIR: "", ...env },
  });
  expect(r.status).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const ask = { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [] } };

describe("marketplace and manifest", () => {
  it("lists the plugin by the same name as its manifest", () => {
    const m = json(join(repo, ".claude-plugin/marketplace.json"));
    const p = json(join(plugin, ".claude-plugin/plugin.json"));
    expect(m.plugins).toHaveLength(1);
    expect(m.plugins[0].name).toBe(p.name);
    expect(m.plugins[0].source).toBe("./plugins/annotatie");
    expect(m.plugins[0].version).toBeUndefined(); // version lives in plugin.json only
  });

  it("connects to the Annotatie MCP server over HTTPS", () => {
    const s = json(join(plugin, ".mcp.json")).mcpServers.annotatie;
    expect(s.type).toBe("http");
    expect(s.url).toBe("https://annotatie.consulteasy.co.uk/mcp");
    expect(JSON.stringify(s)).not.toMatch(/token|secret|authorization/i);
  });

  it("wires both hooks to scripts that exist", () => {
    const h = json(join(plugin, "hooks/hooks.json")).hooks;
    expect(h.PreToolUse[0].matcher).toBe("AskUserQuestion");
    for (const ev of [h.SessionStart[0], h.PreToolUse[0]]) {
      const script = ev.hooks[0].args[0].replace("${CLAUDE_PLUGIN_ROOT}", plugin);
      expect(existsSync(script)).toBe(true);
    }
  });
});

describe("skills and commands", () => {
  const skills = readdirSync(join(plugin, "skills"));
  const commands = readdirSync(join(plugin, "commands")).map((f) => f.replace(/\.md$/, ""));

  it("has the six skills, each named after its folder with a description", () => {
    expect(skills.sort()).toEqual(["ask-the-reviewer", "chat-liaison", "install-sdk", "report-responder", "triage-reports", "using-annotatie"]);
    for (const s of skills) {
      const fm = frontmatter(join(plugin, "skills", s, "SKILL.md"));
      expect(fm.name).toBe(s);
      expect((fm.description ?? "").length).toBeGreaterThan(80);
      expect((fm.description ?? "").length).toBeLessThan(1536);
    }
  });

  it("has the install, liaison, respond and status commands, and no skill shares a command's name", () => {
    expect(commands.sort()).toEqual(["install", "liaison", "respond", "status"]);
    for (const c of commands) expect(frontmatter(join(plugin, "commands", `${c}.md`)).description).toBeTruthy();
    for (const c of commands) expect(skills).not.toContain(c);
  });

  it("refers only to skills that exist", () => {
    const all = [...skills.map((s) => join(plugin, "skills", s, "SKILL.md")), ...commands.map((c) => join(plugin, "commands", `${c}.md`)), join(plugin, "hooks/lib.mjs")];
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(/annotatie:([a-z-]+)/g)) {
        expect([...skills, ...commands], `${f} names annotatie:${m[1]}`).toContain(m[1]);
      }
    }
  });
});

describe("question gate", () => {
  it("refuses AskUserQuestion and points to ask_reviewer", () => {
    const out = runHook("ask-gate.mjs", ask);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/ask_reviewer/);
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/\/mcp/);
  });

  it("allows it when ANNOTATIE_LOCAL_QUESTIONS is on", () => {
    expect(runHook("ask-gate.mjs", ask, { ANNOTATIE_LOCAL_QUESTIONS: "1" })).toBeNull();
  });

  it("allows it when the project has .annotatie/local-questions", () => {
    const dir = mkdtempSync(join(tmpdir(), "annotatie-"));
    mkdirSync(join(dir, ".annotatie"));
    writeFileSync(join(dir, ".annotatie/local-questions"), "");
    expect(runHook("ask-gate.mjs", { ...ask, cwd: dir })).toBeNull();
    expect(runHook("ask-gate.mjs", ask, { CLAUDE_PROJECT_DIR: dir })).toBeNull();
  });

  it("leaves other tools alone and survives empty input", () => {
    expect(runHook("ask-gate.mjs", { tool_name: "Bash" })).toBeNull();
    expect(runHook("ask-gate.mjs", {}).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

describe("session start", () => {
  it("puts the mandatory question rule into context", () => {
    const ctx = runHook("session-start.mjs", { hook_event_name: "SessionStart" }).hookSpecificOutput;
    expect(ctx.hookEventName).toBe("SessionStart");
    expect(ctx.additionalContext).toMatch(/AskUserQuestion/);
    expect(ctx.additionalContext).toMatch(/ask_reviewer/);
    expect(ctx.additionalContext).toMatch(/Never poll/);
    expect(ctx.additionalContext.length).toBeLessThan(10_000);
  });

  it("says the gate is off when the opt-out is set", () => {
    const ctx = runHook("session-start.mjs", {}, { ANNOTATIE_LOCAL_QUESTIONS: "yes" }).hookSpecificOutput;
    expect(ctx.additionalContext).toMatch(/gate is OFF/);
  });
});
