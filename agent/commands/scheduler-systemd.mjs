#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTargetProfile } from "../store/target-profile.mjs";
import { loadRunQueue } from "../store/run-queue.mjs";
import { SYSTEMD_UNIT_NAMES, buildSystemdUnits, calendarForSchedule } from "../scheduler/systemd.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.log(`Usage: npm run scheduler:systemd -- <install|status|uninstall> [options]

install options:
  --collector-adapter <module>  Required local module exporting { collectors }
  --on-calendar <calendar>     Override the profile's daily/weekday calendar
  --node <path>                Explicit Node executable (default: current Node)
  --working-directory <path>   Project directory (default: this project)
  --profile <path>             Target Profile (default: config/target-profile.yml)
  --data-root <path>           Local scheduler state (default: data/autodiscovery)
  --user-unit-dir <path>       User unit directory (advanced/testing)

status and uninstall accept --working-directory, --data-root, and --user-unit-dir.
This command invokes only systemctl --user; it never uses sudo or stores secrets.`);
}

function option(args, flag) { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1] ?? null; }
function optionPath(args, flag, fallback, workingDirectory) { return resolve(workingDirectory, option(args, flag) || fallback); }

function userUnitDirectory(args) {
  const override = option(args, "--user-unit-dir");
  if (override) return resolve(override);
  const configHome = process.env.XDG_CONFIG_HOME || (process.env.HOME ? join(process.env.HOME, ".config") : null);
  if (!configHome) throw new Error("Cannot determine the user systemd directory; set XDG_CONFIG_HOME or --user-unit-dir.");
  return resolve(configHome, "systemd/user");
}

function systemctl(args, { allowFailure = false } = {}) {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`Unable to run systemctl --user: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error((result.stderr || result.stdout || `systemctl exited ${result.status}`).trim());
  return { ok: result.status === 0, output: (result.stdout || "").trim(), error: (result.stderr || "").trim() };
}

function writeUnit(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function installationConfig(args) {
  const workingDirectory = resolve(option(args, "--working-directory") || projectRoot);
  const profilePath = optionPath(args, "--profile", "config/target-profile.yml", workingDirectory);
  const profile = loadTargetProfile(profilePath);
  if (!profile || profile.profileVersion < 1) throw new Error("A saved, valid Target Profile is required before installing the scheduler.");
  if (!profile.discovery.enabled) throw new Error("Discovery is disabled in the Target Profile; enable it before installing a timer.");
  const collectorAdapter = option(args, "--collector-adapter");
  if (!collectorAdapter) throw new Error("--collector-adapter is required; scheduled collection must use an explicit local adapter.");
  const adapterPath = resolve(workingDirectory, collectorAdapter);
  if (!existsSync(adapterPath)) throw new Error("The collector adapter module does not exist.");
  return {
    workingDirectory,
    nodePath: resolve(option(args, "--node") || process.execPath),
    profilePath,
    dataRoot: optionPath(args, "--data-root", "data/autodiscovery", workingDirectory),
    collectorAdapter: adapterPath,
    onCalendar: option(args, "--on-calendar") || calendarForSchedule(profile.discovery.schedule),
  };
}

export function install(args) {
  const units = buildSystemdUnits(installationConfig(args));
  const directory = userUnitDirectory(args);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(units.config.dataRoot, { recursive: true, mode: 0o700 });
  writeUnit(join(directory, SYSTEMD_UNIT_NAMES.service), units.service);
  writeUnit(join(directory, SYSTEMD_UNIT_NAMES.timer), units.timer);
  systemctl(["daemon-reload"]);
  systemctl(["enable", "--now", SYSTEMD_UNIT_NAMES.timer]);
  return { action: "installed", unitDirectory: directory, timer: SYSTEMD_UNIT_NAMES.timer, dataRoot: units.config.dataRoot };
}

export function status(args) {
  const workingDirectory = resolve(option(args, "--working-directory") || projectRoot);
  const dataRoot = optionPath(args, "--data-root", "data/autodiscovery", workingDirectory);
  const unitDirectory = userUnitDirectory(args);
  const unit = (name) => ({ installed: existsSync(join(unitDirectory, name)), enabled: systemctl(["is-enabled", name], { allowFailure: true }).ok, active: systemctl(["is-active", name], { allowFailure: true }).ok });
  const queue = loadRunQueue(dataRoot);
  return { action: "status", unitDirectory, dataRoot, service: unit(SYSTEMD_UNIT_NAMES.service), timer: unit(SYSTEMD_UNIT_NAMES.timer), killSwitch: queue.killSwitch, runCounts: Object.fromEntries(["queued", "running", "succeeded", "partial", "failed", "blocked", "skipped"].map((state) => [state, queue.runs.filter((run) => run.status === state).length])) };
}

export function uninstall(args) {
  const directory = userUnitDirectory(args);
  systemctl(["disable", "--now", SYSTEMD_UNIT_NAMES.timer], { allowFailure: true });
  for (const name of Object.values(SYSTEMD_UNIT_NAMES)) rmSync(join(directory, name), { force: true });
  systemctl(["daemon-reload"]);
  return { action: "uninstalled", unitDirectory: directory, preservedLocalData: true };
}

function main() {
  const args = process.argv.slice(2);
  const action = args[0];
  if (!action || args.includes("--help") || !["install", "status", "uninstall"].includes(action)) { usage(); return; }
  const result = action === "install" ? install(args.slice(1)) : action === "status" ? status(args.slice(1)) : uninstall(args.slice(1));
  console.log(JSON.stringify(result, null, 2));
}

try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
