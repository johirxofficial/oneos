// OneOS end-to-end run driver (development only).
//
//   node scripts/e2e-run.mjs
//
// Walks the first-run wizard, starts the VM (allowing the memory-guard
// override), and reports the state of the console every few seconds until the
// VM is running or the start fails. Screenshots land in D:\OneOS\logs.

const BASE = "http://127.0.0.1:9222";
const LOG = "D:/OneOS/logs";
const fs = await import("node:fs/promises");

async function connect() {
  const pages = await (await fetch(BASE + "/json")).json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return {
    send(method, params = {}) {
      const myId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(myId, { resolve, reject });
        ws.send(JSON.stringify({ id: myId, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const cdp = await connect();
await cdp.send("Runtime.enable");

const evalJs = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error("js: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result?.value;
};

const shot = async (name) => {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(`${LOG}/${name}.png`, Buffer.from(r.data, "base64"));
  return name + ".png";
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];

const click = async (prefix) =>
  evalJs(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x =>
        x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(prefix.toLowerCase())}));
      if (!b) return 'missing';
      b.click();
      return 'clicked:' + b.textContent.trim();
    })()`);

const heading = () => evalJs(`document.querySelector('h2')?.textContent?.trim() ?? ''`);
const body = () => evalJs(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500)`);

// Login screen - the session starts behind an "Enter OneOS" card.
const splash = await evalJs(`document.body.innerText.toLowerCase()`);
if (splash.includes("press enter to continue")) {
  log.push(
    "login: " +
      (await evalJs(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x =>
          x.innerText.toLowerCase().includes('enter oneos'));
        if (!b) return 'missing';
        b.click();
        return 'clicked';
      })()`)),
  );
  await sleep(1500);
}

// Step 1 - capability report
let h = await heading();
log.push(`start heading: ${h}`);
if (h.toLowerCase().includes("welcome")) {
  log.push("step1: " + (await click("continue")));
  await sleep(900);
  h = await heading();
}

// Step 2 - resources (1 GB guest, TCG while WHPX is not active yet)
if (h.toLowerCase().includes("resources")) {
  const mem = await evalJs(`
    (() => {
      const el = document.querySelector('input[type=range]');
      if (!el) return 'no-range';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1024');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`);
  log.push(`memory: ${mem}`);
  const whpx = await evalJs(`
    (() => {
      const t = document.querySelector('[role=switch][aria-label="WHPX"]');
      if (!t) return 'missing';
      if (t.getAttribute('aria-checked') === 'true') t.click();
      return 'on->off';
    })()`);
  log.push(`whpx: ${whpx}`);
  await sleep(400);
  log.push("step2 screenshot: " + (await shot("run-01-resources")));
  log.push("step2: " + (await click("continue")));
  await sleep(900);
  h = await heading();
}

// Step 3 - installation media
log.push(`step3 heading: ${h}`);
log.push("step3 screenshot: " + (await shot("run-02-media")));
log.push("start: " + (await click("create disk and start")));
await sleep(6000);

// The memory guard may answer with an actionable override.
if (await evalJs(`[...document.querySelectorAll('button')].some(b => b.textContent.trim().toLowerCase().startsWith('start anyway'))`)) {
  log.push("memory guard fired -> Start anyway");
  log.push("override: " + (await click("start anyway")));
}

// Wait for the VM to reach a terminal state.
let final = "";
for (let i = 0; i < 30; i++) {
  await sleep(4000);
  const text = await evalJs(`document.body.innerText.replace(/\\s+/g, ' ')`);
  const status = (text.match(/running|starting|stopped|error|failed/i) || ["?"])[0];
  final = text.slice(0, 300);
  log.push(`t+${(i + 1) * 4}s status=${status} | ${text.replace(/\s+/g, " ").slice(0, 140)}`);
  if (/running/i.test(text) || /internal error|could not start|failed/i.test(text)) break;
}

log.push("final screenshot: " + (await shot("run-03-after-start")));
log.push("canvases: " + (await evalJs(`JSON.stringify([...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height))`)));
log.push("body: " + final.replace(/\s+/g, " "));

console.log(log.join("\n"));
cdp.close();
