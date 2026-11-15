#!/usr/bin/env node
// E2E de NexBots: API real de Next + sandboxd + Docker + Chromium. Sin mocks.
// Requiere el entorno de compose.yml y `next dev` con su configuración (ver docs/nexbots.md).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const APP = process.env.E2E_APP ?? "http://127.0.0.1:3999";
const SITE = "http://nexbots-e2e-site:8080";
const SECRET = process.env.NEXUS_AGENT_SECRET ?? "e2e-secret-no-es-real";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  → ${String(detail).slice(0, 400)}` : ""}`);
}
const section = (title) => console.log(`\n=== ${title}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function client() {
  let cookie = "";
  const call = async (method, path, body) => {
    const send = () =>
      fetch(APP + path, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    // El servidor puede cerrar una conexión keep-alive inactiva justo cuando se reutiliza.
    const response = await send().catch((error) => {
      if (error.cause?.code === "UND_ERR_SOCKET") return send();
      throw error;
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text };
  };
  call.cookie = () => cookie;
  return call;
}

const admin = client();
const stranger = client();

async function runTask(botId, body, stopAt = []) {
  const created = await admin("POST", `/api/bots/${botId}/tasks`, { kind: "plan", ...body });
  if (created.status !== 202) return { created, task: { status: `http_${created.status}`, error: created.text } };
  const id = created.json.task.id;
  for (let attempt = 0; attempt < 480; attempt += 1) {
    const got = await admin("GET", `/api/bots/${botId}/tasks/${id}`);
    if (got.json?.finished || stopAt.includes(got.json?.task?.status)) return got.json;
    await sleep(250);
  }
  return { task: { id, status: "poll_timeout" } };
}

const pyProbe = (code) => [
  { action: "write_file", path: "probe.py", content: code },
  { action: "shell", command: "python3 probe.py", allow_failure: true, timeout_s: 120 },
];
const isStoppedStatus = (status) => status === "cancelled" || status === "interrupted" || status === "failed";
const stdoutOf = (done) => done.task?.result?.variables?.shell?.stdout ?? "";
const lifecycle = (id, action) => admin("POST", `/api/bots/${id}/lifecycle`, { action });
const containerOf = (id) => `nexus-bot-${id}`;
const inspect = (id) => JSON.parse(docker("inspect", containerOf(id)))[0];

section("Preparación");
for (let attempt = 0; attempt < 120; attempt += 1) {
  // Carrera con un temporizador: contra un puerto recién publicado, fetch puede no resolverse nunca.
  const ready = await Promise.race([fetch("http://127.0.0.1:18095/healthz").catch(() => null), sleep(1000)]);
  if (ready?.ok) break;
  await sleep(250);
}
const stamp = Date.now();
const adminEmail = `admin${stamp}@e2e.test`;
const register = await admin("POST", "/api/auth/register", { email: adminEmail, password: "contrasena-e2e" });
check("registro de la primera cuenta", register.status === 201, register.text);
const madeUser = await admin("POST", "/api/admin/users", { email: `otro${stamp}@e2e.test`, password: "contrasena-e2e", role: "user" });
check("alta de una segunda cuenta", madeUser.status === 201, madeUser.text);
const otherUserId = madeUser.json.user.id;
const login = await stranger("POST", "/api/auth/login", { email: `otro${stamp}@e2e.test`, password: "contrasena-e2e" });
check("login de la segunda cuenta", login.status === 200, login.text);

section("1. Crear NexBots con identidad y configuración propias");
const createdA = await admin("POST", "/api/bots", {
  name: "Bot Alfa", description: "e2e", instructions: "Soy Alfa", config: { persistBrowser: true },
});
const createdB = await admin("POST", "/api/bots", { name: "Bot Beta", instructions: "Soy Beta" });
check("se crean dos bots", createdA.status === 201 && createdB.status === 201, createdA.text + createdB.text);
const A = createdA.json.bot.id;
const B = createdB.json.bot.id;
check("identidades distintas", A !== B && createdA.json.bot.slug === "bot-alfa" && createdB.json.bot.slug === "bot-beta");
check("nacen parados", createdA.json.bot.status === "stopped");
const invalid = await admin("POST", "/api/bots", { name: "x", config: { memoryMb: 99999 } });
check("rechaza límites fuera de margen", invalid.status === 400, invalid.text);

section("2. Preparar entorno y almacenamiento");
const startA = await lifecycle(A, "start");
const startB = await lifecycle(B, "start");
check("arrancan los dos", startA.json?.bot?.status === "running" && startB.json?.bot?.status === "running", startA.text + startB.text);

const infoA = inspect(A);
const infoB = inspect(B);
const hostA = infoA.HostConfig;
check("usuario no root", infoA.Config.User === "bot", infoA.Config.User);
check("sin capabilities", JSON.stringify(hostA.CapDrop) === '["ALL"]');
check("no-new-privileges", hostA.SecurityOpt.includes("no-new-privileges:true"));
check("raíz de solo lectura", hostA.ReadonlyRootfs === true);
check("no privilegiado", hostA.Privileged === false);
check("límite de memoria", hostA.Memory === 2048 * 1024 * 1024 && hostA.MemorySwap === hostA.Memory);
check("límite de CPU y PIDs", hostA.NanoCpus === 1e9 && hostA.PidsLimit === 512);
check("sin puertos publicados", Object.keys(infoA.NetworkSettings.Ports ?? {}).every((p) => !infoA.NetworkSettings.Ports[p]));
check("sin socket de Docker", !JSON.stringify(infoA.Mounts).includes("docker.sock"));
check("solo su volumen", infoA.Mounts.length === 1 && infoA.Mounts[0].Name === `nexus-bot-data-${A}`, JSON.stringify(infoA.Mounts));
const netA = JSON.parse(docker("network", "inspect", `nexus-bot-net-${A}`))[0];
check("red interna propia", netA.Internal === true && Object.keys(infoA.NetworkSettings.Networks).join() === `nexus-bot-net-${A}`);
check("el otro bot no está en esa red", !Object.values(netA.Containers).some((c) => c.Name === containerOf(B)));
const envA = infoA.Config.Env.join("\n");
check("el secreto maestro no entra en el bot", !envA.includes("e2e-secret-no-es-real"));

section("3-5. Tarea, navegador real y artefacto en el workspace");
const flow = await runTask(A, {
  trace: true,
  steps: [
    { action: "goto", url: `${SITE}/` },
    { action: "scroll", dy: 1200 },
    { action: "fill", selector: "#name", value: "Ada" },
    { action: "click", selector: "#go" },
    { action: "wait_for", selector: "#out:not(:empty)" },
    { action: "extract", selector: "#out", save_as: "saludo" },
    { action: "screenshot", path: "artifacts/saludo.png" },
    { action: "download", selector: "#dl", path: "downloads/d.txt" },
    { action: "write_file", path: "uploads/subir.txt", content: "fichero para subir" },
    { action: "upload", selector: "#file", path: "uploads/subir.txt" },
    { action: "click", selector: "#send" },
    { action: "wait_for", selector: "#up" },
    { action: "extract", selector: "#up", save_as: "subida" },
    { action: "write_file", path: "artifacts/resultado.json", content: '{"saludo":"{{saludo}}","subida":"{{subida}}"}' },
  ],
});
check("la tarea termina bien", flow.task?.status === "succeeded", flow.task?.error);
check("la página respondió a la interacción", flow.task?.result?.variables?.saludo === "Hola, Ada", JSON.stringify(flow.task?.result));
check("la subida llegó al servidor", /recibidos \d+ bytes/.test(flow.task?.result?.variables?.subida ?? ""));
const artifact = await admin("GET", `/api/bots/${A}/files?path=artifacts/resultado.json&download=1`);
check("el artefacto se lee por la API", JSON.parse(artifact.text || "{}").saludo === "Hola, Ada", artifact.text);
const downloaded = await admin("GET", `/api/bots/${A}/files?path=downloads/d.txt&download=1`);
check("la descarga quedó en el workspace", downloaded.text.includes("contenido descargado"), downloaded.text);
const png = await fetch(`${APP}/api/bots/${A}/files?path=artifacts/saludo.png&download=1`, {
  headers: { cookie: "" },
});
check("sin sesión no se accede a los ficheros", png.status === 401, png.status);
const listed = await admin("GET", `/api/bots/${A}/files?path=artifacts`);
check("captura guardada", listed.json?.entries?.some((e) => e.name === "saludo.png" && e.size > 1000), listed.text);
const traceFile = docker("run", "--rm", "-v", `nexus-bot-data-${A}:/d:ro`, "python:3.12-slim", "sh", "-c", `ls -l /d/state/tasks/${flow.task.id}.trace.zip | awk '{print $5}'`);
check("traza de Playwright guardada", Number(traceFile) > 1000, traceFile);
const publicPage = await runTask(A, {
  steps: [{ action: "goto", url: "https://example.com/" }, { action: "extract", selector: "body", save_as: "body" }],
});
check("internet público por el proxy (navegador)", /documentation examples/.test(publicPage.task?.result?.variables?.body ?? ""), publicPage.task?.error);

section("7. Aislamiento entre bots");
await runTask(A, { steps: [{ action: "write_file", path: "memory/secreto-alfa.txt", content: "dato privado de Alfa" }] });
const listB = await admin("GET", `/api/bots/${B}/files?path=memory`);
check("B no ve los ficheros de A por la API", !listB.text.includes("secreto-alfa"), listB.text);
const inB = await runTask(B, { steps: [{ action: "shell", command: "grep -rl \"dato privado de $(echo Alfa)\" / --exclude-dir=proc --exclude-dir=sys 2>/dev/null | wc -l; ls /bot/workspace/memory | wc -l" }] });
check("B no encuentra el dato de A en su sistema de ficheros", stdoutOf(inB).split("\n").slice(0, 2).join() === "0,0", stdoutOf(inB));
check("volúmenes distintos", infoA.Mounts[0].Name !== infoB.Mounts[0].Name);
const escape = await runTask(B, { steps: [{ action: "write_file", path: "../../bot/x", content: "x" }] });
check("escapar del workspace falla", escape.task?.status === "failed" && /PathEscape/.test(escape.task?.error ?? ""), escape.task?.error);
const traversal = await admin("GET", `/api/bots/${A}/files?path=${encodeURIComponent("../state/tasks")}`);
check("la API rechaza path traversal", traversal.status >= 400, traversal.text);

const stolen = await stranger("GET", `/api/bots/${A}`);
check("otra cuenta no ve el bot (404)", stolen.status === 404, stolen.text);
const stolenFile = await stranger("GET", `/api/bots/${A}/files?path=artifacts/resultado.json&download=1`);
check("otra cuenta no lee sus ficheros", stolenFile.status === 404, stolenFile.text);
const stolenTask = await stranger("POST", `/api/bots/${A}/tasks`, { kind: "plan", steps: [{ action: "shell", command: "id" }] });
check("otra cuenta no le lanza tareas", stolenTask.status === 404, stolenTask.text);

const ipA = infoA.NetworkSettings.Networks[`nexus-bot-net-${A}`].IPAddress;
const ipB = infoB.NetworkSettings.Networks[`nexus-bot-net-${B}`].IPAddress;
const netProbe = await runTask(A, {
  steps: pyProbe(`
import ipaddress, json, socket, urllib.request, urllib.error, http.client, os
def tcp(h, p, t=2):
    try:
        socket.create_connection((h, p), t).close(); return "CONECTA"
    except Exception as e: return type(e).__name__
own = socket.gethostbyname(socket.gethostname())
net = ipaddress.ip_network(own + "/28", strict=False)
ports = [22, 139, 3000, 5433, 8090]
scan = {f"{ip}:{p}": tcp(str(ip), p, 1) for ip in net.hosts() if str(ip) != own for p in ports}
out = {
  "own": own,
  "scan_conecta": sorted(k for k, v in scan.items() if v == "CONECTA"),
  "otro_bot_ip": tcp("${ipB}", 8900),
  "otro_bot_nombre": tcp("nexus-bot-${B}", 8900),
  "lan": tcp("192.168.1.1", 80),
  "docker0": tcp("172.17.0.1", 22),
  "metadatos": tcp("169.254.169.254", 80),
  "internet_directo": tcp("1.1.1.1", 443),
  "docker_proxy": tcp("nexbots-e2e-docker-proxy", 2375),
  "bd": tcp("nexbots-e2e-db", 5432),
}
try:
    socket.gethostbyname("example.com"); out["dns_externo"] = "RESUELVE"
except Exception as e: out["dns_externo"] = type(e).__name__
proxy = os.environ["HTTP_PROXY"].split("//")[1]
ph, pp = proxy.split(":")
def via(host, port):
    c = http.client.HTTPConnection(ph, int(pp), timeout=15)
    c.request("CONNECT", f"{host}:{port}"); return c.getresponse().status
for name, (h, p) in {"lan":("192.168.1.1",443),"metadatos":("169.254.169.254",443),"bd":("nexbots-e2e-db",443),"docker":("nexbots-e2e-docker-proxy",2375),"ssh_host":("example.com",22),"gw_host":("172.17.0.1",443),"publico":("example.com",443)}.items():
    out["via_"+name] = via(h, p)
print(json.dumps(out))
`),
});
let net = {};
try {
  net = JSON.parse(stdoutOf(netProbe));
} catch {
  check("sonda de red ejecutada", false, stdoutOf(netProbe) + netProbe.task?.error);
}
console.log("   sonda:", JSON.stringify(net));
// El sidecar es un servicio de control conocido: está en la red del bot y exige firma.
const sidecarIp = docker("inspect", "nexbots-e2e-agent", "--format", `{{(index .NetworkSettings.Networks "nexus-bot-net-${A}").IPAddress}}`);
const unexpected = (net.scan_conecta ?? []).filter((target) => target !== `${sidecarIp}:8090`);
check("ningún servicio del host alcanzable por la subred", Array.isArray(net.scan_conecta) && unexpected.length === 0, net.scan_conecta);
check("A no llega a B por IP", net.otro_bot_ip !== "CONECTA", net.otro_bot_ip);
check("A no resuelve el nombre de B", net.otro_bot_nombre === "gaierror", net.otro_bot_nombre);
check("sin ruta a la LAN", net.lan !== "CONECTA");
check("sin ruta al host por docker0", net.docker0 !== "CONECTA");
check("sin ruta a metadatos", net.metadatos !== "CONECTA");
check("sin internet directo", net.internet_directo !== "CONECTA");
check("no alcanza el proxy de Docker", net.docker_proxy !== "CONECTA");
check("no alcanza la base de datos", net.bd !== "CONECTA");
check("sin DNS externo", net.dns_externo === "gaierror", net.dns_externo);
for (const key of ["via_lan", "via_metadatos", "via_bd", "via_docker", "via_ssh_host", "via_gw_host"]) {
  check(`el proxy rechaza ${key.slice(4)}`, net[key] === 403, net[key]);
}
check("el proxy deja pasar web pública", net.via_publico === 200, net.via_publico);
const privateNav = await runTask(A, { steps: [{ action: "goto", url: "http://192.168.1.1/" }] });
const egressLog = docker("logs", "nexbots-e2e-egress");
check("el navegador tampoco sale a la LAN (registrado en el proxy)", egressLog.includes('"host": "192.168.1.1"') && egressLog.includes('"decision": "deny"'), privateNav.task?.error);
const fileNav = await runTask(A, { steps: [{ action: "goto", url: "file:///etc/passwd" }] });
check("no abre file://", fileNav.task?.status === "failed" && /BlockedScheme/.test(fileNav.task?.error ?? ""), fileNav.task?.error);

section("Control por MCP con el cliente real del sidecar (nas-adk)");
const signature = (body) => {
  const stamp = String(Date.now() / 1000);
  return {
    Authorization: `Bearer ${SECRET}`,
    "X-Nexus-Timestamp": stamp,
    "X-Nexus-Signature": createHmac("sha256", SECRET).update(`${stamp}.${body}`).digest("hex"),
  };
};
const link = await (await fetch(`http://127.0.0.1:18095/v1/bots/${A}/mcp-link`, { headers: signature("") })).json();
check("sandboxd entrega el conector MCP", link.url?.endsWith(":8900/mcp") && /^Bearer [0-9a-f]{64}$/.test(link.headers?.Authorization ?? ""), JSON.stringify(link).slice(0, 200));
const mcpProgram = `
import asyncio, json, os
from nas.adk.protocols.mcp.client import MCPClient, MCPServerConfig
URL, AUTH, SITE = os.environ["U"], os.environ["T"], os.environ["S"]
async def connect(auth):
    c = MCPClient(MCPServerConfig(url=URL, transport="streamable-http", headers={"Authorization": auth}, name_prefix="nexbot", timeout=30))
    await c.connect()
    return c
async def main():
    out = {}
    try:
        await asyncio.wait_for(connect("Bearer mal"), 15)
        out["token_malo"] = "ACEPTADO"
    except BaseException as e:
        out["token_malo"] = "rechazado"
    c = await connect(AUTH)
    tools = {t.name: t for t in c.get_adk_tools()}
    out["tools"] = sorted(tools)
    async def call(name, **args):
        return await tools["nexbot__" + name].run_async(**args)
    out["nav"] = str(await call("browser_navigate", url=SITE + "/"))[:600]
    out["type"] = str(await call("browser_type", selector="#name", text="Grace"))
    out["click"] = str(await call("browser_click", selector="#go"))[:600]
    out["write"] = str(await call("workspace_write", path="artifacts/mcp.txt", content="hecho por mcp"))
    out["read"] = str(await call("workspace_read", path="artifacts/mcp.txt"))
    out["escape"] = str(await call("workspace_read", path="../state/bot.json"))
    await c.close()
    print("@@" + json.dumps(out, ensure_ascii=False))
asyncio.run(main())
`;
let mcpOut = {};
try {
  const image = docker("inspect", "nexus-agent", "--format", "{{.Image}}");
  const raw = docker("run", "--rm", "--network", `nexus-bot-net-${A}`, "-e", `U=${link.url}`, "-e", `T=${link.headers.Authorization}`, "-e", `S=${SITE}`, image, "python", "-c", mcpProgram);
  mcpOut = JSON.parse(raw.split("@@").at(-1));
} catch (error) {
  check("cliente MCP ejecutado", false, String(error.stderr ?? error).slice(-800));
}
console.log("   herramientas:", (mcpOut.tools ?? []).join(", "));
check("rechaza un token incorrecto", mcpOut.token_malo === "rechazado", mcpOut.token_malo);
check("lista las herramientas con prefijo", (mcpOut.tools ?? []).includes("nexbot__browser_click") && (mcpOut.tools ?? []).includes("nexbot__workspace_write"));
check("navega y devuelve el estado de la página", /Formulario de prueba|Saludar/.test(mcpOut.nav ?? ""), mcpOut.nav);
check("marca el contenido como no confiable", /untrusted/.test(mcpOut.nav ?? ""), mcpOut.nav);
check("interactúa con la página", /Hola, Grace/.test(mcpOut.click ?? ""), mcpOut.click);
check("escribe y lee su workspace", /hecho por mcp/.test(mcpOut.read ?? ""), mcpOut.read);
check("MCP tampoco escapa del workspace", /workspace/.test(mcpOut.escape ?? "") && !/botId/.test(mcpOut.escape ?? ""), mcpOut.escape);

section("6. Parar, arrancar, recrear: qué se conserva");
await runTask(A, { steps: [{ action: "goto", url: `${SITE}/login` }, { action: "wait_for", selector: "#s" }] });
await runTask(B, { steps: [{ action: "goto", url: `${SITE}/login` }, { action: "wait_for", selector: "#s" }] });
const whoami = (id) => runTask(id, { steps: [{ action: "goto", url: `${SITE}/whoami` }, { action: "extract", selector: "#who", save_as: "who" }] });
check("A inicia sesión", (await whoami(A)).task?.result?.variables?.who === "abc123");
const pip = await runTask(A, { steps: [{ action: "shell", command: "pip install --quiet cowsay && python3 -c 'import cowsay; print(cowsay.__name__)'", timeout_s: 180 }] });
check("instala una dependencia por el proxy", stdoutOf(pip).includes("cowsay"), pip.task?.error);

const idBefore = inspect(A).Id;
const stopped = await lifecycle(A, "stop");
check("se detiene", stopped.json?.bot?.status === "stopped", stopped.text);
check("el contenedor está parado", inspect(A).State.Running === false);
const taskWhileStopped = await admin("POST", `/api/bots/${A}/tasks`, { kind: "plan", steps: [{ action: "shell", command: "id" }] });
check("no acepta tareas parado", taskWhileStopped.status === 409, taskWhileStopped.text);
const restarted = await lifecycle(A, "start");
check("vuelve a arrancar", restarted.json?.bot?.status === "running", restarted.text);
check("es el mismo contenedor", inspect(A).Id === idBefore);
check("conserva el artefacto tras parar", (await admin("GET", `/api/bots/${A}/files?path=artifacts/resultado.json&download=1`)).text.includes("Hola, Ada"));

const recreated = await lifecycle(A, "recreate");
check("se recrea", recreated.json?.bot?.status === "running", recreated.text);
check("el contenedor es otro", inspect(A).Id !== idBefore);
check("el artefacto sobrevive a la recreación", (await admin("GET", `/api/bots/${A}/files?path=artifacts/resultado.json&download=1`)).text.includes("Hola, Ada"));
check("la memoria sobrevive", (await admin("GET", `/api/bots/${A}/files?path=memory/secreto-alfa.txt&download=1`)).text.includes("dato privado"));
const tasksAfter = await admin("GET", `/api/bots/${A}/tasks`);
check("el historial de tareas sobrevive", tasksAfter.json?.tasks?.some((t) => t.id === flow.task.id && t.status === "succeeded"), tasksAfter.text.slice(0, 300));
check("la sesión autorizada sobrevive", (await whoami(A)).task?.result?.variables?.who === "abc123");
const pipAfter = await runTask(A, { steps: [{ action: "shell", command: "python3 -c 'import cowsay; print(cowsay.__name__)'" }] });
check("la dependencia sobrevive", stdoutOf(pipAfter).includes("cowsay"), pipAfter.task?.error);
const ephemeral = await runTask(A, { steps: [{ action: "shell", command: "ls /tmp/marca-efimera 2>/dev/null | wc -l" }] });
check("/tmp es efímero", stdoutOf(ephemeral).trim() === "0");
check("B con sesión antes de recrear", (await whoami(B)).task?.result?.variables?.who === "abc123");
await lifecycle(B, "recreate");
check("B, sin autorización, pierde la sesión", (await whoami(B)).task?.result?.variables?.who === "anonimo");

section("Fallos, estado y logs");
const bad = await runTask(A, {
  steps: [
    { action: "goto", url: `${SITE}/` },
    { action: "wait_for", selector: "#no-existe", timeout_ms: 500 },
    { action: "write_file", path: "no-llega.txt", content: "x" },
  ],
});
check("un selector inexistente marca la tarea como fallida", bad.task?.status === "failed", bad.task?.status);
check("indica el paso que falló", bad.failedStep === 1, bad.failedStep);
check("guarda el error", /Timeout|no-existe/.test(bad.task?.error ?? ""), bad.task?.error);
check("registra el fallo en los eventos", bad.events?.at(-1)?.type === "failed", JSON.stringify(bad.events?.at(-1)));
check("no ejecuta los pasos siguientes", (await admin("GET", `/api/bots/${A}/files?path=no-llega.txt&download=1`)).status === 404);
const logs = await admin("GET", `/api/bots/${A}/logs`);
check("el fallo aparece en el log del bot", logs.json?.lines?.some((l) => l.msg === "failed" && l.task === bad.task.id), logs.text.slice(0, 300));
const shot = docker("run", "--rm", "-v", `nexus-bot-data-${A}:/d:ro`, "python:3.12-slim", "sh", "-c", `ls /d/state/tasks/${bad.task.id}.failure.png | wc -l`);
check("captura del fallo", shot === "1", shot);

const secretTask = await runTask(A, {
  steps: [{ action: "goto", url: `${SITE}/` }, { action: "fill", selector: "#name", value: "clave-super-secreta", secret: true }],
});
check("tarea con secreto termina", secretTask.task?.status === "succeeded", secretTask.task?.error);
const secretRow = await admin("GET", `/api/bots/${A}/tasks`);
const journal = docker("run", "--rm", "-v", `nexus-bot-data-${A}:/d:ro`, "python:3.12-slim", "sh", "-c", "grep -rl clave-super-secreta /d/state /d/logs | wc -l");
const containerLogs = docker("logs", containerOf(A));
check("el secreto no llega a la BD, journal ni logs", !secretRow.text.includes("clave-super-secreta") && journal === "0" && !containerLogs.includes("clave-super-secreta"), journal);

const timeout = await runTask(A, { timeoutS: 2, steps: [{ action: "shell", command: "sleep 60", timeout_s: 120 }] });
check("el tiempo máximo se aplica", timeout.task?.status === "timeout", timeout.task?.status);

const toCancel = await admin("POST", `/api/bots/${A}/tasks`, { kind: "plan", steps: [{ action: "shell", command: "sleep 90", timeout_s: 120 }] });
await sleep(1200);
await admin("POST", `/api/bots/${A}/tasks/${toCancel.json.task.id}`, { action: "cancel" });
await sleep(1000);
const cancelled = await admin("GET", `/api/bots/${A}/tasks/${toCancel.json.task.id}`);
check("una tarea en marcha se puede cancelar", cancelled.json?.task?.status === "cancelled", cancelled.text.slice(0, 300));
const stray = await runTask(A, { steps: [{ action: "shell", command: "python3 -c \"import os;print(sum(1 for p in os.listdir('/proc') if p.isdigit() and open(f'/proc/{p}/cmdline','rb').read().startswith(b'sleep\\x00')))\"", allow_failure: true }] });
check("cancelar mata el proceso", stdoutOf(stray).trim() === "0", stdoutOf(stray) + stray.task?.error);

const gated = await runTask(A, {
  steps: [{ action: "approve", message: "¿Publicar?" }, { action: "write_file", path: "publicado.txt", content: "sí" }],
}, ["awaiting_approval"]);
check("la tarea espera aprobación", gated.task?.status === "awaiting_approval" && gated.approval?.message === "¿Publicar?", JSON.stringify(gated).slice(0, 300));
check("no actúa antes de aprobar", (await admin("GET", `/api/bots/${A}/files?path=publicado.txt&download=1`)).status === 404);
await admin("POST", `/api/bots/${A}/tasks/${gated.task.id}`, { action: "approve" });
await sleep(800);
const approved = await admin("GET", `/api/bots/${A}/tasks/${gated.task.id}`);
check("al aprobar continúa", approved.json?.task?.status === "succeeded", approved.text.slice(0, 300));
const refused = await runTask(A, { steps: [{ action: "approve", message: "?" }, { action: "write_file", path: "denegado.txt", content: "x" }] }, ["awaiting_approval"]);
await admin("POST", `/api/bots/${A}/tasks/${refused.task.id}`, { action: "deny" });
await sleep(800);
const denied = await admin("GET", `/api/bots/${A}/tasks/${refused.task.id}`);
check("al denegar se detiene", denied.json?.task?.status === "denied" && (await admin("GET", `/api/bots/${A}/files?path=denegado.txt&download=1`)).status === 404, denied.text.slice(0, 300));

const running = await admin("POST", `/api/bots/${A}/tasks`, { kind: "plan", steps: [{ action: "shell", command: "sleep 100", timeout_s: 150 }] });
await sleep(1200);
await lifecycle(A, "stop");
const haltedTask = await admin("GET", `/api/bots/${A}/tasks/${running.json.task.id}`);
check("parar con una tarea activa la marca interrumpida", haltedTask.json?.task?.status === "interrupted", haltedTask.text.slice(0, 300));
await lifecycle(A, "start");
const journalAfter = await admin("GET", `/api/bots/${A}/tasks/${running.json.task.id}`);
check("no se reanuda sola al volver", journalAfter.json?.task?.status === "interrupted", journalAfter.text.slice(0, 300));

const crashTask = await admin("POST", `/api/bots/${A}/tasks`, { kind: "plan", steps: [{ action: "shell", command: "sleep 100", timeout_s: 150 }] });
await sleep(1200);
docker("kill", containerOf(A));
await sleep(1500);
const afterKill = await admin("GET", `/api/bots/${A}`);
console.log("   tras docker kill:", JSON.stringify({ status: afterKill.json?.bot?.status, lastError: afterKill.json?.bot?.lastError, state: afterKill.json?.runtime?.state, exit: afterKill.json?.runtime?.exitCode, restarts: afterKill.json?.runtime?.restarts }));
check("un cierre brusco se refleja en el estado", afterKill.json?.bot?.status === "error" && /137/.test(afterKill.json?.bot?.lastError ?? ""), afterKill.text.slice(0, 300));
const crashRow = await admin("GET", `/api/bots/${A}/tasks`);
check("su tarea queda interrumpida", crashRow.json?.tasks?.find((t) => t.id === crashTask.json.task.id)?.status === "interrupted", crashRow.text.slice(0, 300));
const recovered = await lifecycle(A, "start");
check("se puede volver a arrancar tras el fallo", recovered.json?.bot?.status === "running", recovered.text);

docker("stop", "nexbots-e2e-sandboxd");
const noControl = await admin("GET", `/api/bots/${A}`);
check("sin plano de control se informa, sin inventar estado", noControl.json?.reachable === false, noControl.text.slice(0, 200));
const failedStart = await lifecycle(B, "stop");
check("una operación fallida devuelve error", failedStart.status >= 500, failedStart.status);
check("y deja el motivo en el bot", (await admin("GET", `/api/bots/${B}`)).json?.bot?.lastError != null);
docker("start", "nexbots-e2e-sandboxd");
for (let attempt = 0; attempt < 40; attempt += 1) {
  const back = await Promise.race([fetch("http://127.0.0.1:18095/healthz").catch(() => null), sleep(1000)]);
  if (back?.ok) break;
  await sleep(250);
}

section("Recrear los servicios de control");
docker("compose", "-p", "nexbots-e2e", "-f", new URL("./compose.yml", import.meta.url).pathname, "up", "-d", "--force-recreate", "--no-deps", "sandboxd");
let afterRecreate = null;
for (let attempt = 0; attempt < 80; attempt += 1) {
  afterRecreate = await admin("GET", `/api/bots/${A}`);
  if (afterRecreate.json?.runtime?.runtime) break;
  await sleep(250);
}
check("un sandboxd recreado vuelve a alcanzar a los bots", afterRecreate.json?.reachable === true && afterRecreate.json?.runtime?.runtime?.botId === A, afterRecreate.text.slice(0, 300));
const backAgain = await runTask(A, { steps: [{ action: "write_file", path: "tras-recrear.txt", content: "ok" }] });
check("y puede ejecutar tareas", backAgain.task?.status === "succeeded", backAgain.task?.error);

section("Escritorio y visor en directo");
const statusOf = async (id) => (await admin("GET", `/api/bots/${id}`)).json?.runtime?.runtime;
const desktopA = await statusOf(A);
check("el bot tiene escritorio disponible", desktopA?.desktop?.available === true, JSON.stringify(desktopA?.desktop));

const readFrame = async (client, id) => {
  const cookie = client.cookie();
  const response = await fetch(`${APP}/api/bots/${id}/desktop?frame=1`, { headers: { cookie } });
  return { status: response.status, type: response.headers.get("content-type"), body: Buffer.from(await response.arrayBuffer()) };
};
const before = await readFrame(admin, A);
check("un fotograma es un JPEG real", before.status === 200 && before.type === "image/jpeg" && before.body[0] === 0xff && before.body[1] === 0xd8, before.status);
check("el fotograma de otra cuenta responde 404", (await readFrame(stranger, A)).status === 404);

const screenTask = await runTask(A, {
  steps: [
    { action: "goto", url: `${SITE}/pantalla` },
    { action: "desktop_click", x: 640, y: 500 },
    { action: "desktop_type", text: "escrito por pixeles" },
    { action: "extract", selector: "#echo", save_as: "eco" },
    { action: "desktop_screenshot", path: "artifacts/pantalla.png" },
  ],
});
check("clic y teclado por píxeles llegan a la página", screenTask.task?.result?.variables?.eco === "escrito por pixeles", JSON.stringify(screenTask.task?.result ?? screenTask.task?.error));
const during = await readFrame(admin, A);
check("la pantalla cambia al trabajar el bot", !before.body.equals(during.body));
writeFileSync(`${process.env.E2E_OUT ?? "/tmp"}/frame.jpg`, during.body);
const pixel = await runTask(A, {
  steps: [{ action: "shell", command: "python -c \"from PIL import Image; print(Image.open('/bot/workspace/artifacts/pantalla.png').convert('RGB').getpixel((640,500)))\"" }],
});
check("la ventana del navegador se ve de verdad en la pantalla", /255, 0, 0/.test(stdoutOf(pixel)), stdoutOf(pixel) || pixel.task?.error);

const secretScreen = await runTask(A, { steps: [{ action: "desktop_click", x: 640, y: 500 }, { action: "desktop_type", text: "clave-pantalla-e2e", secret: true }] });
const secretScreenRow = await admin("GET", `/api/bots/${A}/tasks/${secretScreen.task.id}`);
check("el texto secreto no queda en la tarea", secretScreen.task?.status === "succeeded" && !secretScreenRow.text.includes("clave-pantalla-e2e"), secretScreenRow.text.slice(0, 200));
const secretJournal = await runTask(A, { steps: [{ action: "shell", command: "grep -rl \"clave-pantalla-$(echo e2e)\" /bot/state /bot/logs | wc -l" }] });
check("ni en el journal del volumen ni en sus logs", stdoutOf(secretJournal).trim() === "0", stdoutOf(secretJournal));

const failedDesktop = await runTask(A, { steps: [{ action: "desktop_click", x: 5000, y: 5000 }] });
check("un punto fuera de la pantalla falla con su motivo", failedDesktop.task?.status === "failed" && /fuera de la pantalla/.test(failedDesktop.task?.error ?? ""), failedDesktop.task?.error);

const openStream = async () => {
  const controller = new AbortController();
  const response = await fetch(`${APP}/api/bots/${A}/desktop?fps=5`, { headers: { cookie: admin.cookie() }, signal: controller.signal });
  return { controller, response };
};
const stream = await openStream();
check("la emisión es MJPEG", /multipart\/x-mixed-replace/.test(stream.response.headers.get("content-type") ?? ""), stream.response.status);
const reader = stream.response.body.getReader();
let received = Buffer.alloc(0);
const countFrames = () => {
  let frames = 0;
  for (let at = received.indexOf("--nexbotframe"); at !== -1; at = received.indexOf("--nexbotframe", at + 1)) frames += 1;
  return frames;
};
// Con la pantalla quieta llega un fotograma cada 2 s. Sin carreras: un read() perdido se comería datos.
const streamTimer = setTimeout(() => stream.controller.abort(), 12_000);
try {
  while (countFrames() < 3) {
    const { value, done } = await reader.read();
    if (done) break;
    received = Buffer.concat([received, value]);
  }
} catch {
  // Ha saltado el límite de tiempo: lo decide la comprobación de abajo.
}
clearTimeout(streamTimer);
const frameCount = countFrames();
check("la emisión entrega fotogramas a través de Next y sandboxd", frameCount >= 3, frameCount);
const streamingStatus = await statusOf(A);
check("el bot cuenta al espectador", streamingStatus?.viewers >= 1, streamingStatus?.viewers);
stream.controller.abort();
await reader.cancel().catch(() => undefined);
let viewersLeft = 1;
for (let attempt = 0; attempt < 40 && viewersLeft !== 0; attempt += 1) {
  await sleep(250);
  viewersLeft = (await statusOf(A))?.viewers;
}
check("al cerrar el visor se libera la emisión", viewersLeft === 0, viewersLeft);
check("la emisión de otra cuenta responde 404", (await fetch(`${APP}/api/bots/${A}/desktop`, { headers: { cookie: stranger.cookie() } })).status === 404);

const crowd = await Promise.all([openStream(), openStream(), openStream(), openStream()]);
for (let attempt = 0; attempt < 40 && (await statusOf(A))?.viewers !== 4; attempt += 1) await sleep(250);
const fifth = await fetch(`${APP}/api/bots/${A}/desktop`, { headers: { cookie: admin.cookie() } });
check("hay un máximo de espectadores", fifth.status === 429, fifth.status);
crowd.forEach((viewer) => viewer.controller.abort());
for (let attempt = 0; attempt < 40 && (await statusOf(A))?.viewers !== 0; attempt += 1) await sleep(250);

// `next dev` bloquea sus recursos de desarrollo para orígenes distintos de localhost.
const uiOut = process.env.E2E_OUT ?? "/tmp";
const uiRaw = execFileSync(
  "docker",
  ["run", "--rm", "--network", "host", "--user", String(process.getuid()), "-e", "HOME=/tmp", "-v", `${new URL("./ui.py", import.meta.url).pathname}:/ui.py:ro`, "-v", `${uiOut}:/out`, "nexus-nexbot:e2e", "python", "/ui.py", APP.replace("127.0.0.1", "localhost"), adminEmail, "contrasena-e2e", A, otherUserId],
  { encoding: "utf8", timeout: 240000 },
);
const ui = JSON.parse(uiRaw.trim().split("\n").pop());
console.log("   interfaz:", JSON.stringify(ui));
check("el visor pinta la emisión en un navegador real", ui.viewerWidth === 1280 && ui.live === true, JSON.stringify(ui));
check("la página de bots lista las tareas", ui.tasksVisible === true, JSON.stringify(ui));
check("el panel de usuarios muestra las cuentas", ui.usersRows >= 2, JSON.stringify(ui));
check("la ficha de usuario abre sus pestañas", ui.detailSessions === true, JSON.stringify(ui));
check("los ajustes muestran los motores de búsqueda", ui.searchProviders === 3, JSON.stringify(ui));
check("el refresco del estado no borra lo que se está escribiendo", ui.configKeepsTyping === true, JSON.stringify(ui));
check("la pestaña avisa de que hay que recrear el contenedor", ui.configPendingNotice === true, JSON.stringify(ui));
const editedInUi = await admin("GET", `/api/bots/${A}`);
check("la pestaña guarda los cambios", editedInUi.json?.bot?.description === "Descripción editada en la web" && editedInUi.json?.bot?.config?.memoryMb === 1792, editedInUi.text.slice(0, 300));
check("lo no editado sigue igual", editedInUi.json?.bot?.config?.persistBrowser === true, editedInUi.text.slice(0, 300));
check("la API informa del cambio pendiente", editedInUi.json?.configPending === true);

const recreatedDesktop = await lifecycle(A, "recreate");
check("recrear el bot conserva el escritorio", recreatedDesktop.json?.bot?.status === "running" && (await statusOf(A))?.desktop?.available === true, recreatedDesktop.text.slice(0, 200));
check("recrear aplica lo editado en la pestaña", inspect(A).HostConfig.Memory === 1792 * 1024 * 1024);
check("y ya no queda nada pendiente", (await admin("GET", `/api/bots/${A}`)).json?.configPending === false);
check("y su captura sigue en el volumen", (await admin("GET", `/api/bots/${A}/files?path=artifacts/pantalla.png&download=1`)).status === 200);

const headlessBot = await admin("POST", "/api/bots", { name: "Sin pantalla", config: { desktop: false } });
const C = headlessBot.json.bot.id;
await lifecycle(C, "start");
check("un bot sin escritorio lo informa", (await statusOf(C))?.desktop?.available === false);
check("su visor responde 409", (await fetch(`${APP}/api/bots/${C}/desktop`, { headers: { cookie: admin.cookie() } })).status === 409);
const headlessRun = await runTask(C, { steps: [{ action: "goto", url: SITE }, { action: "extract", selector: "h1", save_as: "h" }] });
check("y su navegador sigue funcionando sin pantalla", headlessRun.task?.result?.variables?.h === "Formulario de prueba", headlessRun.task?.error);
const headlessClick = await runTask(C, { steps: [{ action: "desktop_key", key: "Return" }] });
check("un paso de escritorio falla con su motivo", /no tiene escritorio/.test(headlessClick.task?.error ?? ""), headlessClick.task?.error);
const removedC = await admin("DELETE", `/api/bots/${C}?purge=1`);
check("borrar un bot recién usado no deja red ni volumen", removedC.status === 200 && docker("volume", "ls", "-q", "--filter", `name=nexus-bot-data-${C}`) === "" && docker("network", "ls", "-q", "--filter", `name=nexus-bot-net-${C}`) === "", removedC.text);

section("Computer use: el modelo ve la pantalla y actúa solo dentro del bot");
// El «modelo» es un simulador (fake_model.py): lo que se prueba es todo lo demás, de punta a punta.
const MODEL = "http://127.0.0.1:18097";
const seen = async () => (await fetch(`${MODEL}/seen`)).json();
const resetModel = () => fetch(`${MODEL}/reset`, { method: "POST" });
const credential = await admin("PUT", "/api/settings", { provider: "lmstudio", model: "simulador", baseUrl: "http://nexbots-e2e-model:8080/v1" });
check("se configura el simulador como modelo", credential.status === 200, credential.text);
const pilot = await admin("POST", "/api/agents", { spec: { name: "Piloto", model: { provider: "lmstudio", model: "simulador" } } });
check("se crea el perfil", pilot.status < 300, pilot.text.slice(0, 300));
const pilotId = pilot.json.agent?.id ?? pilot.json.id;
check("se asigna al bot", (await admin("PATCH", `/api/bots/${A}`, { agentIds: [pilotId] })).status === 200);

const waitComputer = async (id, seconds = 120) => {
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    const got = await admin("GET", `/api/bots/${A}/tasks/${id}`);
    if (got.json?.finished) return got.json;
    await sleep(500);
  }
  return null;
};
await resetModel();
const piloted = await admin("POST", `/api/bots/${A}/tasks`, { kind: "computer", prompt: `Abre ${SITE}/boton y pulsa el botón azul`, maxSteps: 10 });
check("se lanza una tarea de ordenador", piloted.status === 202, piloted.text.slice(0, 300));
const pilotDone = await waitComputer(piloted.json.task.id);
console.log("   tarea:", JSON.stringify({ status: pilotDone?.task?.status, error: pilotDone?.task?.error, result: pilotDone?.task?.result }));
check("la tarea termina bien", pilotDone?.task?.status === "succeeded", JSON.stringify(pilotDone?.task));
check("el modelo encontró el botón en las capturas y vio el cambio", /verde visto/.test(pilotDone?.task?.result?.text ?? ""), JSON.stringify(pilotDone?.task?.result));
const pilotView = await seen();
console.log("   modelo:", JSON.stringify({ ...pilotView, tools: undefined }));
check("el modelo recibe capturas reales de 1280x800", pilotView.images >= 2 && pilotView.sizes.every((size) => size === "1280x800"), JSON.stringify(pilotView.sizes));
check("el base64 no viaja como texto del historial", pilotView.base64InText === false);
const ALLOWED = /^nexbot__(desktop_(screenshot|open_url|click|type|key|scroll|wait)|workspace_(list|read|write))$/;
check("solo se le ofrecen las herramientas de su bot", pilotView.tools.length > 0 && pilotView.tools.every((tool) => ALLOWED.test(tool)), JSON.stringify(pilotView.tools));
check("nada de web, memoria, shell o conectores", !pilotView.tools.some((tool) => /web_|memory|remember|shell|browser_|knowledge/.test(tool)), JSON.stringify(pilotView.tools));
const savedByModel = await admin("GET", `/api/bots/${A}/files?path=artifacts/resultado-modelo.txt&download=1`);
check("lo que guarda queda en el workspace del bot", savedByModel.text === "verde visto", savedByModel.text);
const auditRows = docker("exec", "nexbots-e2e-db", "psql", "-U", "plexo", "-tAc", "SELECT tool || ':' || effect FROM action_audit WHERE tool LIKE 'nexbot__desktop%' GROUP BY 1");
check("cada acción queda auditada", /nexbot__desktop_click:allow/.test(auditRows), auditRows);

