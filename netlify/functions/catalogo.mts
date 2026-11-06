// Dados do catálogo (loja, categorias, temas, produtos e preços).
// GET: público, o site lê a versão mais recente. PUT: só com a senha do painel.
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { isOwner, json } from "../lib/auth.mts";

const MAX_BODY = 5_000_000;
const store = () => getStore({ name: "catalogo", consistency: "strong" });

function valido(d: any) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "Formato inválido.";
  if (!d.store || typeof d.store !== "object" || typeof d.store.name !== "string") return "Dados da loja ausentes.";
  if (!Array.isArray(d.cats) || !Array.isArray(d.products) || !Array.isArray(d.temas ?? [])) return "Listas ausentes.";
  for (const p of d.products) {
    if (!p || typeof p.id !== "string" || typeof p.name !== "string") return "Produto sem nome.";
    if (!Array.isArray(p.tiers) || !p.tiers.every((t: any) => Array.isArray(t) && t.length === 2 && t.every((n: any) => Number.isFinite(+n) && +n >= 0)))
      return `Preço inválido em “${p.name}”.`;
  }
  return "";
}

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      if (url.searchParams.has("verificar")) return isOwner(req) ? json({ ok: true }) : json({ erro: "Senha incorreta." }, 401);
      const dados = await store().get("dados", { type: "json" });
      return dados ? json(dados) : json({ erro: "Sem dados salvos." }, 404);
    }
    if (req.method === "PUT") {
      if (!isOwner(req)) return json({ erro: "Senha incorreta." }, 401);
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ erro: "O catálogo ficou grande demais. Remova algumas fotos." }, 413);
      let d: any;
      try { d = JSON.parse(raw); } catch { return json({ erro: "Formato inválido." }, 400); }
      const erro = valido(d);
      if (erro) return json({ erro }, 400);
      const s = store();
      const anterior = await s.get("dados", { type: "json" });
      if (anterior) await s.setJSON(`historico/${new Date().toISOString()}`, anterior);
      d.atualizadoEm = new Date().toISOString();
      await s.setJSON("dados", d);
      return json({ ok: true, atualizadoEm: d.atualizadoEm });
    }
    return json({ erro: "Método não permitido." }, 405);
  } catch (e) {
    console.error("catalogo:", e);
    return json({ erro: "Erro no servidor. Tente de novo." }, 500);
  }
};

export const config: Config = {
  path: "/api/catalogo",
  method: ["GET", "PUT"],
};
