const nominalHz = 60;
const tau = 2 * Math.PI;
const stepSeconds = 0.002;
const contactDelay = 0.25;
const limits = Object.freeze({ volts: 0.035, degrees: 7, hz: 0.15 });

export const scenarios = {
  blackstart: {
    label: "Black start and load step", duration: 9, phase: 105, ratings: [0.65, 0.35],
    load: [0.25, 0.08], joinAt: 2.25,
    events: [{ at: 5, load: [0.68, 0.21], label: "Load step" }],
  },
  recovery: {
    label: "Trip and resynchronize", duration: 12, phase: -140, ratings: [0.65, 0.35],
    load: [0.32, 0.12], joinAt: 2.25,
    events: [
      { at: 5, load: [0.54, 0.18], label: "Load step" },
      { at: 7, trip: true, label: "Inverter B trips" },
      { at: 8.5, restart: true, label: "B resync enabled" },
    ],
  },
  reactive: {
    label: "Reactive load rejection", duration: 10, phase: 150, ratings: [0.7, 0.3],
    lineFactors: [1, 1.45],
    load: [0.32, 0.18], joinAt: 2.5,
    events: [
      { at: 5.5, load: [0.55, 0.31], label: "Inductive load added" },
      { at: 8, load: [0.3, 0.06], label: "Load rejected" },
    ],
  },
};

const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const wrap = (radians) => Math.atan2(Math.sin(radians), Math.cos(radians));
const follow = (value, target, seconds) =>
  value + (target - value) * -Math.expm1(-stepSeconds / seconds);

function inverter(rating, angle, lineFactor) {
  return {
    rating, x: 0.085 * lineFactor / rating, angle, voltage: 0, hz: nominalHz,
    p: 0, q: 0, filteredP: 0, filteredQ: 0, current: 0, connected: false,
  };
}

// Nodal balance at the common bus. Each source feeds through jX.
// Load is a constant admittance whose power rating is specified at 1 pu.
function solveBus(inverters, [loadP, loadQ]) {
  let real = 0;
  let imag = 0;
  let susceptance = -loadQ;
  for (const unit of inverters) {
    if (!unit.connected) continue;
    real += unit.voltage * Math.sin(unit.angle) / unit.x;
    imag -= unit.voltage * Math.cos(unit.angle) / unit.x;
    susceptance -= 1 / unit.x;
  }
  const denominator = loadP ** 2 + susceptance ** 2;
  const vr = (real * loadP + imag * susceptance) / denominator;
  const vi = (imag * loadP - real * susceptance) / denominator;
  for (const unit of inverters) {
    const ir = unit.connected ? (unit.voltage * Math.sin(unit.angle) - vi) / unit.x : 0;
    const ii = unit.connected ? (vr - unit.voltage * Math.cos(unit.angle)) / unit.x : 0;
    unit.p = vr * ir + vi * ii;
    unit.q = vi * ir - vr * ii;
    unit.current = Math.hypot(ir, ii);
  }
  return { voltage: Math.hypot(vr, vi), angle: Math.atan2(vi, vr) };
}