await resetModel();
const escapeTry = await admin("POST", `/api/bots/${A}/tasks`, { kind: "computer", prompt: `ESCAPE ${SITE}/fuga`, maxSteps: 6 });
const escapeDone = await waitComputer(escapeTry.json.task.id);
const escapeView = await seen();
console.log("   intento de salida:", JSON.stringify({ status: escapeDone?.task?.status, resultados: escapeView.toolResults }));
check("una herramienta no ofrecida no se ejecuta", escapeView.toolResults.length === 4 && escapeView.toolResults.every((result) => /not found|no encontrad|unknown|desconocid|error|denied/i.test(result)), JSON.stringify(escapeView.toolResults));
const siteHits = await (await runTask(A, { steps: [{ action: "goto", url: `${SITE}/fuga-visitas` }, { action: "extract", selector: "#n", save_as: "n" }] })).task?.result?.variables?.n;
check("el sidecar no llegó a visitar la web pedida", siteHits === "0", siteHits);
const shellMark = await runTask(A, { steps: [{ action: "shell", command: "ls /bot/workspace/fuga 2>/dev/null | wc -l" }] });
check("ni ejecutó comandos en el bot", stdoutOf(shellMark).trim() === "0", stdoutOf(shellMark));

await resetModel();
const looping = await admin("POST", `/api/bots/${A}/tasks`, { kind: "computer", prompt: "BUCLE", maxSteps: 40 });
await sleep(2500);
const second = await admin("POST", `/api/bots/${A}/tasks`, { kind: "computer", prompt: "BUCLE", maxSteps: 40 });
check("solo una tarea de ordenador a la vez por bot", second.status === 409, second.text.slice(0, 200));
check("otra cuenta no puede pararla", (await stranger("POST", `/api/bots/${A}/tasks/${looping.json.task.id}`, { action: "cancel" })).status === 404);
const cancelAsked = await admin("POST", `/api/bots/${A}/tasks/${looping.json.task.id}`, { action: "cancel" });
check("se puede parar", cancelAsked.status === 200, cancelAsked.text.slice(0, 200));
const stoppedDone = await waitComputer(looping.json.task.id, 30);
check("y deja de actuar", isStoppedStatus(stoppedDone?.task?.status), JSON.stringify(stoppedDone?.task));
const callsAtStop = (await seen()).requests;
await sleep(5000);
check("no hay más llamadas al modelo tras parar", (await seen()).requests === callsAtStop, callsAtStop);

