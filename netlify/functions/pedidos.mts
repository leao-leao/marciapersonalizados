// Pedidos do catálogo.
// Público: POST cria o pedido; POST ?fotos=<id> anexa as fotos de referência do cliente (até 1 hora depois).
// Com a senha do painel: GET lista, GET ?foto=<id>/<chave> devolve uma foto de referência, PATCH atualiza, DELETE exclui.
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner, json } from "../lib/auth.mts";

const STATUS = ["novo", "confirmado", "producao", "pronto", "entregue", "cancelado"];
const ID_RE = /^MP\d{6}-[A-Z0-9]{4}$/;
const FOTO_KEY_RE = /^\d{1,2}-\d$/;
const MAX_BODY = 40_000;
const MAX_FOTOS_BODY = 4_000_000;
const MAX_FOTO_BYTES = 600_000;

const store = () => getStore({ name: "pedidos", consistency: "strong" });
const fotos = () => getStore({ name: "pedidos-fotos", consistency: "strong" });
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => {
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : 0;
};

async function readBody(req: Request, max = MAX_BODY) {
  const raw = await req.text();
  if (raw.length > max) throw new Error("grande");
  return JSON.parse(raw);
}

async function criar(req: Request) {
  let b: any;
  try { b = await readBody(req); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const id = txt(b?.id, 20);
  if (!ID_RE.test(id)) return json({ erro: "Número do pedido inválido." }, 400);
  const c = b.cliente || {};
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 40).map((i: any) => {
    const produtoId = txt(i?.produtoId, 60);
    const foto = txt(i?.foto, 160);
    return {
      produto: txt(i?.produto, 120),
      produtoId: /^[\w-]+$/.test(produtoId) ? produtoId : "",
      foto: /^img\/[\w\/.-]+\.(jpg|jpeg|png|webp)$/i.test(foto) && !foto.includes("..") ? foto : "",
      qtd: Math.max(0, Math.round(Number(i?.qtd) || 0)),
      unidade: txt(i?.unidade, 20),
      total: num(i?.total),
      personalizacao: txt(i?.personalizacao, 600),
      refs: Math.max(0, Math.min(10, Math.round(Number(i?.refs) || 0))),
    };
  }).filter((i: any) => i.produto && i.qtd > 0);
  const tel = txt(c.tel, 20).replace(/\D/g, "");
  if (!itens.length || !txt(c.nome, 1) || tel.length < 10) return json({ erro: "Pedido incompleto." }, 400);

  const pedido = {
    id,
    criadoEm: new Date().toISOString(),
    status: "novo",
    obs: "",
    cliente: {
      nome: txt(c.nome, 120),
      tel,
      email: txt(c.email, 120),
      endereco: txt(c.endereco, 400),
    },
    entrega: txt(b.entrega, 60),
    dataEvento: /^\d{4}-\d{2}-\d{2}$/.test(txt(b.dataEvento, 10)) ? txt(b.dataEvento, 10) : "",
    itens,
    fotos: [] as string[],
    total: num(b.total),
  };
  const { modified } = await store().setJSON(id, pedido, { onlyIfNew: true });
  return json({ id, salvo: modified }, modified ? 201 : 200);
}

// Fotos de referência: aceitas só logo depois do pedido, no máximo 3 por item.
async function anexarFotos(req: Request, id: string) {
  if (!ID_RE.test(id)) return json({ erro: "Número do pedido inválido." }, 400);
  let b: any;
  try { b = await readBody(req, MAX_FOTOS_BODY); } catch { return json({ erro: "Fotos grandes demais." }, 413); }
  const s = store();
  const pedido: any = await s.get(id, { type: "json" });
  if (!pedido) return json({ erro: "Pedido não encontrado." }, 404);
  if (Date.now() - Date.parse(pedido.criadoEm) > 60 * 60 * 1000) return json({ erro: "Prazo para enviar fotos encerrado." }, 403);
  const lista = (Array.isArray(b?.fotos) ? b.fotos : []).slice(0, 30);
  const salvas = new Set<string>(pedido.fotos || []);
  for (const f of lista) {
    const item = Math.round(Number(f?.item)), k = Math.round(Number(f?.k));
    if (!(item >= 0 && item < pedido.itens.length && k >= 0 && k < 3)) continue;
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(f?.data || ""));
    if (!m) continue;
    const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > MAX_FOTO_BYTES) continue;
    const chave = `${item}-${k}`;
    await fotos().set(`${id}/${chave}`, bytes, { metadata: { tipo: `image/${m[1]}` } });
    salvas.add(chave);
  }
  pedido.fotos = [...salvas].sort();
  await s.setJSON(id, pedido);
  return json({ fotos: pedido.fotos });
}

async function verFoto(ref: string) {
  const [id, chave] = ref.split("/");
  if (!ID_RE.test(id || "") || !FOTO_KEY_RE.test(chave || "")) return json({ erro: "Foto inválida." }, 400);
  const entrada = await fotos().getWithMetadata(`${id}/${chave}`, { type: "arrayBuffer" });
  if (entrada === null) return json({ erro: "Foto não encontrada." }, 404);
  return new Response(entrada.data as ArrayBuffer, {
    headers: { "content-type": String(entrada.metadata?.tipo || "image/jpeg"), "cache-control": "private, max-age=3600" },
  });
}

async function listar() {
  const s = store();
  const { blobs } = await s.list();
  const pedidos = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
  pedidos.sort((a: any, b: any) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  return json({ pedidos });
}

async function atualizar(req: Request) {
  let b: any;
  try { b = await readBody(req); } catch { return json({ erro: "Dados inválidos." }, 400); }
  const id = txt(b?.id, 20);
  if (!ID_RE.test(id)) return json({ erro: "Número do pedido inválido." }, 400);
  const s = store();
  const atual: any = await s.get(id, { type: "json" });
  if (!atual) return json({ erro: "Pedido não encontrado." }, 404);
  if (b.status !== undefined) {
    if (!STATUS.includes(b.status)) return json({ erro: "Status inválido." }, 400);
    atual.status = b.status;
  }
  if (b.obs !== undefined) atual.obs = txt(b.obs, 1000);
  atual.atualizadoEm = new Date().toISOString();
  await s.setJSON(id, atual);
  return json({ pedido: atual });
}

async function excluir(req: Request) {
  const id = txt(new URL(req.url).searchParams.get("id"), 20);
  if (!ID_RE.test(id)) return json({ erro: "Número do pedido inválido." }, 400);
  const f = fotos();
  const { blobs } = await f.list({ prefix: `${id}/` });
  await Promise.all(blobs.map((b) => f.delete(b.key)));
  await store().delete(id);
  return json({ ok: true });
}

export default async (req: Request) => {
  try {
    const q = new URL(req.url).searchParams;
    if (req.method === "POST") return q.has("fotos") ? await anexarFotos(req, txt(q.get("fotos"), 20)) : await criar(req);
    if (!isOwner(req)) return json({ erro: "Senha incorreta." }, 401);
    if (req.method === "GET") return q.has("foto") ? await verFoto(txt(q.get("foto"), 40)) : await listar();
    if (req.method === "PATCH") return await atualizar(req);
    if (req.method === "DELETE") return await excluir(req);
    return json({ erro: "Método não permitido." }, 405);
  } catch (e) {
    console.error("pedidos:", e);
    return json({ erro: "Erro no servidor. Tente de novo." }, 500);
  }
};

export const config: Config = {
  path: "/api/pedidos",
  method: ["GET", "POST", "PATCH", "DELETE"],
};
