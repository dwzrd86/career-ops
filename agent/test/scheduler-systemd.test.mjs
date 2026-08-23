import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemdUnits, calendarForSchedule, systemdQuote } from "../scheduler/systemd.mjs";

const config = {
  workingDirectory: "/srv/career-ops",
  nodePath: "/usr/bin/node",
  profilePath: "/srv/career-ops/config/target-profile.yml",
  dataRoot: "/srv/career-ops/data/autodiscovery",
  collectorAdapter: "/srv/career-ops/agent/collectors/approved-adapter.mjs",
  onCalendar: "Mon..Fri *-*-* 09:00:00",
};

test("systemd templates constrain paths, use the explicit Node executable, and contain no secret values", () => {
  const units = buildSystemdUnits(config);
  assert.match(units.service, /^WorkingDirectory="\/srv\/career-ops"$/m);
  assert.match(units.service, /ExecStart="\/usr\/bin\/node" "\/srv\/career-ops\/agent\/daemon\.mjs" "--scheduled"/);
  assert.match(units.service, /"--data-root" "\/srv\/career-ops\/data\/autodiscovery"/);
  assert.match(units.service, /^ReadWritePaths="\/srv\/career-ops\/data\/autodiscovery"$/m);
  assert.match(units.timer, /^RandomizedDelaySec=5m$/m);
  assert.doesNotMatch(`${units.service}\n${units.timer}`, /(TOKEN|SECRET|PASSWORD|COOKIE|API[_-]?KEY)=/i);
});

test("systemd scheduling rejects external local-data paths and unsafe unit values", () => {
  assert.throws(() => buildSystemdUnits({ ...config, dataRoot: "/tmp/autodiscovery" }), /must stay within/);
  assert.throws(() => buildSystemdUnits({ ...config, onCalendar: "daily\nEnvironment=SECRET=value" }), /single line/);
  assert.equal(calendarForSchedule("daily"), "*-*-* 09:00:00");
  assert.equal(calendarForSchedule("weekdays"), "Mon..Fri *-*-* 09:00:00");
  assert.equal(systemdQuote('/path/with "quotes"'), '"/path/with \\"quotes\\""');
});