const bounded = await admin("POST", `/api/bots/${A}/tasks`, { kind: "computer", prompt: "BUCLE", maxSteps: 3 });
const boundedDone = await waitComputer(bounded.json.task.id, 60);
check("el límite de pasos corta la tarea", boundedDone?.task?.status === "failed" || boundedDone?.task?.status === "error", JSON.stringify(boundedDone?.task));

section("Confinamiento del escritorio");
const typed = (url) => [{ action: "desktop_key", key: "ctrl+l" }, { action: "desktop_type", text: url }, { action: "desktop_key", key: "Return" }];
const allowedNav = await runTask(A, { steps: [{ action: "goto", url: SITE }, ...typed(`${SITE}/whoami`), { action: "wait_for", selector: "#who" }, { action: "extract", selector: "#who", save_as: "w" }] });
check("escribir una URL web en la barra funciona", typeof allowedNav.task?.result?.variables?.w === "string", allowedNav.task?.error);
for (const [name, url] of [["ficheros locales", "file:///etc/passwd"], ["el token por /proc", "file:///proc/self/environ"], ["páginas internas", "chrome://version"]]) {
  const attempt = await runTask(A, { steps: [{ action: "goto", url: SITE }, ...typed(url), { action: "shell", command: "sleep 1" }, { action: "desktop_screenshot", path: `artifacts/bloqueo-${name.split(" ")[0]}.png` }, { action: "extract", selector: "body", save_as: "b" }] });
  const body = attempt.task?.result?.variables?.b ?? "";
  console.log(`   ${url}:`, attempt.task?.status, JSON.stringify(body.slice(0, 120)));
  check(`la barra de direcciones no abre ${name}`, !/root:|NEXBOT_TOKEN|Command Line|Línea de comandos/.test(body) && /blocked|bloquead|administrator|administrador|ERR_BLOCKED/i.test(body), body.slice(0, 200));
}
const xPorts = await runTask(A, { steps: [{ action: "shell", command: "python -c \"import socket; s=socket.socket(); print(s.connect_ex(('127.0.0.1',6099)))\"; ls /etc/nexbot/openbox.xml; which xterm x-terminal-emulator | wc -l" }] });
check("la pantalla no escucha por red y no hay terminal gráfica", /^(111|\d+)\n\/etc\/nexbot\/openbox.xml\n0/.test(stdoutOf(xPorts)) && !stdoutOf(xPorts).startsWith("0\n"), stdoutOf(xPorts));

