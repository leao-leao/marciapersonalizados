// Página pública de um pedido (/pedido/<nº>) com as fotos dos produtos.
// É o link que vai na mensagem do WhatsApp: o WhatsApp lê og:image e mostra a foto na conversa.
// Mostra só o primeiro nome do cliente, os itens e a situação; nunca telefone ou endereço.
// /api/foto?p=<produto> devolve a foto de um produto (inclusive as enviadas pelo painel).
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const ID_RE = /^MP\d{6}-[A-Z0-9]{4}$/;
const LABEL: Record<string, string> = {
  novo: "Recebido", confirmado: "Confirmado", producao: "Em produção", pronto: "Pronto", entregue: "Entregue", cancelado: "Cancelado",
};
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const brl = (v: unknown) => (+(v as number) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (s: string) => (s ? s.split("-").reverse().join("/") : "");

async function catalogo(): Promise<any> {
  try { return await getStore({ name: "catalogo", consistency: "strong" }).get("dados", { type: "json" }); } catch { return null; }
}
const relativo = (u: unknown) => typeof u === "string" && /^img\/[\w\/.-]+$/.test(u) && !u.includes("..");

function fotoDoProduto(cat: any, produtoId: string, origem: string) {
  const p = cat?.products?.find((x: any) => x.id === produtoId);
  if (p && relativo(p.thumb)) return `${origem}/${p.thumb}`;
  if (p && relativo(p.photo)) return `${origem}/${p.photo}`;
  if (p && (String(p.thumb || "").startsWith("data:") || String(p.photo || "").startsWith("data:"))) return `${origem}/api/foto?p=${encodeURIComponent(produtoId)}`;
  return "";
}

async function fotoProduto(req: Request) {
  const id = new URL(req.url).searchParams.get("p") || "";
  if (!/^[\w-]{1,60}$/.test(id)) return new Response("Foto inválida.", { status: 400 });
  const cat = await catalogo();
  const p = cat?.products?.find((x: any) => x.id === id);
  const src = p ? String(p.thumb || p.photo || "") : "";
  if (relativo(src)) return Response.redirect(new URL("/" + src, req.url).toString(), 302);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) return new Response("Foto não encontrada.", { status: 404 });
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "public, max-age=600" } });
}

function pagina(o: { titulo: string; descricao: string; imagem: string; url: string; corpo: string }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.titulo)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="Marcia Personalizados">
<meta property="og:title" content="${esc(o.titulo)}"><meta property="og:description" content="${esc(o.descricao)}">
<meta property="og:url" content="${esc(o.url)}">${o.imagem ? `<meta property="og:image" content="${esc(o.imagem)}"><meta property="og:image:width" content="480"><meta property="og:image:height" content="480">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Nunito+Sans:opsz,wght@6..12,400;6..12,700&display=swap">
<style>
:root{--bg:#ffe3ee;--surface:#fff;--ink:#2b1630;--muted:#735a70;--line:#f3cadb;--brand:#0f766e;--wa:#1f8a4c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#2b1322;--surface:#36192b;--ink:#f6e9f1;--muted:#c7a9bd;--line:#4d2b40;--brand:#5eead4;--wa:#5fd394;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Nunito Sans","Segoe UI",system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px;display:flex;flex-direction:column;gap:14px}
h1{font:800 clamp(24px,6vw,32px)/1.15 "Bricolage Grotesque","Trebuchet MS",system-ui,sans-serif;margin:0}
.hint{color:var(--muted);font-size:14px;margin:0}.pill{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.item{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center}
.item img{width:120px;height:120px;object-fit:cover;display:block}.item div{padding:10px 12px 10px 0}.item b{display:block}
.item small{display:block;color:var(--muted);font-size:13px;overflow-wrap:anywhere}.total{font:800 22px "Bricolage Grotesque",system-ui,sans-serif}
.btn{display:inline-flex;justify-content:center;align-items:center;border-radius:12px;padding:12px 16px;font-weight:700;text-decoration:none}
.wa{background:var(--wa);color:#fff}.ghost{background:var(--surface);border:1px solid var(--line);color:var(--ink)}
@media (prefers-color-scheme:dark){.wa{color:#0b2416}}.acts{display:flex;gap:8px;flex-wrap:wrap}
</style></head><body><main>${o.corpo}</main></body></html>`;
}

