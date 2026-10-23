// Renders video/intro.html frame by frame with headless Chrome (over the
// DevTools protocol) and encodes the frames with ffmpeg.
//
//   node video/render.mjs [--out out/intro.mp4] [--timing '{"goal":9}'] [--stills 4,11,19,25]
//
// --stills writes PNGs at those times (seconds) instead of rendering a video.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const FPS = 30;
const out = resolve(here, args.out ?? "out/intro.mp4");
const timing = args.timing ?? "{}";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), "intro-chrome-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1920,1080", "about:blank",
], { stdio: "ignore" });

try {
  const page = await waitForPage();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.enable");
  const url = `${pathToFileURL(join(here, "intro.html")).href}?timing=${encodeURIComponent(timing)}`;
  await cdp("Page.navigate", { url });
  await waitFor(cdp, "document.readyState === 'complete' && typeof window.render === 'function'");
  await cdp("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
  const T = JSON.parse((await cdp("Runtime.evaluate", { expression: "JSON.stringify(window.TIMING)", returnByValue: true })).result.value);

  const shot = async (t) => {
    await cdp("Runtime.evaluate", { expression: `render(${t})` });
    const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    return Buffer.from(data, "base64");
  };

  if (args.stills) {
    const dir = dirname(out);
    mkdirSync(dir, { recursive: true });
    for (const s of args.stills.split(",").map(Number)) {
      const file = join(dir, `still-${String(s).replace(".", "_")}s.png`);
      writeFileSync(file, await shot(s));
      console.log(file);
    }
  } else {
    const frames = join(dirname(out), "frames");
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const total = Math.round(T.end * FPS);
    for (let i = 0; i < total; i++) {
      writeFileSync(join(frames, `${String(i).padStart(5, "0")}.png`), await shot(i / FPS));
      if (i % 150 === 0) console.log(`frame ${i}/${total}`);
    }
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "%05d.png"),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS), out,
    ], { stdio: "inherit" });
    rmSync(frames, { recursive: true, force: true });
    console.log(`wrote ${out} (${T.end}s, timing ${JSON.stringify(T)})`);
  }
} finally {
  // Let Chrome exit before removing its profile; it writes to it on shutdown.
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

async function waitForPage() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((p) => p.type === "page");
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Chrome did not start");
}

async function waitFor(cdp, expression) {
  for (let i = 0; i < 100; i++) {
    const res = await cdp("Runtime.evaluate", { expression, returnByValue: true });
    if (res.result?.value === true) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  return new Promise((resolveConn, rejectConn) => {
    ws.onopen = () =>
      resolveConn((method, params = {}) => new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      }));
    ws.onerror = () => rejectConn(new Error("CDP connection failed"));
  });
}