section("Panel de usuarios");
check("un usuario normal no entra", (await stranger("GET", "/api/admin/users")).status === 403);
const usersList = await admin("GET", "/api/admin/users");
const otherRow = usersList.json?.users?.find((u) => u.id === otherUserId);
check("la lista trae sesiones y actividad", otherRow?.activeSessions >= 1 && otherRow?.lastSeenAt !== null, JSON.stringify(otherRow));
const detail = await admin("GET", `/api/admin/users/${otherUserId}`);
check("la ficha muestra la sesión con su origen", detail.json?.sessions?.[0]?.userAgent?.length > 0, detail.text.slice(0, 300));
check("la ficha no expone hashes de contraseña", !detail.text.includes("passwordHash") && !detail.text.includes("scrypt"));
const noteAndMail = await admin("PATCH", `/api/admin/users/${otherUserId}`, { adminNote: "nota e2e", email: `renombrado${stamp}@e2e.test` });
check("se puede cambiar el correo y dejar una nota", noteAndMail.json?.user?.adminNote === "nota e2e" && noteAndMail.json?.user?.email === `renombrado${stamp}@e2e.test`, noteAndMail.text);
check("un correo repetido se rechaza", (await admin("PATCH", `/api/admin/users/${otherUserId}`, { email: adminEmail })).status === 409);
const sessionId = detail.json.sessions[0].id;
const revokedOne = await admin("DELETE", `/api/admin/users/${otherUserId}/sessions?session=${sessionId}`);
check("se puede cerrar una sesión concreta", revokedOne.json?.revoked === 1, revokedOne.text);
check("y esa persona queda fuera", (await stranger("GET", "/api/bots")).status === 401);
const relog = await stranger("POST", "/api/auth/login", { email: `renombrado${stamp}@e2e.test`, password: "contrasena-e2e" });
check("con el correo nuevo puede volver a entrar", relog.status === 200, relog.text);
const disabled = await admin("PATCH", `/api/admin/users/${otherUserId}`, { disabled: true, disabledReason: "prueba e2e" });
check("desactivar guarda el motivo", disabled.json?.user?.disabledReason === "prueba e2e" && disabled.json?.user?.disabled === true, disabled.text);
check("y expulsa a la persona", (await stranger("GET", "/api/bots")).status === 401);
const bulkEnable = await admin("POST", "/api/admin/users/bulk", { ids: [otherUserId, usersList.json.currentUserId], action: "enable" });
check("la acción masiva aplica y dice qué rechazó", bulkEnable.json?.failed?.length === 0 || bulkEnable.json?.failed?.[0]?.id === usersList.json.currentUserId, bulkEnable.text);
const bulkSelf = await admin("POST", "/api/admin/users/bulk", { ids: [usersList.json.currentUserId], action: "disable" });
check("nadie se desactiva a sí mismo en masa", bulkSelf.json?.failed?.length === 1, bulkSelf.text);
const audited = await admin("GET", `/api/admin/users/${otherUserId}`);
const auditKinds = audited.json?.audit?.map((entry) => entry.action) ?? [];
check("el registro recoge cada acción", auditKinds.includes("user.create") && auditKinds.includes("user.update") && auditKinds.includes("user.sessions_revoked"), JSON.stringify(auditKinds));
check("el registro no guarda secretos", !JSON.stringify(audited.json?.audit).includes("contrasena-e2e"));

