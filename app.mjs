import { scenarios, simulate } from "./model.mjs";

const $ = (id) => document.getElementById(id);
const scenarioInput = $("scenario");
const timeInput = $("time");
const baselineInput = $("baseline");
const mint = "#75ecc5";
const amber = "#f9bd79";
const blue = "#a6c8ff";
const plots = [
  { title: "Frequency · Hz", traces: [["A frequency", "hz", mint]], bounds: [59, 60.1] },
  { title: "Bus voltage · pu", traces: [["AC bus", "voltage", blue]], bounds: [0, 1.05] },
  { title: "Active power · pu of system rating", traces: [["Inverter A", "aP", mint], ["Inverter B", "bP", blue]] },
  { title: "Reactive power · pu of system rating", traces: [["Inverter A", "aQ", mint], ["Inverter B", "bQ", blue]] },
  { title: "B current · pu of inverter rating", traces: [["Synchronized", "bCurrent", mint]] },
];

let run;
let forced;
let exportUrl;

for (const [value, scenario] of Object.entries(scenarios)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = scenario.label;
  scenarioInput.append(option);
}

for (const plot of plots) {
  const panel = document.createElement("div");
  panel.className = "plot";
  const title = document.createElement("h3");
  title.textContent = plot.title;
  const legend = document.createElement("p");
  legend.className = "legend";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", plot.title + " waveform");
  panel.append(title, legend, canvas);
  $("plots").append(panel);
  plot.canvas = canvas;
  plot.legend = legend;
  canvas.addEventListener("pointerdown", (event) => {
    const chartX = event.clientX - canvas.getBoundingClientRect().left - 48;
    const chartWidth = canvas.clientWidth - 60;
    inspect(Math.max(0, Math.min(1, chartX / chartWidth)) * Number(timeInput.max));
  });
}

function draw(plot, cursor) {
  const { canvas } = plot;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 60) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const left = 48, right = width - 12, top = 10, bottom = height - 21;
  const duration = Number(timeInput.max);
  const traces = plot.traces.map(([label, key, color]) => ({ label, key, color, data: run.samples }));
  if (forced && plot === plots.at(-1)) {
    traces.push({ label: "Forced close", key: "bCurrent", color: amber, data: forced.samples, marks: forced.closures });
  }
  let [min, max] = plot.bounds ?? [0, 0.05];
  for (const { key, data, marks } of traces) {
    for (const point of data) {
      min = Math.min(min, point[key]);
      max = Math.max(max, point[key]);
    }
    for (const mark of marks ?? []) max = Math.max(max, mark.current);
  }
  const x = (seconds) => left + seconds / duration * (right - left);
  const y = (value) => bottom - (value - min) / (max - min) * (bottom - top);
  ctx.font = "10px Consolas, monospace";
  for (let i = 0; i <= 4; i++) {
    const value = min + i / 4 * (max - min);
    ctx.strokeStyle = "#293e49";
    ctx.beginPath();
    ctx.moveTo(left, y(value));
    ctx.lineTo(right, y(value));
    ctx.stroke();
    ctx.fillStyle = "#a2b7bf";
    ctx.textAlign = "right";
    ctx.fillText(value.toFixed(2), left - 7, y(value) + 3);
  }
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++) {
    const t = duration * i / 4;
    ctx.fillText(t.toFixed(1) + "s", x(t), height - 5);
  }
  for (const event of run.events.slice(1)) {
    ctx.strokeStyle = "#41606e";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x(event.at), top);
    ctx.lineTo(x(event.at), bottom);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const { key, data, color, marks } of traces) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [index, point] of data.entries()) {
      if (index === 0) ctx.moveTo(x(point.t), y(point[key]));
      else ctx.lineTo(x(point.t), y(point[key]));
    }
    ctx.stroke();
    for (const mark of marks ?? []) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x(mark.at), y(mark.current), 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#deedf1";
  ctx.beginPath();
  ctx.moveTo(x(cursor), top);
  ctx.lineTo(x(cursor), bottom);
  ctx.stroke();
}

function inspect(seconds) {
  const point = run.samples[Math.min(run.samples.length - 1, Math.round(seconds * 100))];
  timeInput.value = point.t;
  $("time-label").textContent = point.t.toFixed(2) + " s";
  $("breaker").classList.toggle("offline", !point.bOnline);
  $("node-b").classList.toggle("offline", !point.bOnline);
  $("state").textContent = `${point.voltage.toFixed(3)} pu · ${point.hz.toFixed(3)} Hz · B ${point.bOnline ? "online" : "open"}`;
  for (const plot of plots) draw(plot, point.t);
}

function render() {
  const scenario = scenarios[scenarioInput.value];
  run = simulate(scenario);
  forced = baselineInput.checked ? simulate(scenario, { interlock: false }) : undefined;
  timeInput.max = scenario.duration;
  const { metrics } = run;
  $("metrics").innerHTML = [
    ["Time to 0.90 pu", metrics.energizedAt?.toFixed(2) + " s"],
    ["First load-step nadir", metrics.nadirHz.toFixed(3) + " Hz"],
    ["P sharing error", (100 * metrics.sharingError).toFixed(2) + " pp"],
    ["Q sharing error", (100 * metrics.reactiveSharingError).toFixed(2) + " pp"],
  ].map(([label, value]) => `<div class="metric"><p>${label}</p><strong>${value}</strong></div>`).join("");
  $("events").replaceChildren(...run.events.map(({ at, label }) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const time = document.createElement("time");
    time.textContent = at.toFixed(2) + " s";
    button.append(time, label);
    button.addEventListener("click", () => inspect(Math.ceil(at * 100 - 1e-9) / 100));
    item.append(button);
    return item;
  }));
  const renderClose = (close, kind) => `<div class="closure ${kind === "Forced" ? "baseline" : ""}">
    <strong>${kind} · ${close.at.toFixed(3)} s</strong>
    ${close.degrees.toFixed(2)}° · ${close.hz.toFixed(3)} Hz · ${close.volts.toFixed(3)} pu ΔV<br>
    ${close.current.toFixed(3)} pu B current at close
  </div>`;
  $("closures").innerHTML = run.closures.map((close) => renderClose(close, "Synchronized")).join("") +
    (forced?.closures.map((close) => renderClose(close, "Forced")).join("") ?? "");
  for (const plot of plots) {
    const entries = [...plot.traces];
    if (forced && plot === plots.at(-1)) entries.push(["Forced close", "bCurrent", amber]);
    plot.legend.innerHTML = entries.map(([name, , color]) => `<span style="color:${color}">${name}</span>`).join("");
  }
  const keys = Object.keys(run.samples[0]);
  const csv = [keys.join(","), ...run.samples.map((point) => keys.map((key) => point[key]).join(","))];
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(new Blob([csv.join("\n") + "\n"], { type: "text/csv" }));
  $("export").href = exportUrl;
  $("export").download = `microgrid-${scenarioInput.value}.csv`;
  inspect(Math.min(Number(timeInput.value), scenario.duration));
}

scenarioInput.addEventListener("change", render);
baselineInput.addEventListener("change", render);
timeInput.addEventListener("input", () => inspect(Number(timeInput.value)));
window.addEventListener("resize", () => inspect(Number(timeInput.value)));
render();
