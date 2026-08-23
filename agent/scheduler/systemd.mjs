import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const templateDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "systemd");
const requiredFields = ["workingDirectory", "nodePath", "profilePath", "dataRoot", "collectorAdapter", "onCalendar"];

export const SYSTEMD_UNIT_NAMES = Object.freeze({
  service: "career-ops-scheduler.service",
  timer: "career-ops-scheduler.timer",
});

export function systemdQuote(value) {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) throw new Error("systemd values must be non-empty single-line strings");
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

export function calendarForSchedule(schedule) {
  if (schedule === "daily") return "*-*-* 09:00:00";
  if (schedule === "weekdays") return "Mon..Fri *-*-* 09:00:00";
  throw new Error("A systemd timer requires discovery.schedule to be daily or weekdays.");
}

function insideDirectory(path, directory) {
  const rel = relative(directory, path);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function assertLocalPath(path, field, workingDirectory) {
  const absolute = resolve(path);
  if (!insideDirectory(absolute, workingDirectory)) throw new Error(`${field} must stay within the working directory.`);
  return absolute;
}

export function normalizeSystemdConfig(config) {
  const missing = requiredFields.filter((field) => typeof config?.[field] !== "string" || config[field].trim() === "");
  if (missing.length > 0) throw new Error(`Missing systemd configuration: ${missing.join(", ")}`);
  const workingDirectory = resolve(config.workingDirectory);
  const nodePath = resolve(config.nodePath);
  const profilePath = assertLocalPath(config.profilePath, "profilePath", workingDirectory);
  const dataRoot = assertLocalPath(config.dataRoot, "dataRoot", workingDirectory);
  const collectorAdapter = assertLocalPath(config.collectorAdapter, "collectorAdapter", workingDirectory);
  if (/[\0\r\n]/.test(config.onCalendar)) throw new Error("onCalendar must be a single line.");
  return { workingDirectory, nodePath, profilePath, dataRoot, collectorAdapter, onCalendar: config.onCalendar };
}

function readTemplate(name) {
  return readFileSync(resolve(templateDirectory, name), "utf8");
}

function render(template, values) {
  const output = template.replace(/{{([A-Z_]+)}}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`No value supplied for ${key}`);
    return values[key];
  });
  if (/{{[A-Z_]+}}/.test(output)) throw new Error("Unresolved systemd template value.");
  return output;
}

/** Build user-unit content without reading profile or collector data. */
export function buildSystemdUnits(config) {
  const value = normalizeSystemdConfig(config);
  const execStart = [value.nodePath, resolve(value.workingDirectory, "agent/daemon.mjs"), "--scheduled", "--profile", value.profilePath, "--data-root", value.dataRoot, "--collector-adapter", value.collectorAdapter].map(systemdQuote).join(" ");
  const paths = {
    WORKING_DIRECTORY: systemdQuote(value.workingDirectory),
    PROFILE_PATH: systemdQuote(value.profilePath),
    DATA_ROOT: systemdQuote(value.dataRoot),
    EXEC_START: execStart,
    ON_CALENDAR: value.onCalendar,
  };
  return {
    service: render(readTemplate(SYSTEMD_UNIT_NAMES.service.replace(/\.service$/, ".service.template")), paths),
    timer: render(readTemplate(SYSTEMD_UNIT_NAMES.timer.replace(/\.timer$/, ".timer.template")), paths),
    config: value,
  };
}