section("Motores de búsqueda");
check("un usuario normal no los ve", (await (async () => {
  await stranger("POST", "/api/auth/login", { email: `renombrado${stamp}@e2e.test`, password: "contrasena-e2e" });
  return stranger("GET", "/api/admin/instance/search");
})()).status === 403);
const initialSearch = await admin("GET", "/api/admin/instance/search");
check("por defecto solo SearXNG está activo", initialSearch.json?.providers?.filter((p) => p.enabled).map((p) => p.id).join() === "searxng", initialSearch.text);
const noKey = await admin("PUT", "/api/admin/instance/search", { minResults: 3, providers: [{ id: "brave", enabled: true }] });
check("activar un motor de pago sin clave se rechaza", noKey.status === 400 && /clave/.test(noKey.text), noKey.text);
const KEY = "clave-falsa-e2e-123";
const saved = await admin("PUT", "/api/admin/instance/search", {
  minResults: 2,
  providers: [
    { id: "langsearch", enabled: true, apiKey: KEY },
    { id: "searxng", enabled: true, baseUrl: "http://127.0.0.1:9/" },
    { id: "brave", enabled: false },
  ],
});
check("se guardan el orden y el mínimo", saved.json?.providers?.map((p) => p.id).join() === "langsearch,searxng,brave" && saved.json?.minResults === 2, saved.text);
check("la API nunca devuelve la clave", saved.json?.providers?.[0]?.hasKey === true && !saved.text.includes(KEY), saved.text);
const storedRaw = docker("exec", "nexbots-e2e-db", "psql", "-U", "plexo", "-tAc", "SELECT value::text FROM instance_settings WHERE key='search'");
check("la clave se guarda cifrada", storedRaw.includes("apiKeyEnc") && !storedRaw.includes(KEY));
const langProbe = await admin("POST", "/api/admin/instance/search/test", { id: "langsearch" });
console.log("   LangSearch con clave falsa:", langProbe.text);
check("la prueba llega al servicio real y detecta la clave mala", langProbe.json?.ok === false && /clave|HTTP/.test(langProbe.json?.error ?? ""), langProbe.text);
check("y el error no filtra la clave", !langProbe.text.includes(KEY));
const braveProbe = await admin("POST", "/api/admin/instance/search/test", { id: "brave", apiKey: KEY });
console.log("   Brave con clave falsa:", braveProbe.text);
check("Brave también se puede probar antes de guardar", braveProbe.json?.ok === false && !braveProbe.text.includes(KEY), braveProbe.text);
const searxDown = await admin("POST", "/api/admin/instance/search/test", { id: "searxng" });
check("un SearXNG caído se detecta", searxDown.json?.ok === false, searxDown.text);

