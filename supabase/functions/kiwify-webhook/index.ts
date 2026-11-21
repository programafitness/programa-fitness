// Webhook da Kiwify (pagamento único), com vários produtos.
// Endereço por produto:  .../kiwify-webhook?produto=<slug>   (a Kiwify acrescenta &signature=...)
//  - Autenticação: ?signature = HMAC-SHA1 (hex) do corpo cru, com o token do webhook como chave.
//    Usa o token do próprio produto (tabela produto_webhooks) ou, se ele não tiver, o token global.
//  - Sem ?produto, o produto é identificado pelo código que vem no aviso (produtos.kiwify_product_id).
//  - Cada compra libera SÓ o produto comprado; reembolso e chargeback retiram só aquele produto.
//  - Evento "teste_painel" (enviado pelo botão Testar do painel): confere assinatura e produto, sem alterar dados.
//  - Ao liberar qualquer produto, envia e-mail de acesso com o nome do produto (uma única vez por pedido + produto).
//    A Kiwify não envia acesso para área de membros externa, então este e-mail é o único que o aluno recebe.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


// === Funções de e-mail inline (consolidado do _shared/resend.ts) ===

interface EmailParams {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}

interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

async function enviarEmail(params: EmailParams): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY não configurada" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok) {
      const msg = data?.message || data?.error || `HTTP ${response.status}`;
      return { ok: false, error: msg };
    }

    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Nome do cliente e do produto entram no HTML: escapa para não quebrar o e-mail
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function emailBoasVindas(email: string, primeiroNome: string, nomeProdutoTexto: string): EmailParams {
  const nomeTexto = primeiroNome || "aluno";
  const nome = escapeHtml(nomeTexto);
  const produto = escapeHtml(nomeProdutoTexto);
  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #050D1B; color: #f7fafc; }
  .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
  .header { text-align: center; margin-bottom: 32px; }
  .header h1 { margin: 0; font-size: 28px; font-weight: 800; color: #80FF00; }
  .content { background: #0B1B2B; border-radius: 12px; padding: 32px 24px; }
  .content p { margin: 0 0 16px; line-height: 1.6; color: #B6C6D4; }
  .cta { display: inline-block; margin: 24px 0; padding: 14px 32px; background: #80FF00; color: #04140A; font-weight: 800; font-size: 16px; text-decoration: none; border-radius: 8px; }
  .footer { text-align: center; margin-top: 32px; font-size: 14px; color: #607788; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Treino Inteligente</h1>
  </div>
  <div class="content">
    <p>Olá, <strong>${nome}</strong>!</p>
    <p>Sua compra foi aprovada e seu acesso ao <strong>${produto}</strong> está liberado. Ele já está disponível na área de membros do Treino Inteligente.</p>
    <p style="text-align: center;">
      <a href="https://membros.treinointeligente.com.br/" class="cta">Acessar Plataforma</a>
    </p>
    <p><strong>Como entrar:</strong></p>
    <p>Clique no botão acima e use o mesmo e-mail da compra: <strong>${escapeHtml(email)}</strong>. Depois, toque no card <strong>${produto}</strong>.</p>
    <p>Se precisar de ajuda, entre em contato pelo e-mail <a href="mailto:suporte@treinointeligente.com.br" style="color: #80FF00;">suporte@treinointeligente.com.br</a>.</p>
    <p style="margin-top: 24px;">Bons treinos!</p>
  </div>
  <div class="footer">
    <p>Treino Inteligente &copy; ${new Date().getFullYear()}</p>
  </div>
</div>
</body>
</html>
`;

  const texto = `Olá, ${nomeTexto}!

Sua compra foi aprovada e seu acesso ao ${nomeProdutoTexto} está liberado. Ele já está disponível na área de membros do Treino Inteligente.

Acesse: https://membros.treinointeligente.com.br/

Como entrar:
Use o mesmo e-mail da compra: ${email}. Depois, toque no card ${nomeProdutoTexto}.

Se precisar de ajuda, entre em contato pelo e-mail suporte@treinointeligente.com.br.

Bons treinos!

Treino Inteligente`;

  return {
    from: "Treino Inteligente <acesso@treinointeligente.com.br>",
    to: email,
    subject: `Seu acesso ao ${nomeProdutoTexto} está liberado`,
    html,
    text: texto,
    reply_to: "suporte@treinointeligente.com.br",
  };
}

// === Fim das funções de e-mail ===
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const TOKEN_GLOBAL = Deno.env.get("KIWIFY_WEBHOOK_TOKEN") ?? "";
const ORIGENS = ["https://membros.treinointeligente.com.br", "https://programafitness.github.io"];

const LIBERA = ["order_approved"];
const BLOQUEIA = ["order_refunded", "chargeback"];
const TESTE = "teste_painel";

const enc = new TextEncoder();

async function hmacSha1Hex(key: string, msg: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparação em tempo constante
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ORIGENS.includes(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function mask(email: string) {
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

// Código do produto no aviso da Kiwify (aceita as grafias mais comuns)
function codigoProduto(body: any): string {
  const v = body?.Product?.product_id ?? body?.product?.product_id ??
    body?.product_id ?? body?.Product?.id ?? body?.product?.id ?? "";
  return String(v).trim().toLowerCase();
}

type Produto = { id: string; slug: string; nome: string | null; kiwify_product_id: string | null };

// Produto pelo endereço (?produto=slug) e o token próprio dele, se houver
async function produtoPorSlug(slug: string) {
  const p = await supabase.from("produtos").select("id, slug, nome, kiwify_product_id").eq("slug", slug).maybeSingle();
  if (p.error) return { erro: p.error.message as string };
  if (!p.data) return { produto: null as Produto | null, token: "" };
  const t = await supabase.from("produto_webhooks").select("token").eq("produto_id", p.data.id).maybeSingle();
  if (t.error) return { erro: t.error.message as string };
  return { produto: p.data as Produto, token: String(t.data?.token ?? "") };
}

// Sem ?produto: descobre o produto pelo código que vem no aviso
async function produtoPorCodigo(codigo: string) {
  const { data, error } = await supabase.from("produtos").select("id, slug, nome, kiwify_product_id")
    .not("kiwify_product_id", "is", null);
  if (error) return { erro: error.message as string };
  const lista = (data ?? []) as Produto[];
  if (codigo) {
    return { produto: lista.find((x) => String(x.kiwify_product_id).toLowerCase() === codigo) ?? null };
  }
  // Aviso sem código: só aceita se houver exatamente um produto com código cadastrado
  if (lista.length === 1) {
    console.warn("aviso sem codigo de produto: usando o unico produto cadastrado");
    return { produto: lista[0] };
  }
  return { produto: null as Produto | null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "method not allowed" }, 405);

  const raw = new Uint8Array(await req.arrayBuffer());
  const url = new URL(req.url);
  const sig = (url.searchParams.get("signature") ?? "").toLowerCase();
  const slug = (url.searchParams.get("produto") ?? "").trim().toLowerCase();

  // 1) Qual token vale? O do produto (se o endereço trouxe ?produto e ele tem token) ou o global
  let produtoUrl: Produto | null = null;
  let token = TOKEN_GLOBAL;
  let tokenProprio = false;
  if (slug) {
    const r = await produtoPorSlug(slug);
    if ("erro" in r) {
      console.error("erro ao ler produto", r.erro);
      return json(req, { error: "db" }, 500);
    }
    produtoUrl = r.produto;
    if (r.produto && r.token) { token = r.token; tokenProprio = true; }
  }
  if (!token) {
    console.error("nenhum token configurado");
    return json(req, { error: "not configured" }, 500);
  }

  // 2) Assinatura sobre o corpo CRU, antes de qualquer parse
  const esperado = await hmacSha1Hex(token, raw);
  if (!safeEqual(sig, esperado)) {
    console.warn("assinatura invalida", slug || "(sem produto)");
    return json(req, { error: "invalid signature" }, 401);
  }
  if (slug && !produtoUrl) return json(req, { error: "produto nao encontrado" }, 404);

  // 3) Corpo
  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(req, { error: "invalid json" }, 400);
  }
  const evento: string = body?.webhook_event_type ?? "";

  // Teste do painel: não altera nada
  if (evento === TESTE) {
    return json(req, { ok: true, teste: true, produto: produtoUrl?.slug ?? null, token: tokenProprio ? "proprio" : "global" });
  }

  const orderId: string = String(body?.order_id ?? "");
  const emailBruto: string = body?.Customer?.email ?? body?.customer?.email ?? "";
  const email = String(emailBruto).trim().toLowerCase();

  if (!LIBERA.includes(evento) && !BLOQUEIA.includes(evento)) {
    return json(req, { ok: true, ignored: evento || "sem evento" });
  }
  if (!orderId) return json(req, { error: "sem order_id" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn("evento sem e-mail valido", evento, orderId);
    return json(req, { error: "sem e-mail valido" }, 400);
  }

  // 4) Produto do aviso
  const codigo = codigoProduto(body);
  let produto: Produto | null = produtoUrl;
  if (produtoUrl) {
    // endereço com ?produto: se o produto tem código cadastrado e o aviso traz outro, algo está configurado errado
    const cad = String(produtoUrl.kiwify_product_id ?? "").toLowerCase();
    if (cad && codigo && cad !== codigo) {
      console.warn("produto nao confere", produtoUrl.slug, codigo, evento, orderId);
      return json(req, { ok: true, ignored: "produto nao confere" });
    }
  } else {
    const r = await produtoPorCodigo(codigo);
    if ("erro" in r) {
      console.error("erro ao ler produtos", r.erro);
      return json(req, { error: "db" }, 500);
    }
    produto = r.produto ?? null;
  }
  if (!produto) {
    // Não registra o evento: depois de cadastrar o produto, o reenvio manual na Kiwify funciona
    console.warn("produto desconhecido", codigo || "(sem codigo)", evento, orderId);
    return json(req, { ok: true, ignored: "produto desconhecido" });
  }

  // 5) Idempotência: o mesmo pedido + evento só é processado uma vez
  const { error: dupErr } = await supabase.from("webhook_eventos")
    .insert({ order_id: orderId, event_type: evento, email, produto_codigo: codigo || null, produto_id: produto.id });
  if (dupErr) {
    if (dupErr.code === "23505") return json(req, { ok: true, duplicate: true });
    console.error("erro ao registrar evento", dupErr.message);
    return json(req, { error: "db" }, 500);
  }

  // 6) Aplica
  let erro: { message: string } | null = null;
  try {
    if (LIBERA.includes(evento)) {
      // cria o aluno se não existir (sem trocar a origem de quem já existe, ex.: admin)
      erro = (await supabase.from("alunos")
        .upsert({ email, origem: "kiwify", ativo: true }, { onConflict: "email", ignoreDuplicates: true })).error;
      if (!erro) erro = (await supabase.from("alunos").update({ ativo: true }).eq("email", email)).error;
      if (!erro) {
        erro = (await supabase.from("acessos")
          .upsert({ email, produto_id: produto.id, ativo: true, origem: "kiwify" }, { onConflict: "email,produto_id" })).error;
      }

      // E-mail de acesso, para todo produto (uma única vez por pedido + produto)
      if (!erro) {
        // limit(1) em vez de maybeSingle(): com 2+ linhas o maybeSingle() dá erro e o envio era pulado sem log
        const jaEnviado = await supabase.from("emails_enviados")
          .select("id").eq("order_id", orderId).eq("produto_id", produto.id).eq("tipo", "boas-vindas").limit(1);
        if (jaEnviado.error) {
          // não derruba a liberação do acesso; só registra para investigar
          console.error("[EMAIL] erro ao consultar emails_enviados", orderId, jaEnviado.error.message);
        } else if (jaEnviado.data.length > 0) {
          console.log("[EMAIL] boas-vindas ja enviado", orderId);
        } else {
          const primeiroNome = String(body?.Customer?.first_name || body?.customer?.first_name || "").trim();
          const nomeProduto = String(produto.nome || "").trim() || "Treino Inteligente";
          const resultado = await enviarEmail(emailBoasVindas(email, primeiroNome, nomeProduto));
          if (resultado.ok) console.log("[EMAIL] boas-vindas enviado", produto.slug, orderId, mask(email), resultado.id);
          else console.error("[EMAIL] falha no envio do boas-vindas", produto.slug, orderId, resultado.error);
          const reg = await supabase.from("emails_enviados").insert({
            order_id: orderId,
            email,
            produto_id: produto.id,
            tipo: "boas-vindas",
            resend_id: resultado.id || null,
            erro: resultado.ok ? null : resultado.error,
          });
          if (reg.error) console.error("[EMAIL] erro ao gravar emails_enviados", orderId, reg.error.message);
        }
      }
    } else {
      // retira só o acesso a este produto
      erro = (await supabase.from("acessos").update({ ativo: false })
        .eq("email", email).eq("produto_id", produto.id)).error;
      if (!erro) {
        const resto = await supabase.from("acessos").select("id").eq("email", email).eq("ativo", true).limit(1);
        erro = resto.error;
        // sem nenhum outro produto ativo, o login também é desativado (nunca para administrador)
        if (!erro && (!resto.data || resto.data.length === 0)) {
          erro = (await supabase.from("alunos").update({ ativo: false }).eq("email", email).neq("origem", "admin")).error;
        }
      }
    }
  } catch (e) {
    erro = { message: String(e) };
  }

  if (erro) {
    // desfaz o registro para a Kiwify poder reenviar e tentarmos de novo
    await supabase.from("webhook_eventos").delete().eq("order_id", orderId).eq("event_type", evento);
    console.error("erro ao aplicar", evento, produto.slug, erro.message);
    return json(req, { error: "db" }, 500);
  }

  console.log("ok", evento, produto.slug, orderId, mask(email));
  return json(req, { ok: true, evento, produto: produto.slug });
});
