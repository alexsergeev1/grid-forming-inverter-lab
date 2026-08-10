# Grid-Forming Inverter Lab

An islanded AC microgrid simulator with two grid-forming inverters, local droop control, and a synchronization interlock. The dashboard shows how the microgrid responds to black start, load changes, and breaker operation.

## Run

With Node.js 20 or newer, run `node serve.mjs` and open [the local dashboard](http://127.0.0.1:4173/). Select a scenario, click an event to inspect its waveforms, or export the synchronized trace as CSV.

Run `node --test model.test.mjs` to verify the scenario behavior and sweep 48 combinations of initial phase and feeder reactance.

## Scenarios

| Scenario | What to look for |
|---|---|
| Black start and load step | A ramps up from zero voltage. B joins after synchronization, then both pick up a step load. |
| Trip and resynchronize | B opens under load. A holds the bus while B reacquires voltage, phase, and frequency before closing again. |
| Reactive load rejection | Unequal feeder reactance biases reactive power sharing. Removing an inductive load shows how voltage recovers. |

On the default run, bus voltage reaches 0.90 pu in 1.38 s. After the first load step, A reaches a frequency nadir of 59.563 Hz and enters a ±0.02 Hz band around its settled value in 0.06 s. At the first breaker closure, B current is 0.049 pu of its rating with the interlock enabled. Forcing the breaker closed when B is first armed gives 14.346 pu in the same model. These closure values are phasor current magnitudes at the modeled switching instant.

## Model

- Each inverter is an AC voltage source behind an inductive feeder. The plant solves the common-bus phasor from Kirchhoff's current law at a 2 ms step. Loads are constant admittance.
- Active power adjusts frequency and reactive power adjusts source voltage. Each inverter scales its droop by its rating. The sharing metrics compare the two inverters' normalized outputs over the last 400 ms.
- B tracks the live bus while open. The breaker requires voltage mismatch at or below 0.035 pu, phase mismatch at or below 7°, and frequency mismatch at or below 0.15 Hz for 250 ms.

The balanced, averaged model omits PWM, current limiting, DC-link dynamics, and electromagnetic transients. Results are from software simulation. Bench and hardware-in-the-loop validation remain outside this implementation.