section("Configuración de un bot ya creado");
const MB = 1024 * 1024;
const configurable = await admin("POST", "/api/bots", {
  name: "Configurable",
  description: "Descripción original",
  instructions: "Instrucciones originales",
  config: { network: "none", memoryMb: 1024 },
});
const D = configurable.json.bot.id;
const readD = async () => (await admin("GET", `/api/bots/${D}`)).json;
const patchD = (body) => admin("PATCH", `/api/bots/${D}`, body);
const envD = () => inspect(D).Config.Env.join("\n");
const egressOnD = () => Object.values(JSON.parse(docker("network", "inspect", `nexus-bot-net-${D}`))[0].Containers ?? {}).some((c) => c.Name === "nexbots-e2e-egress");
await lifecycle(D, "start");
let stateD = await readD();
check("recién arrancado no hay cambios pendientes", stateD.configPending === false, JSON.stringify(stateD).slice(0, 300));
check("arranca sin proxy", !envD().includes("NEXBOT_PROXY") && !egressOnD());

const assignedD = await patchD({ agentIds: [pilotId] });
stateD = await readD();
check("asignar un perfil funciona", assignedD.status === 200 && stateD.agents.length === 1, assignedD.text.slice(0, 300));
check("asignar un perfil no borra descripción ni instrucciones", stateD.bot.description === "Descripción original" && stateD.bot.instructions === "Instrucciones originales", JSON.stringify(stateD.bot));
check("asignar un perfil no devuelve internet a un bot sin red", stateD.bot.config.network === "none" && stateD.bot.config.memoryMb === 1024, JSON.stringify(stateD.bot.config));

const idD = inspect(D).Id;
const editedD = await patchD({ instructions: "Instrucciones nuevas", config: { network: "restricted", memoryMb: 1536 } });
stateD = await readD();
check("se edita un bot ya creado", editedD.status === 200 && stateD.bot.instructions === "Instrucciones nuevas", editedD.text.slice(0, 300));
check("un cambio parcial conserva el resto", stateD.bot.description === "Descripción original" && stateD.bot.config.desktop === true && stateD.bot.config.cpus === 1 && stateD.agents.length === 1, JSON.stringify(stateD.bot));
check("avisa de que falta aplicarlo", stateD.configPending === true);
check("guardar no toca el contenedor en marcha", inspect(D).Id === idD && inspect(D).HostConfig.Memory === 1024 * MB && !envD().includes("NEXBOT_PROXY"));

const invalidD = await patchD({ config: { memoryMb: 99999 } });
check("rechaza valores fuera de margen", invalidD.status === 400 && (await readD()).bot.config.memoryMb === 1536, invalidD.text);
const strangerD = await stranger("PATCH", `/api/bots/${D}`, { config: { network: "restricted", memoryMb: 512 } });
check("otra cuenta no puede editarlo", strangerD.status >= 401 && strangerD.status <= 404 && (await readD()).bot.config.memoryMb === 1536, `${strangerD.status}`);

const recreatedD = await lifecycle(D, "recreate");
check("recrear aplica los cambios", recreatedD.json?.bot?.status === "running" && inspect(D).HostConfig.Memory === 1536 * MB, recreatedD.text.slice(0, 200));
check("incluida la salida a internet", envD().includes("NEXBOT_PROXY=") && egressOnD());
check("ya no hay cambios pendientes", (await readD()).configPending === false);

await patchD({ config: { network: "none" } });
await lifecycle(D, "stop");
check("también avisa con el bot parado", (await readD()).configPending === true);
const restartedD = await lifecycle(D, "start");
check("arrancar aplica lo guardado", restartedD.json?.bot?.status === "running" && (await readD()).configPending === false, restartedD.text.slice(0, 200));
check("quitar internet desconecta el proxy de verdad", !envD().includes("NEXBOT_PROXY") && !egressOnD());
const offlineD = await runTask(D, { steps: [{ action: "goto", url: SITE }] });
check("y el bot ya no alcanza ninguna web", offlineD.task?.status === "failed", JSON.stringify(offlineD.task?.status));
const removedD = await admin("DELETE", `/api/bots/${D}?purge=1`);
check("y su borrado tampoco deja restos", removedD.status === 200 && docker("volume", "ls", "-q", "--filter", `name=nexus-bot-data-${D}`) === "" && docker("network", "ls", "-q", "--filter", `name=nexus-bot-net-${D}`) === "", removedD.text);


section("Salas: foro con varios bots");
const psql = (query) => docker("exec", "nexbots-e2e-db", "psql", "-U", "plexo", "-tAc", query);
const mkBot = async (name, config = {}) => (await admin("POST", "/api/bots", { name, description: `Bot ${name}`, config })).json.bot.id;
const ANA = await mkBot("Ana");
const LEO = await mkBot("Leo");
for (const id of [ANA, LEO]) await admin("PATCH", `/api/bots/${id}`, { agentIds: [pilotId] });
const startedAna = await lifecycle(ANA, "start");
const startedLeo = await lifecycle(LEO, "start");
check("arrancan los bots de la sala", startedAna.json?.bot?.status === "running" && startedLeo.json?.bot?.status === "running", `${startedAna.text} ${startedLeo.text}`.slice(0, 300));

const madeRoom = await admin("POST", "/api/rooms", { name: "Equipo", description: "Sala e2e", botIds: [ANA, LEO] });
check("se crea una sala con dos bots", madeRoom.status === 201, madeRoom.text.slice(0, 300));
const ROOM = madeRoom.json.room.id;
const R = `/api/rooms/${ROOM}`;
const outsider = client();
await admin("POST", "/api/admin/users", { email: `sala${stamp}@e2e.test`, password: "contrasena-e2e", role: "user" });
check("entra otra cuenta", (await outsider("POST", "/api/auth/login", { email: `sala${stamp}@e2e.test`, password: "contrasena-e2e" })).status === 200);
check("otra cuenta no ve la sala", (await outsider("GET", R)).status === 404);
check("ni puede escribir en ella", (await outsider("POST", `${R}/topics`, { title: "intruso" })).status === 404);
const foreignRoom = await outsider("POST", "/api/rooms", { name: "Ajena", botIds: [ANA] });
check("ni meter bots ajenos en una sala suya", foreignRoom.status === 400, foreignRoom.text);
const overview = async () => (await admin("GET", R)).json;
const topicOf = async (id) => (await admin("GET", `${R}/topics/${id}`)).json;
const mkTopic = async (body) => (await admin("POST", `${R}/topics`, body)).json.topic.id;
const say = (id, text) => admin("POST", `${R}/topics/${id}/messages`, { text });
const patchTopic = (id, body) => admin("PATCH", `${R}/topics/${id}`, body);
const botMessages = (detail) => detail.messages.filter((m) => m.role === "assistant");
/** Espera a que el hilo se quede quieto (sin turnos activos ni en cola) con al menos `n` respuestas. */
const settle = async (id, n, seconds = 90) => {
  let detail;
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    detail = await topicOf(id);
    const moving = detail.turns.some((t) => t.status === "running" || t.status === "queued");
    if (!moving && botMessages(detail).length >= n) return detail;
    await sleep(500);
  }
  return detail;
};

const T0 = await mkTopic({ title: "Vacío" });
await resetModel();
const T1 = await mkTopic({ title: "Datos", text: "nota inicial sin mención" });
await sleep(2500);
check("sin mención ni responsable el mensaje queda como nota", botMessages(await topicOf(T1)).length === 0 && (await seen()).requests === 0);

const asked = await say(T1, "@ana PIDE los datos a quien los tenga");
check("mencionar despierta solo al mencionado", asked.status === 201 && JSON.stringify(asked.json.woken) === JSON.stringify([ANA]), asked.text);
const talk = await settle(T1, 2);
const replies = botMessages(talk);
console.log("   hilo:", JSON.stringify(replies.map((m) => [m.botId === ANA ? "ana" : m.botId === LEO ? "leo" : "?", m.content.slice(0, 50)])));
check("responden en orden: primero Ana, luego Leo", replies.length === 2 && replies[0].botId === ANA && replies[1].botId === LEO, JSON.stringify(replies.map((m) => m.botId)));
check("Leo ya leyó lo que dijo Ana", /42/.test(replies[1].content));
check("una mención dentro de código no despierta a nadie", replies.length === 2);
const roomSeen = (await seen()).room;
check("lo de otro bot le llega marcado como no confiable", roomSeen.leo?.untrusted === true && roomSeen.ana?.untrusted === false, JSON.stringify({ leo: roomSeen.leo?.untrusted, ana: roomSeen.ana?.untrusted }));
check("cada bot sabe quién es y con quién está", /Eres Ana \(@ana\)/.test(roomSeen.ana?.system ?? "") && /Eres Leo \(@leo\)/.test(roomSeen.leo?.system ?? ""), roomSeen.ana?.system);
const ROOM_ALLOWED = /^(nexbot__(desktop_(screenshot|open_url|click|type|key|scroll|wait)|workspace_(list|read|write))|board_(list|create_subtask|set_status|assign|add_blocker))$/;
check("en la sala solo tienen su entorno y el tablero", roomSeen.ana.tools.length >= 10 && roomSeen.ana.tools.every((tool) => ROOM_ALLOWED.test(tool)), JSON.stringify(roomSeen.ana.tools));
const roundRows = psql(`SELECT count(DISTINCT group_id) || '|' || count(*) || '|' || count(parent_run_id) FROM runs WHERE thread_id = (SELECT thread_id FROM room_topics WHERE id = '${T1}')`);
check("el razonamiento que publica el modelo se guarda con su mensaje, aparte del texto", replies.every((m) => /pienso en el hilo/.test(m.reasoning ?? "") && !/pienso en el hilo/.test(m.content)), JSON.stringify(replies.map((m) => m.reasoning)));
check("los dos turnos son de la misma ronda y el segundo cuelga del primero", roundRows === "1|2|1", roundRows);
check("los hilos de sala no aparecen en la lista ni en la búsqueda del chat", !(await admin("GET", "/api/threads")).text.includes('"Datos"') && !(await admin("GET", "/api/threads?q=Datos")).text.includes('"Datos"'));
const both = await say(T0, "@leo y @ana, decid algo");
check("mencionar a dos da la palabra a los dos, en el orden escrito", JSON.stringify(both.json.woken) === JSON.stringify([LEO, ANA]) && botMessages(await settle(T0, 2)).map((m) => m.botId).join() === [LEO, ANA].join());

