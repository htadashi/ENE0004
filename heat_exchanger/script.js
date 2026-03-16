const SIM_DT = 0.25;
const HISTORY_SECONDS = 120;
const MAX_POINTS = Math.floor(HISTORY_SECONDS / SIM_DT);

const controls = {
  mode: document.getElementById("controller-mode"),
  setpoint: document.getElementById("setpoint"),
  inletTemp: document.getElementById("inlet-temp"),
  flowFactor: document.getElementById("flow-factor"),
  kp: document.getElementById("kp"),
  ki: document.getElementById("ki"),
  tau: document.getElementById("tau"),
  manualValve: document.getElementById("manual-valve"),
  runToggle: document.getElementById("run-toggle"),
  resetButton: document.getElementById("reset-button"),
  disturbanceCold: document.getElementById("disturbance-cold"),
  disturbanceFlow: document.getElementById("disturbance-flow"),
  recoverButton: document.getElementById("recover-button"),
};

const readouts = {
  setpoint: document.getElementById("setpoint-value"),
  inletTemp: document.getElementById("inlet-temp-value"),
  flowFactor: document.getElementById("flow-factor-value"),
  kp: document.getElementById("kp-value"),
  ki: document.getElementById("ki-value"),
  tau: document.getElementById("tau-value"),
  manualValve: document.getElementById("manual-valve-value"),
  outlet: document.getElementById("outlet-value"),
  valve: document.getElementById("valve-value"),
  error: document.getElementById("error-value"),
  flow: document.getElementById("flow-value"),
  status: document.getElementById("status-text"),
};

const temperatureCanvas = document.getElementById("temperature-chart");
const valveCanvas = document.getElementById("valve-chart");
const temperatureCtx = temperatureCanvas.getContext("2d");
const valveCtx = valveCanvas.getContext("2d");

