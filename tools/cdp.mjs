// Dev-only CDP driver (not part of extension). Node >=22 (built-in WebSocket).
// Usage:
//   node tools/cdp.mjs open <url>            -> opens tab, prints target id
//   node tools/cdp.mjs eval <js> [filterUrl] -> evaluate in matching target, print JSON result
//   node tools/cdp.mjs list                  -> list targets
const fs = await import("fs");
const PORT = Number(process.env.CDP_PORT) || 9222;

async function getTargets() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  return res.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

const [,, cmd, arg, filter] = process.argv;

if (cmd === "list") {
  console.log(JSON.stringify((await getTargets()).map(t => ({ type: t.type, title: t.title, url: t.url })), null, 1));
} else if (cmd === "open") {
  const res = await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(arg)}`, { method: "PUT" });
  console.log(JSON.stringify(await res.json()));
} else if (cmd === "eval" || cmd === "evaliso") {
  const targets = (await getTargets()).filter(t => (t.type === "page" || t.type === "service_worker") && (!filter || t.url.includes(filter)));
  if (!targets.length) { console.error("no matching target"); process.exit(1); }
  for (const target of targets) {
    const cdp = await connect(target.webSocketDebuggerUrl);
    let contextId;
    if (cmd === "evaliso") {
      await cdp.send("Page.enable");
      const tree = await cdp.send("Page.getFrameTree");
      const { context } = await cdp.send("Page.createIsolatedWorld", { frameId: tree.frameTree.frame.id });
      contextId = context.contextId;
    }
    const result = await cdp.send("Runtime.evaluate", {
      expression: arg,
      returnByValue: true,
      awaitPromise: true,
      ...(contextId ? { contextId } : {}),
    });
    cdp.close();
    console.log(JSON.stringify(result.result?.value ?? result, null, 1));
  }
} else if (cmd === "shot") {
  const targets = (await getTargets()).filter(t => t.type === "page" && (!filter || t.url.includes(filter)));
  const cdp = await connect(targets[0].webSocketDebuggerUrl);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  cdp.close();
  fs.writeFileSync(arg, Buffer.from(shot.data, "base64"));
  console.log("saved " + arg);
} else {
  console.error("unknown command");
  process.exit(1);
}