await patchTopic(T1, { assigneeBotId: LEO });
const assigned = await settle(T1, 3);
check("asignar una tarea despierta a su responsable", botMessages(assigned).at(-1)?.botId === LEO, JSON.stringify(botMessages(assigned).map((m) => m.botId)));
const plain = await say(T1, "hola, sin mención");
check("sin mención responde el responsable", JSON.stringify(plain.json.woken) === JSON.stringify([LEO]) && botMessages(await settle(T1, 4)).at(-1)?.botId === LEO);

const violates = (query) => {
  try {
    psql(query);
    return false;
  } catch (error) {
    return /duplicate key|llave duplicada/.test(String(error.stderr ?? error.message));
  }
};
const turnRow = (topic, bot) => `INSERT INTO room_turns (topic_id, bot_id, round_id, status) VALUES ('${topic}', '${bot}', gen_random_uuid(), 'running')`;
const roomThread = psql(`SELECT thread_id FROM room_topics WHERE id = '${T1}'`);
const viaChat = await admin("POST", "/api/chat", { threadId: roomThread, message: "hola", text: "hola" });
check("un hilo de sala no se puede usar desde el chat normal", viaChat.status === 400, `${viaChat.status} ${viaChat.text.slice(0, 120)}`);
check("la base de datos no admite dos turnos activos en un hilo", violates(`${turnRow(T1, ANA)}; ${turnRow(T1, LEO)}`));
check("ni que un bot hable en dos hilos a la vez", violates(`${turnRow(T1, ANA)}; ${turnRow(T0, ANA)}`));
check("y no quedó nada de esas pruebas", psql("SELECT count(*) FROM room_turns WHERE status = 'running'") === "0");

section("Salas: los bots se dan la palabra, con límites");
await admin("PATCH", R, { limits: { maxHops: 2 } });
await resetModel();
const T2 = await mkTopic({ title: "Bucle" });
await say(T2, "@ana BUCLE-SALA");
const waitNotice = async (id, kind, count, seconds = 90) => {
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    const detail = await topicOf(id);
    if (detail.messages.filter((m) => m.notice?.kind === kind).length >= count) return detail;
    await sleep(500);
  }
  return topicOf(id);
};
const looped = await waitNotice(T2, "limit", 1);
check("un bucle entre bots se corta en el límite", botMessages(looped).length === 3 && looped.turns.filter((t) => t.status === "held").length === 1, JSON.stringify({ respuestas: botMessages(looped).length, turnos: looped.turns }));
check("y se alternan", botMessages(looped).map((m) => (m.botId === ANA ? "a" : "l")).join("") === "ala");
const callsAtLimit = (await seen()).requests;
await sleep(4000);
check("retenido, nadie gasta más tokens", (await seen()).requests === callsAtLimit, callsAtLimit);
const resumed = await admin("POST", `${R}/topics/${T2}/round`, { action: "continue" });
check("«Continuar» abre otra ronda", resumed.status === 200 && resumed.json.turns === 1, resumed.text);
const loopedAgain = await waitNotice(T2, "limit", 2);
check("que también respeta el límite", botMessages(loopedAgain).length === 6, botMessages(loopedAgain).length);
psql(turnRow(T0, ANA));
const computerWhileTalking = await admin("POST", `/api/bots/${ANA}/tasks`, { kind: "computer", prompt: "BUCLE", maxSteps: 3 });
check("un bot con un turno de sala en marcha no acepta a la vez una tarea de ordenador", computerWhileTalking.status === 409, computerWhileTalking.text.slice(0, 200));
psql(`DELETE FROM room_turns WHERE topic_id = '${T0}'`);
await admin("POST", `${R}/topics/${T2}/round`, { action: "continue" });
await sleep(1200);
const stoppedRound = await admin("POST", `${R}/topics/${T2}/round`, { action: "stop" });
check("«Parar» corta la conversación", stoppedRound.status === 200, stoppedRound.text);
await sleep(3000);
const callsAtStopRoom = (await seen()).requests;
await sleep(4000);
const afterStop = await topicOf(T2);
check("y deja de haber turnos y llamadas al modelo", afterStop.turns.length === 0 && (await seen()).requests === callsAtStopRoom, JSON.stringify(afterStop.turns));
await admin("PATCH", R, { limits: { maxHops: 6 } });

section("Salas: un turno sigue confinado a su bot");
await resetModel();
const hitsBefore = (await runTask(A, { steps: [{ action: "goto", url: `${SITE}/fuga-visitas` }, { action: "extract", selector: "#n", save_as: "n" }] })).task?.result?.variables?.n;
const T3 = await mkTopic({ title: "Fuga" });
await say(T3, `@ana FUGA-SALA ${SITE}/fuga`);
const escaped = await settle(T3, 1);
const escapeSeen = (await seen()).room.ana;
console.log("   intento de salida en sala:", JSON.stringify(escapeSeen?.toolResults));
check("lo que no se le ofrece no se ejecuta", escapeSeen?.toolResults?.length === 4 && escapeSeen.toolResults.every((result) => /not found|no encontrad|unknown|desconocid|error|denied/i.test(result)), JSON.stringify(escapeSeen?.toolResults));
const hitsAfter = (await runTask(A, { steps: [{ action: "goto", url: `${SITE}/fuga-visitas` }, { action: "extract", selector: "#n", save_as: "n" }] })).task?.result?.variables?.n;
check("el sidecar no visitó la web pedida", hitsBefore === hitsAfter, `${hitsBefore} → ${hitsAfter}`);
const anaFiles = await admin("GET", `/api/bots/${ANA}/files?path=`);
check("ni se ejecutó ningún comando en el bot", !anaFiles.text.includes("fuga-sala"), anaFiles.text.slice(0, 200));
check("el turno termina con normalidad", botMessages(escaped).at(-1)?.content === "intento terminado");

await resetModel();
const T7 = await mkTopic({ title: "Pantalla" });
await say(T7, `@ana ESCRITORIO abre ${SITE}/boton y pulsa el botón azul`);
const desk = await settle(T7, 1, 120);
const deskSeen = await seen();
check("en la sala el bot ve su pantalla y actúa sobre ella", /verde visto/.test(botMessages(desk).at(-1)?.content ?? "") && deskSeen.images >= 2, JSON.stringify({ texto: botMessages(desk).at(-1)?.content, imagenes: deskSeen.images }));
check("y sus pasos quedan guardados con el mensaje", (botMessages(desk).at(-1)?.tools ?? []).some((tool) => tool.name === "nexbot__desktop_click"));
const activity = await admin("GET", `/api/bots/${ANA}/activity`);
check("la actividad del bot recoge ese turno", activity.json?.runs?.[0]?.initiator === "room" && activity.json.runs[0].tools.length >= 3, activity.text.slice(0, 200));
check("otra cuenta no ve la actividad", (await outsider("GET", `/api/bots/${ANA}/activity`)).status === 404);
const roomAudit = psql("SELECT rule || ':' || effect FROM action_audit WHERE rule IN ('deny-room-outside', 'allow-room') GROUP BY 1 ORDER BY 1");
check("la política de sala decide y audita cada herramienta", /allow-room:allow/.test(roomAudit), roomAudit);

section("Salas: tablero");
await resetModel();
const T4 = await mkTopic({ title: "Informe", assigneeBotId: ANA, status: "backlog" });
await settle(T4, 1);
check("una tarea asignada pasa a «en curso» cuando su bot empieza", (await overview()).topics.find((t) => t.id === T4)?.status === "in_progress");
await say(T4, "@ana TABLERO reparte el trabajo");
const boardTalk = await settle(T4, 2);
const boardReply = botMessages(boardTalk).at(-1)?.content ?? "";
console.log("   tablero:", boardReply.slice(0, 160));
let board = await overview();
const sub = board.topics.find((t) => t.parentTopicId === T4);
check("un bot crea una subtarea y la asigna a otro", sub?.title === "Reunir cifras" && sub.assigneeBotId === LEO && sub.createdByBotId === ANA, JSON.stringify(sub));
check("puede pasar su tarea a revisión", board.topics.find((t) => t.id === T4)?.status === "in_review");
check("pero no cerrarla: eso es cosa de una persona", /persona|operador/i.test(boardReply), boardReply);
const subTalk = await settle(sub.id, 2);
check("el bot asignado recibe su turno en la subtarea", botMessages(subTalk).at(-1)?.botId === LEO && /subtarea hecha/.test(botMessages(subTalk).at(-1)?.content ?? ""), JSON.stringify(botMessages(subTalk).map((m) => m.content)));
const sameRound = psql(`SELECT count(DISTINCT group_id) FROM runs WHERE id IN (SELECT run_id FROM room_turns WHERE topic_id = '${sub.id}') OR id = (SELECT run_id FROM room_turns WHERE topic_id = '${T4}' ORDER BY created_at DESC LIMIT 1)`);
check("lo delegado sigue en la misma ronda, con sus límites", sameRound === "1", sameRound);
const closedSub = await patchTopic(sub.id, { status: "done" });
check("la persona cierra la subtarea", closedSub.status === 200);
const parentTalk = await settle(T4, 3);
check("al terminar las subtareas se avisa al responsable de la tarea", /todo cerrado/.test(botMessages(parentTalk).at(-1)?.content ?? ""), botMessages(parentTalk).at(-1)?.content);

const T6 = await mkTopic({ title: "Previa" });
const T5 = await mkTopic({ title: "Dependiente" });
check("se marca un bloqueo", (await patchTopic(T5, { blockedByIds: [T6], status: "blocked" })).status === 200);
check("un ciclo de bloqueos se rechaza", (await patchTopic(T6, { blockedByIds: [T5] })).status === 400);
await patchTopic(T5, { assigneeBotId: LEO });
await sleep(2500);
check("una tarea bloqueada no despierta a su responsable", botMessages(await topicOf(T5)).length === 0);
await patchTopic(T6, { status: "done" });
const unblocked = await settle(T5, 1);
check("al resolverse el bloqueo se desbloquea y despierta", /desbloqueada/.test(botMessages(unblocked).at(-1)?.content ?? "") && ["todo", "in_progress"].includes((await overview()).topics.find((t) => t.id === T5)?.status), JSON.stringify(botMessages(unblocked).map((m) => m.content)));

