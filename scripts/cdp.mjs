// Minimal Chrome DevTools Protocol client for the OneOS WebView2 window.
// Usage:
//   node cdp.mjs eval "<javascript expression>"
//   node cdp.mjs shot <out.png>
//   node cdp.mjs file <script.js>      (runs a js file as async IIFE, prints result)
const base = "http://127.0.0.1:9222";

async function pageWs() {
  const res = await fetch(base + "/json");
  const pages = await res.json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(JSON.stringify(msg.error)));
        else r(msg.result);
      }
    });
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const myId = ++id;
          return new Promise((r, j) => {
            pending.set(myId, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: myId, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
    ws.addEventListener("error", (e) => reject(new Error("ws error")));
  });
}

const [mode, arg] = process.argv.slice(2);
const cdp = await connect(await pageWs());
cdp.send("Runtime.enable");

if (mode === "eval") {
  const r = await cdp.send("Runtime.evaluate", {
    expression: arg,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
} else if (mode === "file") {
  const fs = await import("node:fs/promises");
  const code = await fs.readFile(arg, "utf8");
  const r = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${code} })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    console.error(JSON.stringify(r.exceptionDetails, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
  }
} else if (mode === "shot") {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs/promises");
  await fs.writeFile(arg, Buffer.from(r.data, "base64"));
  console.log("saved " + arg);
} else {
  console.error("usage: node cdp.mjs eval|file|shot <arg>");
  process.exitCode = 2;
}
cdp.close();