export function simulate(scenario = scenarios.blackstart, { interlock = true } = {}) {
  const [lineA, lineB] = scenario.lineFactors ?? [1, 1];
  const a = inverter(scenario.ratings[0], 0, lineA);
  const b = inverter(scenario.ratings[1], scenario.phase * tau / 360, lineB);
  const units = [a, b];
  a.connected = true;
  let load = scenario.load;
  let armed = false;
  let firstSyncEnabled = false;
  let qualifiedAt = null;
  let eventIndex = 0;
  let previousAngle = 0;
  let busHz = nominalHz;
  let peakCloseCurrent = 0;
  let peakNodalResidual = 0;
  const events = [{ at: 0, label: "A energizes bus" }];
  const closures = [];
  const samples = [];

  for (let index = 0; index <= Math.round(scenario.duration / stepSeconds); index++) {
    const t = index * stepSeconds;
    while (scenario.events[eventIndex]?.at <= t + 1e-9) {
      const event = scenario.events[eventIndex++];
      events.push({ at: t, label: event.label });
      if (event.load) load = event.load;
      if (event.trip) {
        b.connected = false;
        armed = false;
        qualifiedAt = null;
        b.angle = wrap(a.angle + 100 * tau / 360);
      }
      if (event.restart) armed = true;
    }
    if (!firstSyncEnabled && t >= scenario.joinAt) {
      armed = true;
      firstSyncEnabled = true;
      events.push({ at: t, label: "B sync enabled" });
    }

    let bus = solveBus(units, load);
    const measuredHz = nominalHz + wrap(bus.angle - previousAngle) / (tau * stepSeconds);
    previousAngle = bus.angle;
    busHz = follow(busHz, clamp(measuredHz, 55, 65), 0.07);
    const phaseError = wrap(bus.angle - b.angle);
    const delta = {
      degrees: Math.abs(phaseError * 360 / tau),
      volts: Math.abs(bus.voltage - b.voltage),
      hz: Math.abs(busHz - b.hz),
    };
    const qualified = armed && !b.connected && bus.voltage >= 0.88 &&
      delta.volts <= limits.volts && delta.degrees <= limits.degrees && delta.hz <= limits.hz;
    qualifiedAt = qualified ? qualifiedAt ?? t : null;
    const held = qualifiedAt !== null && t - qualifiedAt + 1e-9 >= contactDelay;
    if (armed && !b.connected && (!interlock || held)) {
      b.connected = true;
      bus = solveBus(units, load);
      const current = b.current / b.rating;
      peakCloseCurrent = Math.max(peakCloseCurrent, current);
      closures.push({ at: t, ...delta, current });
      events.push({ at: t, label: "B breaker closed" });
    }

    const residual = Math.hypot(a.p + b.p - load[0] * bus.voltage ** 2,
      a.q + b.q - load[1] * bus.voltage ** 2);
    peakNodalResidual = Math.max(peakNodalResidual, residual);
    if (index % 5 === 0) {
      samples.push({
        t, voltage: bus.voltage, hz: a.hz, aP: a.p, bP: b.p, aQ: a.q, bQ: b.q,
        aCurrent: a.current / a.rating, bCurrent: b.current / b.rating,
        bOnline: b.connected, syncDegrees: delta.degrees,
      });
    }

    for (const unit of units) {
      unit.filteredP = follow(unit.filteredP, unit.p, 0.012);
      unit.filteredQ = follow(unit.filteredQ, unit.q, 0.035);
      if (unit.connected) {
        const softStart = unit === a ? Math.min(1, (t + stepSeconds) / 1.45) : 1;
        unit.voltage = follow(unit.voltage,
          softStart * clamp(1 - 0.055 * unit.filteredQ / unit.rating, 0.87, 1.08), 0.055);
        unit.hz = follow(unit.hz, nominalHz - 0.68 * unit.filteredP / unit.rating, 0.018);
      } else {
        unit.voltage = follow(unit.voltage, bus.voltage, 0.065);
        unit.hz = follow(unit.hz,
          armed ? busHz + clamp(phaseError * 1.5, -2, 2) : nominalHz, 0.055);
      }
      unit.angle = wrap(unit.angle + tau * (unit.hz - nominalHz) * stepSeconds);
    }
  }
  const tail = samples.filter((point) => point.t >= scenario.duration - 0.4);
  const loadEvent = scenario.events.find((event) => event.load);
  const afterStep = samples.filter((point) => point.t >= loadEvent.at && point.t < loadEvent.at + 1.5);
  const settledHz = afterStep.at(-1).hz;
  const lastOutside = afterStep.findLast((point) => Math.abs(point.hz - settledHz) > 0.02);
  const inService = samples.filter((point) => point.t >= scenario.joinAt);
  const bothOnline = tail.every((point) => point.bOnline);
  const metrics = {
    energizedAt: samples.find((point) => point.voltage >= 0.9)?.t ?? null,
    nadirHz: Math.min(...afterStep.map((point) => point.hz)),
    settledHz,
    settleSeconds: lastOutside ? lastOutside.t - loadEvent.at + 0.01 : 0,
    minimumVoltage: Math.min(...inService.map((point) => point.voltage)),
    sharingError: bothOnline
      ? Math.max(...tail.map((point) =>
        Math.abs(point.aP / a.rating - point.bP / b.rating))) : null,
    reactiveSharingError: bothOnline
      ? Math.max(...tail.map((point) =>
        Math.abs(point.aQ / a.rating - point.bQ / b.rating))) : null,
    peakCloseCurrent: closures.length ? peakCloseCurrent : null,
    peakNodalResidual,
  };
  return { samples, events, closures, metrics, limits };
}