const otherRoom = (await admin("POST", "/api/rooms", { name: "Otra", botIds: [LEO] })).json.room.id;
const foreignTopic = (await admin("POST", `/api/rooms/${otherRoom}/topics`, { title: "Ajena" })).json.topic.id;
const T8 = await mkTopic({ title: "Cruce" });
await say(T8, `@ana OTRASALA ${foreignTopic}`);
const crossed = botMessages(await settle(T8, 1)).at(-1)?.content ?? "";
check("un bot no alcanza tarjetas de otra sala", /no existe en esta sala/.test(crossed) && (await admin("GET", `/api/rooms/${otherRoom}`)).json.topics[0].status === "todo", crossed);
const reopened = await say(T6, "se reabre");
check("escribir en una tarea cerrada la reabre", reopened.status === 201 && (await overview()).topics.find((t) => t.id === T6)?.status === "todo");
const activityRows = psql(`SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM room_activity WHERE room_id = '${ROOM}'`);
check("el tablero deja registro de quién hizo qué", ["assigned", "status_changed", "topic_created", "unblocked"].every((action) => activityRows.includes(action)), activityRows);

section("Salas: interfaz, miembros y redes");
const DRAG = await mkTopic({ title: "Arrastrable" });
const IDLE = await mkBot("Recién creado");
await lifecycle(IDLE, "start");
const roomUiRaw = execFileSync(
  "docker",
  ["run", "--rm", "--network", "host", "--user", String(process.getuid()), "-e", "HOME=/tmp", "-v", `${new URL("./ui_room.py", import.meta.url).pathname}:/ui.py:ro`, "-v", `${uiOut}:/out`, "nexus-nexbot:e2e", "python", "/ui.py", APP.replace("127.0.0.1", "localhost"), adminEmail, "contrasena-e2e", ROOM, T1, DRAG, IDLE],
  { encoding: "utf8", timeout: 300000 },
);
const roomUi = JSON.parse(roomUiRaw.trim().split("\n").pop());
console.log("   interfaz de sala:", JSON.stringify(roomUi));
check("un bot que aún no ha abierto nada lo explica en vez de mostrar una pantalla negra", roomUi.idleHint === true);
check("el razonamiento se ve en la actividad del bot", roomUi.reasoningShown === true);
check("en una pantalla estrecha el panel no aplasta la conversación ni se corta", roomUi.narrow?.composer >= 380 && roomUi.narrow.panelOverflow <= 0 && roomUi.narrow.pageOverflow <= 0, JSON.stringify(roomUi.narrow));
check("el panel se puede ensanchar", roomUi.resized === true);
await admin("POST", `${R}/members`, { botId: IDLE });
const NOPROFILE = await mkTopic({ title: "Sin perfil" });
await say(NOPROFILE, "@recien-creado ¿me oyes?");
const noProfileTalk = await settle(NOPROFILE, 1);
check("un bot sin perfil responde con el modelo por defecto de su dueño", botMessages(noProfileTalk).at(-1)?.botId === IDLE && psql(`SELECT count(*) FROM runs WHERE bot_id = '${IDLE}' AND agent_id IS NULL AND status = 'completed'`) === "1", JSON.stringify(noProfileTalk.messages.map((m) => m.content)));
const noProfileTask = await admin("POST", `/api/bots/${IDLE}/tasks`, { kind: "computer", prompt: `Abre ${SITE}/boton y pulsa el botón azul`, maxSteps: 10 });
check("y acepta tareas de ordenador sin perfil", noProfileTask.status === 202, noProfileTask.text.slice(0, 200));
for (let attempt = 0; attempt < 120; attempt += 1) {
  const got = await admin("GET", `/api/bots/${IDLE}/tasks/${noProfileTask.json.task.id}`);
  if (got.json?.finished) {
    check("que terminan bien", got.json.task.status === "succeeded" && /verde visto/.test(got.json.task.result?.text ?? ""), JSON.stringify(got.json.task));
    break;
  }
  await sleep(500);
}
await admin("DELETE", `/api/bots/${IDLE}?purge=1`);
check("la sala aparece en NexBots", roomUi.roomListed === true);
check("y en la barra lateral, en su propia sección junto a los chats", roomUi.sidebarSection === true && roomUi.sidebarOpensRoom === true, JSON.stringify(roomUi));
check("cada mensaje muestra a su autor", roomUi.authors === true);
check("escribir @ ofrece los bots de la sala y los inserta", roomUi.mentionOptions === 1 && roomUi.mentionInserted === "hola @leo ", JSON.stringify(roomUi));
check("el compositor dice quién va a responder", /responde Leo/.test(roomUi.hint ?? ""), roomUi.hint);
check("el panel derecho abre el escritorio del bot en directo", roomUi.panelDesktop === 1280, roomUi.panelDesktop);
check("y su actividad y configuración", roomUi.panelActivity >= 1 && roomUi.panelConfig === "Ana", JSON.stringify(roomUi));
check("el tablero tiene sus siete columnas", roomUi.columns === 7, roomUi.columns);
check("las tarjetas se mueven arrastrando y con el selector", roomUi.dragged === true && roomUi.movedWithSelect === true && (await overview()).topics.find((t) => t.id === DRAG)?.status === "blocked", JSON.stringify(roomUi));

const ISO = await mkBot("Aislado", { network: "none" });
section("NexBots desde un chat normal");
await resetModel();
const chatThread = (await admin("POST", "/api/threads", {})).json;
const chatThreadId = chatThread.thread?.id ?? chatThread.id;
const viaMention = await admin("POST", "/api/chat", { threadId: chatThreadId, text: `@ana ESCRITORIO abre ${SITE}/boton y pulsa el botón azul` });
check("mencionar a un bot en un chat le da ese turno", viaMention.status === 200 && /RUN_FINISHED/.test(viaMention.text), `${viaMention.status} ${viaMention.text.slice(0, 200)}`);
const chatMessages = (await admin("GET", `/api/threads/${chatThreadId}`)).json.messages;
check("el bot trabaja en su escritorio y responde en el chat", /verde visto/.test(chatMessages.at(-1)?.content ?? ""), JSON.stringify(chatMessages.map((m) => m.content)));
const chatSeen = await seen();
check("en el chat solo tiene su propio entorno, sin tablero ni web", chatSeen.tools.length >= 10 && chatSeen.tools.every((tool) => ALLOWED.test(tool)), JSON.stringify(chatSeen.tools));
check("el run queda atado al bot", psql(`SELECT initiator || '|' || (bot_id = '${ANA}') || '|' || computer FROM runs WHERE thread_id = '${chatThreadId}'`) === "user|true|false");
check("y su mensaje, firmado por él", psql(`SELECT count(*) FROM messages WHERE thread_id = '${chatThreadId}' AND bot_id = '${ANA}'`) === "1");
const plainChat = await admin("POST", "/api/chat", { threadId: chatThreadId, text: "gracias" });
check("sin mención, el chat sigue siendo un chat normal", plainChat.status === 200 && psql(`SELECT count(*) FROM runs WHERE thread_id = '${chatThreadId}' AND bot_id IS NULL`) === "1", `${plainChat.status}`);
psql(turnRow(T0, ANA));
const busyChat = await admin("POST", "/api/chat", { threadId: chatThreadId, text: "@ana ¿sigues?" });
check("un bot ocupado en una sala lo dice en vez de pisarse", busyChat.status === 409 && /ocupado/.test(busyChat.text), `${busyChat.status} ${busyChat.text.slice(0, 120)}`);
psql(`DELETE FROM room_turns WHERE topic_id = '${T0}' AND status = 'running'`);
const stoppedChat = await admin("POST", "/api/chat", { threadId: chatThreadId, text: "@aislado ¿estás?" });
check("un bot parado avisa de que hay que arrancarlo", stoppedChat.status === 409 && /no está en marcha/.test(stoppedChat.text), `${stoppedChat.status} ${stoppedChat.text.slice(0, 120)}`);
const outsiderThread = (await outsider("POST", "/api/threads", {})).json;
const outsiderChat = await outsider("POST", "/api/chat", { threadId: outsiderThread.thread?.id ?? outsiderThread.id, text: "@ana haz algo" });
check("otra cuenta no puede llamar a un bot ajeno", outsiderChat.status === 404, `${outsiderChat.status} ${outsiderChat.text.slice(0, 120)}`);

const mixedTry = await admin("POST", `${R}/members`, { botId: ISO });
check("mezclar un bot sin internet con otros con internet pide confirmación", mixedTry.status === 409 && mixedTry.json?.code === "mixed_network", mixedTry.text);
check("y con ella se añade", (await admin("POST", `${R}/members`, { botId: ISO, confirmMixedNetwork: true })).status === 200 && (await overview()).members.length === 3);
check("un bot parado avisa en vez de responder", (await say(T0, "@aislado ¿estás?")).status === 201 && (await waitNotice(T0, "bot_stopped", 1, 20)).messages.some((m) => m.notice?.kind === "bot_stopped"));
await admin("DELETE", `${R}/members?botId=${LEO}`);
board = await overview();
check("quitar un bot lo saca de la sala y de sus tareas", !board.members.some((m) => m.id === LEO) && !board.topics.some((t) => t.assigneeBotId === LEO), JSON.stringify(board.members.map((m) => m.slug)));
check("y ya no se le puede mencionar", JSON.stringify((await say(T0, "@leo ¿sigues?")).json.woken) === "[]");
const roomGone = await admin("DELETE", R);
check("borrar la sala borra sus hilos", roomGone.status === 200 && psql(`SELECT count(*) FROM threads WHERE origin = 'room' AND id NOT IN (SELECT thread_id FROM room_topics)`) === "0" && (await admin("GET", R)).status === 404, roomGone.text);
await admin("DELETE", `/api/rooms/${otherRoom}`);
for (const id of [ANA, LEO, ISO]) await admin("DELETE", `/api/bots/${id}?purge=1`);
check("los bots de la sala se borran sin dejar restos", [ANA, LEO, ISO].every((id) => docker("volume", "ls", "-q", "--filter", `name=nexus-bot-data-${id}`) === "" && docker("network", "ls", "-q", "--filter", `name=nexus-bot-net-${id}`) === ""));

section("Limpieza por la API");
const removeA = await admin("DELETE", `/api/bots/${A}`);
check("borrar sin purge conserva el volumen", removeA.status === 200 && docker("volume", "ls", "-q", "--filter", `name=nexus-bot-data-${A}`) !== "", removeA.text);
const removeB = await admin("DELETE", `/api/bots/${B}?purge=1`);
check("borrar con purge elimina el volumen", removeB.status === 200 && docker("volume", "ls", "-q", "--filter", `name=nexus-bot-data-${B}`) === "", removeB.text);
check("no quedan contenedores ni redes de esos bots", docker("ps", "-aq", "--filter", "label=nexus.e2e.bot").length === 0 && docker("network", "ls", "-q", "--filter", `name=nexus-bot-net-${A}`) === "");
docker("volume", "rm", `nexus-bot-data-${A}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas`);
for (const item of failed) console.log(`  FALLO: ${item.name}  ${String(item.detail).slice(0, 300)}`);
process.exit(failed.length ? 1 : 0);