const state = {
  running: true,
  time: 0,
  outletTemp: 85,
  valve: 50,
  integral: 0,
  bias: 50,
  accumulator: 0,
  lastFrame: null,
  history: [],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatValue(key, value) {
  switch (key) {
    case "setpoint":
    case "inletTemp":
      return `${Math.round(value)} C`;
    case "flowFactor":
      return `${Number(value).toFixed(2)} x`;
    case "kp":
      return Number(value).toFixed(1);
    case "ki":
      return Number(value).toFixed(2);
    case "tau":
      return `${Math.round(value)} s`;
    case "manualValve":
      return `${Math.round(value)} %`;
    default:
      return String(value);
  }
}

function currentParams() {
  return {
    setpoint: Number(controls.setpoint.value),
    inletTemp: Number(controls.inletTemp.value),
    flowFactor: Number(controls.flowFactor.value),
    kp: Number(controls.kp.value),
    ki: Number(controls.ki.value),
    tau: Number(controls.tau.value),
    manualValve: Number(controls.manualValve.value),
    mode: controls.mode.value,
  };
}

function syncControlReadouts() {
  readouts.setpoint.textContent = formatValue("setpoint", controls.setpoint.value);
  readouts.inletTemp.textContent = formatValue("inletTemp", controls.inletTemp.value);
  readouts.flowFactor.textContent = formatValue("flowFactor", controls.flowFactor.value);
  readouts.kp.textContent = formatValue("kp", controls.kp.value);
  readouts.ki.textContent = formatValue("ki", controls.ki.value);
  readouts.tau.textContent = formatValue("tau", controls.tau.value);
  readouts.manualValve.textContent = formatValue("manualValve", controls.manualValve.value);
  controls.manualValve.disabled = controls.mode.value !== "manual";
}

function estimateTargetTemp(params, valve) {
  const valveFraction = clamp(valve / 100, 0, 1);
  const maxTemperatureRise = 90 / params.flowFactor;
  return params.inletTemp + maxTemperatureRise * valveFraction;
}

function estimateSteadyStateValve(params, targetTemp) {
  const maxTemperatureRise = 90 / params.flowFactor;
  const requiredRise = targetTemp - params.inletTemp;
  return clamp((requiredRise / maxTemperatureRise) * 100, 0, 100);
}

function pushHistory(params) {
  state.history.push({
    time: state.time,
    setpoint: params.setpoint,
    outletTemp: state.outletTemp,
    valve: state.valve,
  });

  if (state.history.length > MAX_POINTS) {
    state.history.shift();
  }
}

function resetSimulation() {
  const params = currentParams();
  const initialValve =
    params.mode === "manual"
      ? params.manualValve
      : estimateSteadyStateValve(params, params.setpoint);

  state.time = 0;
  state.outletTemp = params.setpoint;
  state.valve = initialValve;
  state.bias = initialValve;
  state.integral = 0;
  state.accumulator = 0;
  state.lastFrame = null;
  state.history = [];
  pushHistory(params);
  render();
}

function updateController(params) {
  if (params.mode === "manual") {
    state.valve = params.manualValve;
    return;
  }

  const error = params.setpoint - state.outletTemp;
  const unsaturated = state.bias + params.kp * error + params.ki * state.integral;
  const saturated = clamp(unsaturated, 0, 100);

  if (
    saturated === unsaturated ||
    (saturated === 100 && error < 0) ||
    (saturated === 0 && error > 0)
  ) {
    state.integral += error * SIM_DT;
  }

  state.valve = saturated;
}

function processStep() {
  const params = currentParams();
  updateController(params);

  const targetTemp = estimateTargetTemp(params, state.valve);
  state.outletTemp += ((targetTemp - state.outletTemp) / params.tau) * SIM_DT;
  state.time += SIM_DT;

  pushHistory(params);
}

function updateReadouts() {
  const params = currentParams();
  const error = params.setpoint - state.outletTemp;

  readouts.outlet.textContent = `${state.outletTemp.toFixed(1)} C`;
  readouts.valve.textContent = `${state.valve.toFixed(1)} %`;
  readouts.error.textContent = `${error.toFixed(1)} C`;
  readouts.flow.textContent = `${params.flowFactor.toFixed(2)} x`;

  if (params.mode === "manual") {
    readouts.status.textContent =
      "O modo manual mantém a válvula fixa, então as perturbações criam um desvio permanente.";
  } else {
    readouts.status.textContent =
      "O modo automático usa realimentação PI para mover a válvula quando a temperatura de saída se afasta da referência.";
  }
}

function drawAxes(context, width, height, yMin, yMax, yLabel) {
  const left = 46;
  const right = width - 12;
  const top = 16;
  const bottom = height - 28;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#d0d0d0";
  context.lineWidth = 1;

  for (let i = 0; i <= 4; i += 1) {
    const y = top + ((bottom - top) * i) / 4;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  }

  for (let i = 0; i <= 4; i += 1) {
    const x = left + ((right - left) * i) / 4;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  context.strokeStyle = "#444";
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.lineTo(right, bottom);
  context.stroke();

  context.fillStyle = "#222";
  context.font = "12px Arial";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const value = yMax - ((yMax - yMin) * i) / 4;
    const y = top + ((bottom - top) * i) / 4;
    context.fillText(value.toFixed(0), left - 6, y);
  }

  context.save();
  context.translate(16, height / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.fillText(yLabel, 0, 0);
  context.restore();

  return { left, right, top, bottom, yMin, yMax };
}

function drawSeries(context, frame, data, key, color) {
  const { left, right, top, bottom, yMin, yMax } = frame;
  const firstTime = Math.max(0, state.time - HISTORY_SECONDS);
  const span = Math.max(HISTORY_SECONDS, state.time) - firstTime || 1;

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  data.forEach((point, index) => {
    const x = left + ((point.time - firstTime) / span) * (right - left);
    const y =
      bottom - ((point[key] - yMin) / (yMax - yMin || 1)) * (bottom - top);

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

function drawCharts() {
  const tempValues = state.history.flatMap((point) => [point.setpoint, point.outletTemp]);
  const tempMin = Math.floor((Math.min(...tempValues) - 5) / 5) * 5;
  const tempMax = Math.ceil((Math.max(...tempValues) + 5) / 5) * 5;

  const tempFrame = drawAxes(
    temperatureCtx,
    temperatureCanvas.width,
    temperatureCanvas.height,
    tempMin,
    tempMax,
    "Temperatura"
  );
  drawSeries(temperatureCtx, tempFrame, state.history, "setpoint", "#666666");
  drawSeries(temperatureCtx, tempFrame, state.history, "outletTemp", "#0066cc");

  const valveFrame = drawAxes(
    valveCtx,
    valveCanvas.width,
    valveCanvas.height,
    0,
    100,
    "Válvula %"
  );
  drawSeries(valveCtx, valveFrame, state.history, "valve", "#cc3300");
}

function render() {
  syncControlReadouts();
  updateReadouts();
  drawCharts();
}

function animationLoop(frameTime) {
  if (state.lastFrame === null) {
    state.lastFrame = frameTime;
  }

  const deltaSeconds = Math.min(0.1, (frameTime - state.lastFrame) / 1000);
  state.lastFrame = frameTime;

  if (state.running) {
    state.accumulator += deltaSeconds * 4;

    while (state.accumulator >= SIM_DT) {
      processStep();
      state.accumulator -= SIM_DT;
    }
  }

  render();
  window.requestAnimationFrame(animationLoop);
}

function attachEvents() {
  Object.values(controls).forEach((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
      element.addEventListener("input", syncControlReadouts);
    }
  });

  controls.manualValve.addEventListener("input", () => {
    if (controls.mode.value === "manual") {
      state.valve = Number(controls.manualValve.value);
    }
  });

  controls.mode.addEventListener("change", () => {
    syncControlReadouts();

    if (controls.mode.value === "manual") {
      state.valve = Number(controls.manualValve.value);
      state.bias = state.valve;
    } else {
      state.bias = state.valve;
      state.integral = 0;
    }
  });

  controls.runToggle.addEventListener("click", () => {
    state.running = !state.running;
    controls.runToggle.textContent = state.running ? "Pausar" : "Executar";
  });

  controls.resetButton.addEventListener("click", resetSimulation);

  controls.disturbanceCold.addEventListener("click", () => {
    controls.inletTemp.value = String(
      clamp(Number(controls.inletTemp.value) - 10, 20, 70)
    );
    syncControlReadouts();
  });

  controls.disturbanceFlow.addEventListener("click", () => {
    controls.flowFactor.value = clamp(
      Number(controls.flowFactor.value) + 0.20,
      0.7,
      1.6
    ).toFixed(2);
    syncControlReadouts();
  });

  controls.recoverButton.addEventListener("click", () => {
    controls.inletTemp.value = "40";
    controls.flowFactor.value = "1.00";
    syncControlReadouts();
  });
}

attachEvents();
syncControlReadouts();
resetSimulation();
window.requestAnimationFrame(animationLoop);
