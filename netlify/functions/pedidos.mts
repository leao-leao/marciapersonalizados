// Pedidos do catálogo: o catálogo grava (POST) e a página /pedidos lista e atualiza (GET, PATCH, DELETE).
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner, json } from "../lib/auth.mts";

const STATUS = ["novo", "confirmado", "producao", "pronto", "entregue", "cancelado"];
const ID_RE = /^MP\d{6}-[A-Z0-9]{4}$/;
const MAX_BODY = 40_000;

const store = () => getStore({ name: "pedidos", consistency: "strong" });
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => {
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? n : 0;
};

async function readBody(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new Error("grande");
  return JSON.parse(raw);
}

async function criar(req: Request) {
  let b: any;
  try { b = await readBody(req); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const id = txt(b?.id, 20);
  if (!ID_RE.test(id)) return json({ erro: "Número do pedido inválido." }, 400);
  const c = b.cliente || {};
  const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 40).map((i: any) => ({
    produto: txt(i?.produto, 120),
    qtd: Math.max(0, Math.round(Number(i?.qtd) || 0)),
    unidade: txt(i?.unidade, 20),
    total: num(i?.total),
    personalizacao: txt(i?.personalizacao, 600),
    refs: Math.max(0, Math.min(10, Math.round(Number(i?.refs) || 0))),
  })).filter((i: any) => i.produto && i.qtd > 0);
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
    total: num(b.total),
  };
  const { modified } = await store().setJSON(id, pedido, { onlyIfNew: true });
  return json({ id, salvo: modified }, modified ? 201 : 200);
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
  await store().delete(id);
  return json({ ok: true });
}

export default async (req: Request) => {
  try {
    if (req.method === "POST") return await criar(req);
    if (!isOwner(req)) return json({ erro: "Senha incorreta." }, 401);
    if (req.method === "GET") return await listar();
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
