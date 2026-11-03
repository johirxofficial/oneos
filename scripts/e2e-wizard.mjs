// OneOS end-to-end wizard driver (development only).
//
//   node scripts/e2e-wizard.mjs
//
// Requires the app to be running with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
// --remote-debugging-port=9222 (see scripts/launch-oneos.ps1 -Debug).
//
// Every step prints the state it observed, so a failure is diagnosable from the
// console without a screenshot.

const BASE = "http://127.0.0.1:9222";

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

async function main() {
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
    const fs = await import("node:fs/promises");
    await fs.writeFile(name, Buffer.from(r.data, "base64"));
  };

  const helpers = {
    // Clicks the first <button> whose visible text starts with the label.
    clickButton: (label) => `
      (() => {
        const b = [...document.querySelectorAll('button')].find(x =>
          x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}));
        if (!b) return 'missing:' + [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(Boolean).join('|');
        b.click();
        return 'clicked';
      })()`,
    heading: `document.querySelector('h2')?.textContent ?? ''`,
    body: `document.body.innerText.replace(/\\s+/g, ' ').slice(0, 700)`,
  };

  const report = [];
  report.push("viewport: " + (await evalJs(`innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio`)));
  report.push("heading: " + (await evalJs(helpers.heading)));
  await shot("D:/OneOS/logs/e2e-00-start.png");

  // 1 -> 2
  report.push("continue: " + (await evalJs(helpers.clickButton("Continue"))));
  await new Promise((r) => setTimeout(r, 800));
  report.push("heading: " + (await evalJs(helpers.heading)));

  // Use 1024 MB so the guest fits this host better; native setter for React.
  report.push(
    "memory: " +
      (await evalJs(`
      (() => {
        const el = document.querySelector('input[type=range]');
        if (!el) return 'no range input';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '1024');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value;
      })()`)),
  );

  // WHPX off -> TCG (no reboot yet on this host).
  report.push(
    "whpx toggle: " +
      (await evalJs(`
      (() => {
        const t = document.querySelector('[role=switch][aria-label="WHPX"]');
        if (!t) return 'missing';
        const before = t.getAttribute('aria-checked');
        if (before === 'true') { t.click(); }
        return before + '->' + t.getAttribute('aria-checked');
      })()`)),
  );
  await new Promise((r) => setTimeout(r, 400));
  await shot("D:/OneOS/logs/e2e-01-resources.png");

  // 2 -> 3
  report.push("continue: " + (await evalJs(helpers.clickButton("Continue"))));
  await new Promise((r) => setTimeout(r, 900));
  report.push("heading: " + (await evalJs(helpers.heading)));
  report.push("iso: " + (await evalJs(`document.querySelector('select')?.value ?? 'no select'`)));
  await shot("D:/OneOS/logs/e2e-02-installer.png");

  console.log(report.join("\n"));
  cdp.close();
}

main().catch((e) => {
  console.error("FAILED: " + e.message);
  process.exitCode = 1;
});
