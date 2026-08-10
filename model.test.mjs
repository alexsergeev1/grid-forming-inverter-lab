import assert from "node:assert/strict";
import test from "node:test";
import { scenarios, simulate } from "./model.mjs";

test("black start, synchronization, and proportional active power sharing", () => {
  const { samples, closures, limits, metrics } = simulate();
  assert.equal(samples[0].voltage, 0);
  assert.ok(metrics.energizedAt < 1.6);
  assert.equal(closures.length, 1);
  assert.ok(closures[0].at >= scenarios.blackstart.joinAt + 0.25);
  for (const key of ["degrees", "volts", "hz"]) assert.ok(closures[0][key] <= limits[key]);
  assert.ok(metrics.nadirHz >= 59.5);
  assert.ok(metrics.minimumVoltage >= 0.95);
  assert.ok(metrics.settleSeconds <= 0.2);
  assert.ok(metrics.sharingError < 0.001);
});

test("trip isolates B and resynchronization restores service", () => {
  const { samples, closures } = simulate(scenarios.recovery);
  assert.equal(closures.length, 2);
  const isolated = samples.filter((point) => point.t >= 7 && point.t < 8.5);
  assert.ok(isolated.length > 0);
  assert.ok(isolated.every((point) => !point.bOnline && point.bCurrent === 0 && point.voltage > 0.9));
  assert.ok(closures[1].at > 8.5);
  assert.equal(samples.at(-1).bOnline, true);
});

test("unequal feeder impedance changes reactive sharing", () => {
  const { metrics } = simulate(scenarios.reactive);
  assert.ok(metrics.reactiveSharingError > 0.005);
  assert.ok(metrics.sharingError < 0.001);
});

test("interlock limits close current across 48 disturbance cases", () => {
  for (const scenario of Object.values(scenarios)) {
    for (const phase of [-175, -140, -85, -30, 30, 85, 140, 175]) {
      for (const lineFactors of [[1, 1], [1, 1.45]]) {
        const run = simulate({ ...scenario, phase, lineFactors });
        const expected = scenario === scenarios.recovery ? 2 : 1;
        const name = `${scenario.label}, ${phase}°, ${lineFactors.join("/")}`;
        assert.equal(run.closures.length, expected, name);
        assert.ok(run.metrics.peakCloseCurrent < 0.35, name);
        assert.ok(run.metrics.peakNodalResidual < 1e-10, name);
        assert.ok(run.metrics.sharingError < 0.001, name);
      }
    }
  }
});

test("a forced close can cause high current even when the voltage magnitude matches", () => {
  const controlled = simulate();
  const forced = simulate(scenarios.blackstart, { interlock: false });
  assert.equal(forced.closures[0].at, scenarios.blackstart.joinAt);
  assert.ok(forced.closures[0].volts < forced.limits.volts);
  assert.ok(forced.closures[0].degrees > forced.limits.degrees);
  assert.ok(forced.metrics.peakCloseCurrent > 5);
  assert.ok(controlled.metrics.peakCloseCurrent < 0.1);
});
