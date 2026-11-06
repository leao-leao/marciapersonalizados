// Senha do painel (variável PAINEL_SENHA no Netlify), usada pelas funções da loja.
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isOwner(req: Request) {
  const senha = Netlify.env.get("PAINEL_SENHA");
  if (!senha) return false;
  return sameText(req.headers.get("authorization") || "", `Bearer ${senha}`);
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