async function paginaPedido(req: Request, context: Context) {
  const url = new URL(req.url);
  const origem = url.origin;
  const id = String(context.params?.id || "").toUpperCase();
  if (!ID_RE.test(id)) return new Response("Pedido não encontrado.", { status: 404 });
  const [pedido, cat]: any[] = await Promise.all([getStore({ name: "pedidos", consistency: "strong" }).get(id, { type: "json" }), catalogo()]);
  const loja = cat?.store?.name || "Marcia Personalizados";
  const wa = String(cat?.store?.whatsapp || "5591992085871").replace(/\D/g, "");
  const linkLoja = `https://wa.me/${wa}?text=${encodeURIComponent(`Olá! Sobre o meu pedido nº ${id}.`)}`;
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

  if (!pedido) {
    // O WhatsApp pode ler o link antes de o pedido terminar de salvar: usa o produto indicado no link.
    const p = url.searchParams.get("p") || "";
    const prod = /^[\w-]{1,60}$/.test(p) ? cat?.products?.find((x: any) => x.id === p) : null;
    const f = url.searchParams.get("f") || "";
    const imagem = relativo(f) ? `${origem}/${f}` : /^[\w-]{1,60}$/.test(p) ? fotoDoProduto(cat, p, origem) : "";
    const titulo = `Pedido nº ${id} · ${loja}`;
    return new Response(pagina({
      titulo, descricao: prod ? prod.name : "Pedido feito pelo catálogo online.", imagem, url: url.toString(),
      corpo: `<p class="hint">${esc(loja)}</p><h1>Pedido nº ${esc(id)}</h1>${imagem ? `<div class="item"><img src="${esc(imagem)}" alt=""><div><b>${esc(prod?.name || "")}</b></div></div>` : ""}
        <p class="hint">Estamos registrando este pedido. Atualize a página em instantes.</p>
        <div class="acts"><a class="btn wa" href="${esc(linkLoja)}">Falar com a loja no WhatsApp</a><a class="btn ghost" href="/">Ver catálogo</a></div>`,
    }), { status: 200, headers });
  }

  const itens = (pedido.itens || []).map((i: any) => ({ ...i, img: i.foto ? `${origem}/${i.foto}` : i.produtoId ? fotoDoProduto(cat, i.produtoId, origem) : "" }));
  const primeiro = String(pedido.cliente?.nome || "").trim().split(/\s+/)[0] || "";
  const titulo = `Pedido nº ${id} · ${loja}`;
  const descricao = itens.map((i: any) => `${i.produto} (${i.qtd} ${i.unidade || "un"})`).join(", ") + ` · Total ${brl(pedido.total)}`;
  const corpo = `<p class="hint">${esc(loja)}</p>
    <h1>Pedido nº ${esc(id)}</h1>
    <p><span class="pill">${esc(LABEL[pedido.status] || pedido.status)}</span></p>
    <p class="hint">${primeiro ? `Pedido de ${esc(primeiro)} · ` : ""}Festa: ${pedido.dataEvento ? esc(brDate(pedido.dataEvento)) : "a combinar"} · ${esc(pedido.entrega || "")}</p>
    ${itens.map((i: any) => `<div class="item">${i.img ? `<img src="${esc(i.img)}" alt="${esc(i.produto)}">` : "<span></span>"}<div><b>${esc(i.produto)}</b><small>${esc(i.qtd)} ${esc(i.unidade || "un")} · ${brl(i.total)}</small>${i.personalizacao ? `<small>${esc(i.personalizacao)}</small>` : ""}</div></div>`).join("")}
    <p class="total">Total estimado: ${brl(pedido.total)}</p>
    <p class="hint">A loja confirma a arte, o valor final e a forma de pagamento pelo WhatsApp.</p>
    <div class="acts"><a class="btn wa" href="${esc(linkLoja)}">Falar com a loja no WhatsApp</a><a class="btn ghost" href="/">Ver catálogo</a></div>`;
  return new Response(pagina({ titulo, descricao, imagem: itens.find((i: any) => i.img)?.img || "", url: `${origem}/pedido/${id}`, corpo }), { headers });
}

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);
    if (url.pathname === "/api/foto") return await fotoProduto(req);
    return await paginaPedido(req, context);
  } catch (e) {
    console.error("pedido-publico:", e);
    return new Response("Erro ao abrir o pedido. Tente de novo.", { status: 500 });
  }
};

export const config: Config = {
  path: ["/pedido/:id", "/api/foto"],
  method: ["GET"],
};
