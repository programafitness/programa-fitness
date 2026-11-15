/* ============================================================================
   TREINO INTELIGENTE - Telas de administração: módulos, materiais e webhook
   Carregado sob demanda por app.js (só para o administrador).
   As regras de quem pode alterar o quê ficam no banco (RLS); aqui é só a interface.
   ========================================================================== */
(() => {
'use strict';

const { db, S, h, $, clear, setBusy, safeLink, imgUrl, slugify, SUPABASE_URL } = window.TI;
const sub = $('adminSub');
const main = $('prodMain');

// ─── Navegação entre as telas do painel de produtos ──────────────────────────
function show(...nodes) {
  clear(sub);
  sub.append(...nodes);
  sub.hidden = false;
  main.hidden = true;
  window.scrollTo(0, 0);
}

function closeSub() {
  clear(sub);
  sub.hidden = true;
  main.hidden = false;
  window.TI.reloadProdutos();
}

function backButton(label, onClick) {
  const b = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

const alertBox = () => h('div', { class: 'alert', role: 'status' });
function say(box, text, ok) { box.textContent = text; box.className = 'alert show' + (ok ? ' ok' : ''); }

function btn(label, cls, onClick, attrs) {
  const b = h('button', { class: 'btn ' + cls, type: 'button', ...(attrs || {}) }, label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

// ─── Arquivos ────────────────────────────────────────────────────────────────
function validarImagem(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return 'A imagem deve ser PNG, JPG ou WebP.';
  if (file.size > 3 * 1024 * 1024) return 'A imagem deve ter no máximo 3 MB.';
  return null;
}

function validarPdf(file) {
  if (!file) return null;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return 'O material deve ser um arquivo PDF.';
  if (file.size > 50 * 1024 * 1024) return 'O PDF deve ter no máximo 50 MB.';
  return null;
}

async function enviarImagem(file, base) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `modulos/${base}-${Date.now()}.${ext}`;
  const up = await db.storage.from('images').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw new Error('Não foi possível enviar a imagem: ' + up.error.message);
  return db.storage.from('images').getPublicUrl(path).data.publicUrl;
}

async function enviarPdf(file, path) {
  const up = await db.storage.from('pdfs').upload(path, file, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error('Não foi possível enviar o PDF: ' + up.error.message);
  return path;
}

// Troca duas posições e renumera (10, 20, 30...) só o que mudou
async function mover(tabela, lista, idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= lista.length) return;
  const ids = lista.map((x) => x.id);
  [ids[idx], ids[j]] = [ids[j], ids[idx]];
  for (let i = 0; i < ids.length; i++) {
    const nova = (i + 1) * 10;
    const atual = lista.find((x) => x.id === ids[i]);
    if (atual.ordem !== nova) await db.from(tabela).update({ ordem: nova }).eq('id', ids[i]);
  }
}

function proximaOrdem(lista) {
  return (lista.reduce((m, x) => Math.max(m, x.ordem || 0), 0)) + 10;
}

function slugUnico(base, existentes) {
  let s = base || 'modulo', n = 2;
  while (existentes.includes(s)) s = `${base}-${n++}`;
  return s;
}

// ─── Módulos de um produto ───────────────────────────────────────────────────
async function openModulos(p, edit) {
  const r = await db.from('produto_modulos').select('*, produto_materiais(id)')
    .eq('produto_id', p.id).order('ordem', { ascending: true });
  const cab = h('div', { class: 'sub-head' }, backButton('← Voltar aos produtos', closeSub), h('h2', {}, 'Módulos de ' + p.nome));
  if (r.error) { show(cab, h('div', { class: 'empty' }, 'Erro ao carregar os módulos: ' + r.error.message)); return; }
  const mods = r.data || [];
  const lista = h('div', { class: 'list', id: 'modList' },
    mods.length ? mods.map((m, i) => moduloLinha(p, mods, m, i))
                : h('div', { class: 'empty' }, 'Nenhum módulo ainda. Use o formulário acima para criar o primeiro.'));
  show(cab, moduloForm(p, mods, edit), lista);
}

function moduloForm(p, mods, edit) {
  const f = {
    titulo: h('input', { class: 'field-input', maxlength: 80, required: true, id: 'mTitulo' }),
    desc: h('textarea', { class: 'field-textarea', maxlength: 200, id: 'mDesc' }),
    ordem: h('input', { class: 'field-input', type: 'number', min: 0, step: 1, id: 'mOrdem' }),
    capa: h('input', { class: 'field-input', type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'mCapa' }),
    prev: h('img', { class: 'cover-preview tall', alt: '', hidden: true }),
    bv: h('input', { type: 'checkbox', id: 'mBv' }),
    ativo: h('input', { type: 'checkbox', id: 'mAtivo', checked: true })
  };
  f.titulo.value = edit ? edit.titulo : '';
  f.desc.value = edit ? (edit.descricao || '') : '';
  f.ordem.value = edit ? edit.ordem : proximaOrdem(mods);
  f.bv.checked = edit ? !!edit.boas_vindas : false;
  f.ativo.checked = edit ? !!edit.ativo : true;
  const capaAtual = edit ? imgUrl(edit.capa_url) : null;
  if (capaAtual) { f.prev.src = capaAtual; f.prev.hidden = false; }
  f.capa.addEventListener('change', () => {
    const file = f.capa.files[0];
    if (file) { f.prev.src = URL.createObjectURL(file); f.prev.hidden = false; }
  });

  const msg = alertBox();
  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, edit ? 'Salvar módulo' : 'Adicionar módulo');
  const form = h('form', { class: 'panel', novalidate: true },
    h('h2', {}, edit ? 'Editar módulo' : 'Novo módulo'),
    h('div', { class: 'form-grid two' },
      field('Nome do módulo', f.titulo),
      field('Ordem', f.ordem, 'Menor número aparece primeiro. Você também pode usar as setas na lista.'),
      h('div', { class: 'field span-2' }, h('span', { class: 'field-label' }, 'Descrição (opcional)'), f.desc),
      h('div', { class: 'field span-2' }, h('span', { class: 'field-label' }, 'Capa do módulo'), f.capa,
        h('span', { class: 'field-hint' }, 'PNG, JPG ou WebP, até 3 MB. Ideal: formato vertical 9:16, com o título já na imagem.'), f.prev),
      h('label', { class: 'check span-2' }, f.bv, ' Módulo de boas-vindas (mostra o passo a passo da plataforma, sem materiais)'),
      h('label', { class: 'check span-2' }, f.ativo, ' Visível para os alunos')),
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px' }, salvar,
      edit ? btn('Cancelar edição', 'btn-ghost', () => openModulos(p)) : null),
    msg);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const titulo = f.titulo.value.trim();
    const ordem = parseInt(f.ordem.value, 10);
    const file = f.capa.files[0];
    if (!titulo) return say(msg, 'Informe o nome do módulo.');
    if (!Number.isFinite(ordem) || ordem < 0) return say(msg, 'Informe uma ordem válida (número).');
    const erroImg = validarImagem(file);
    if (erroImg) return say(msg, erroImg);

    setBusy(salvar, true, 'Salvando');
    try {
      const slug = edit ? edit.slug : slugUnico(slugify(titulo), mods.map((m) => m.slug));
      let capa = edit ? edit.capa_url : null;
      if (file) capa = await enviarImagem(file, `${p.slug}-${slug}`);
      const row = { titulo, descricao: f.desc.value.trim() || null, capa_url: capa, ordem, boas_vindas: f.bv.checked, ativo: f.ativo.checked };
      const res = edit
        ? await db.from('produto_modulos').update(row).eq('id', edit.id)
        : await db.from('produto_modulos').insert({ ...row, produto_id: p.id, slug });
      if (res.error) throw new Error(res.error.message);
      window.TI.invalidateCatalogs();
      await openModulos(p);
    } catch (e) {
      say(msg, 'Erro: ' + e.message);
    } finally {
      setBusy(salvar, false);
    }
  });
  return form;
}

function moduloLinha(p, mods, m, i) {
  const n = (m.produto_materiais || []).length;
  const capa = imgUrl(m.capa_url);
  const sobe = btn('▲', 'btn-ghost btn-sm btn-icon', async () => { await mover('produto_modulos', mods, i, -1); window.TI.invalidateCatalogs(); openModulos(p); }, { 'aria-label': `Subir ${m.titulo}`, disabled: i === 0 });
  const desce = btn('▼', 'btn-ghost btn-sm btn-icon', async () => { await mover('produto_modulos', mods, i, 1); window.TI.invalidateCatalogs(); openModulos(p); }, { 'aria-label': `Descer ${m.titulo}`, disabled: i === mods.length - 1 });
  const acoes = h('div', { class: 'row-actions' },
    h('span', { class: 'mover' }, sobe, desce),
    m.boas_vindas ? null : btn('Materiais', 'btn-outline btn-sm', () => openMateriais(p, m)),
    btn('Editar', 'btn-ghost btn-sm', () => openModulos(p, m)),
    btn('Excluir', 'btn-danger btn-sm', () => excluirModulo(p, m)));
  return h('div', { class: 'row mod' },
    capa ? h('img', { class: 'thumb tall', src: capa, alt: '', loading: 'lazy', width: 48, height: 86 }) : h('div', { class: 'thumb tall' }),
    h('div', {}, h('strong', {}, m.titulo),
      h('div', { class: 'muted' }, m.boas_vindas ? 'Boas-vindas (sem materiais)' : `${n} ${n === 1 ? 'material' : 'materiais'}`)),
    m.ativo ? h('span', { class: 'tag green' }, 'Visível') : h('span', { class: 'tag red' }, 'Oculto'),
    acoes);
}

async function excluirModulo(p, m) {
  const n = (m.produto_materiais || []).length;
  const aviso = n ? `Excluir o módulo "${m.titulo}" e seus ${n} materiais? Os PDFs também serão apagados. Isso não pode ser desfeito.`
                  : `Excluir o módulo "${m.titulo}"? Isso não pode ser desfeito.`;
  if (!confirm(aviso)) return;
  const mats = await db.from('produto_materiais').select('arquivo').eq('modulo_id', m.id);
  const paths = (mats.data || []).map((x) => x.arquivo);
  const del = await db.from('produto_modulos').delete().eq('id', m.id);
  if (del.error) return alert('Erro ao excluir: ' + del.error.message);
  if (paths.length) await db.storage.from('pdfs').remove(paths);
  window.TI.invalidateCatalogs();
  openModulos(p);
}

// ─── Materiais (PDFs) de um módulo ───────────────────────────────────────────
async function openMateriais(p, m, edit) {
  const r = await db.from('produto_materiais').select('*').eq('modulo_id', m.id).order('ordem', { ascending: true });
  const cab = h('div', { class: 'sub-head' },
    backButton('← Voltar aos módulos', () => openModulos(p)),
    h('h2', {}, `${m.titulo}: materiais`));
  if (r.error) { show(cab, h('div', { class: 'empty' }, 'Erro ao carregar os materiais: ' + r.error.message)); return; }
  const mats = r.data || [];
  const lista = h('div', { class: 'list' },
    mats.length ? mats.map((x, i) => materialLinha(p, m, mats, x, i))
                : h('div', { class: 'empty' }, 'Nenhum material ainda. Use o formulário acima para enviar o primeiro PDF.'));
  show(cab, materialForm(p, m, mats, edit), lista);
}

function materialForm(p, m, mats, edit) {
  const f = {
    titulo: h('input', { class: 'field-input', maxlength: 100, required: true, id: 'xTitulo' }),
    desc: h('input', { class: 'field-input', maxlength: 200, id: 'xDesc' }),
    grupo: h('input', { class: 'field-input', maxlength: 40, id: 'xGrupo', placeholder: 'Ex.: Academia, Em casa' }),
    ordem: h('input', { class: 'field-input', type: 'number', min: 0, step: 1, id: 'xOrdem' }),
    arq: h('input', { class: 'field-input', type: 'file', accept: 'application/pdf,.pdf', id: 'xArq' }),
    ativo: h('input', { type: 'checkbox', id: 'xAtivo', checked: true })
  };
  f.titulo.value = edit ? edit.titulo : '';
  f.desc.value = edit ? (edit.descricao || '') : '';
  f.grupo.value = edit ? (edit.grupo || '') : '';
  f.ordem.value = edit ? edit.ordem : proximaOrdem(mats);
  f.ativo.checked = edit ? !!edit.ativo : true;

  const msg = alertBox();
  const salvar = h('button', { class: 'btn btn-primary', type: 'submit' }, edit ? 'Salvar material' : 'Enviar material');
  const form = h('form', { class: 'panel', novalidate: true },
    h('h2', {}, edit ? 'Editar material' : 'Novo material'),
    h('p', { class: 'muted' }, 'O nome que você digitar é o que o aluno vê. Evite nomes técnicos ou o nome do arquivo.'),
    h('div', { class: 'form-grid two' },
      field('Nome do material', f.titulo),
      field('Ordem', f.ordem),
      field('Descrição curta (opcional)', f.desc),
      field('Grupo (opcional)', f.grupo, 'Materiais com o mesmo grupo aparecem juntos, com um subtítulo.'),
      h('div', { class: 'field span-2' }, h('span', { class: 'field-label' }, edit ? 'Trocar o PDF (opcional)' : 'Arquivo PDF'), f.arq,
        h('span', { class: 'field-hint' }, edit ? `Arquivo atual: ${edit.arquivo.split('/').pop()}` : 'Somente PDF, até 50 MB.')),
      h('label', { class: 'check span-2' }, f.ativo, ' Visível para os alunos')),
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px' }, salvar,
      edit ? btn('Cancelar edição', 'btn-ghost', () => openMateriais(p, m)) : null),
    msg);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const titulo = f.titulo.value.trim();
    const ordem = parseInt(f.ordem.value, 10);
    const file = f.arq.files[0];
    if (!titulo) return say(msg, 'Informe o nome do material.');
    if (!Number.isFinite(ordem) || ordem < 0) return say(msg, 'Informe uma ordem válida (número).');
    if (!edit && !file) return say(msg, 'Escolha o arquivo PDF.');
    const erroPdf = validarPdf(file);
    if (erroPdf) return say(msg, erroPdf);

    setBusy(salvar, true, file ? 'Enviando PDF' : 'Salvando');
    let novoPath = null;
    try {
      let arquivo = edit ? edit.arquivo : null;
      if (file) {
        novoPath = `${p.slug}/${m.slug}/${slugify(titulo).slice(0, 50)}-${Date.now().toString(36)}.pdf`;
        arquivo = await enviarPdf(file, novoPath);
      }
      const row = { titulo, descricao: f.desc.value.trim() || null, grupo: f.grupo.value.trim() || null, arquivo, ordem, ativo: f.ativo.checked };
      const res = edit
        ? await db.from('produto_materiais').update(row).eq('id', edit.id)
        : await db.from('produto_materiais').insert({ ...row, modulo_id: m.id });
      if (res.error) throw new Error(res.error.message);
      if (edit && novoPath && edit.arquivo !== novoPath) await db.storage.from('pdfs').remove([edit.arquivo]);
      window.TI.invalidateCatalogs();
      await openMateriais(p, m);
    } catch (e) {
      if (novoPath) await db.storage.from('pdfs').remove([novoPath]);  // não deixa PDF solto se o cadastro falhar
      say(msg, 'Erro: ' + e.message);
    } finally {
      setBusy(salvar, false);
    }
  });
  return form;
}

function materialLinha(p, m, mats, x, i) {
  const sobe = btn('▲', 'btn-ghost btn-sm btn-icon', async () => { await mover('produto_materiais', mats, i, -1); window.TI.invalidateCatalogs(); openMateriais(p, m); }, { 'aria-label': `Subir ${x.titulo}`, disabled: i === 0 });
  const desce = btn('▼', 'btn-ghost btn-sm btn-icon', async () => { await mover('produto_materiais', mats, i, 1); window.TI.invalidateCatalogs(); openMateriais(p, m); }, { 'aria-label': `Descer ${x.titulo}`, disabled: i === mats.length - 1 });
  const abrir = btn('Abrir', 'btn-outline btn-sm', async () => {
    setBusy(abrir, true);
    const s = await db.storage.from('pdfs').createSignedUrl(x.arquivo, 300);
    setBusy(abrir, false);
    if (s.error || !s.data) return alert('Não foi possível abrir o arquivo: ' + (s.error && s.error.message));
    window.open(s.data.signedUrl, '_blank', 'noopener');
  });
  return h('div', { class: 'row mat' },
    h('div', {}, h('strong', {}, x.titulo), h('div', { class: 'muted mono' }, x.arquivo.split('/').pop())),
    h('div', {}, x.grupo ? h('span', { class: 'tag blue' }, x.grupo) : null, ' ',
      x.ativo ? h('span', { class: 'tag green' }, 'Visível') : h('span', { class: 'tag red' }, 'Oculto')),
    h('div', { class: 'row-actions' }, h('span', { class: 'mover' }, sobe, desce), abrir,
      btn('Editar', 'btn-ghost btn-sm', () => openMateriais(p, m, x)),
      btn('Excluir', 'btn-danger btn-sm', () => excluirMaterial(p, m, x))));
}

async function excluirMaterial(p, m, x) {
  if (!confirm(`Excluir o material "${x.titulo}"? O PDF também será apagado. Isso não pode ser desfeito.`)) return;
  const del = await db.from('produto_materiais').delete().eq('id', x.id);
  if (del.error) return alert('Erro ao excluir: ' + del.error.message);
  await db.storage.from('pdfs').remove([x.arquivo]);
  window.TI.invalidateCatalogs();
  openMateriais(p, m);
}

// ─── Webhook do produto ──────────────────────────────────────────────────────
const EVENTOS = { order_approved: 'Compra aprovada', order_refunded: 'Reembolso', chargeback: 'Chargeback' };

function webhookUrl(p) {
  return `${SUPABASE_URL}/functions/v1/kiwify-webhook?produto=${encodeURIComponent(p.slug)}`;
}

function gerarToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');   // 48 caracteres
}

async function assinar(token, texto) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(texto)));
  return Array.from(sig).map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); }
  catch (e) {
    const t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = texto;
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  const antes = botao.textContent;
  botao.textContent = 'Copiado!';
  setTimeout(() => { botao.textContent = antes; }, 1800);
}

async function openWebhook(p) {
  const r = await db.from('produto_webhooks').select('token, atualizado_em').eq('produto_id', p.id).maybeSingle();
  const cab = h('div', { class: 'sub-head' }, backButton('← Voltar aos produtos', closeSub), h('h2', {}, 'Webhook de ' + p.nome));
  if (r.error) { show(cab, h('div', { class: 'empty' }, 'Erro ao carregar: ' + r.error.message)); return; }
  const token = r.data ? r.data.token : null;
  const url = webhookUrl(p);

  // 1) endereço
  const urlInput = h('input', { class: 'field-input', readonly: true, value: url, 'aria-label': 'Endereço do webhook' });
  const cUrl = btn('Copiar', 'btn-outline', () => copiar(url, cUrl));
  const bloco1 = h('div', { class: 'panel' }, h('h2', {}, '1. Endereço do webhook'),
    h('p', { class: 'muted' }, 'Cole este endereço no campo URL do webhook na Kiwify. Ele já identifica o produto.'),
    h('div', { class: 'copy-box' }, urlInput, cUrl));

  // 2) token
  const tokInput = h('input', { class: 'field-input', readonly: true, type: 'password', 'aria-label': 'Token do webhook', value: token || '' });
  const msgTok = alertBox();
  const bloco2 = h('div', { class: 'panel' }, h('h2', {}, '2. Token (chave de segurança)'));
  if (token) {
    const ver = btn('Mostrar', 'btn-ghost', () => { const o = tokInput.type === 'password'; tokInput.type = o ? 'text' : 'password'; ver.textContent = o ? 'Ocultar' : 'Mostrar'; });
    const cTok = btn('Copiar', 'btn-outline', () => copiar(token, cTok));
    bloco2.append(h('p', { class: 'muted' }, 'Cole este token no campo Token do webhook na Kiwify. Só você, como administrador, consegue ver.'),
      h('div', { class: 'copy-box' }, tokInput, h('div', { class: 'row-actions' }, ver, cTok)),
      h('div', { style: 'margin-top:10px' }, btn('Gerar novo token', 'btn-danger btn-sm', () => novoToken(p, true))), msgTok);
  } else {
    bloco2.append(h('p', { class: 'muted' }, p.slug === 'treino-inteligente'
        ? 'Este produto usa o token que já está configurado no webhook atual da Kiwify. Para trocar por um token próprio e poder testar por aqui, gere um novo e atualize o webhook na Kiwify.'
        : 'Gere o token deste produto e cole no campo Token ao criar o webhook na Kiwify.'),
      h('div', { style: 'margin-top:10px' }, btn('Gerar token do produto', 'btn-primary', () => novoToken(p, false))), msgTok);
  }

  // 3) como configurar
  const bloco3 = h('div', { class: 'panel' }, h('h2', {}, '3. Como configurar na Kiwify'),
    h('ol', { class: 'steps-list' },
      h('li', {}, 'Na Kiwify, abra Apps e depois Webhooks, e crie um novo webhook.'),
      h('li', {}, `Escolha o produto "${p.nome}" e cole o endereço e o token acima.`),
      h('li', {}, 'Marque os gatilhos: Compra aprovada, Compra reembolsada e Chargeback.'),
      h('li', {}, p.kiwify_product_id ? 'O código do produto na Kiwify já está cadastrado e será conferido a cada aviso.'
        : 'Opcional: cadastre o código do produto na Kiwify (botão Editar do produto) para o sistema conferir a cada aviso.')));

  // 4) teste
  const resultado = h('div', { class: 'result', hidden: true, role: 'status' });
  const testar = btn('Testar webhook', 'btn-primary', () => testar_(p, token, testar, resultado), { disabled: !token });
  const bloco4 = h('div', { class: 'panel' }, h('h2', {}, '4. Testar'),
    h('p', { class: 'muted' }, token
      ? 'Envia um aviso de teste assinado com o token deste produto e confere se o servidor aceita. Não cria nem altera nenhum aluno.'
      : 'Gere o token do produto (passo 2) para poder testar por aqui.'),
    h('div', { style: 'margin-top:10px' }, testar), resultado);

  show(cab, bloco1, bloco2, bloco3, bloco4, await bloco5(p));
}

async function novoToken(p, troca) {
  if (troca && !confirm('Gerar um novo token? O webhook na Kiwify deixará de funcionar até você colar o novo token lá.')) return;
  const token = gerarToken();
  const res = await db.from('produto_webhooks')
    .upsert({ produto_id: p.id, token, atualizado_em: new Date().toISOString() }, { onConflict: 'produto_id' });
  if (res.error) return alert('Não foi possível salvar o token: ' + res.error.message);
  openWebhook(p);
}

// Botão "Testar webhook": assina um aviso de teste com o token do produto e chama a função
async function testar_(p, token, botao, caixa) {
  const mostrar = (ok, texto) => { caixa.hidden = false; caixa.className = 'result ' + (ok ? 'ok' : 'erro'); caixa.textContent = texto; };
  setBusy(botao, true, 'Testando');
  try {
    const corpo = JSON.stringify({ webhook_event_type: 'teste_painel', order_id: 'teste-painel' });
    const sig = await assinar(token, corpo);
    const r = await fetch(`${webhookUrl(p)}&signature=${sig}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo });
    let j = null; try { j = await r.json(); } catch (e) { /* sem corpo */ }
    if (r.ok && j && j.ok && j.teste) {
      mostrar(true, j.token === 'proprio'
        ? `Funcionando. O servidor aceitou a assinatura e reconheceu o produto "${p.nome}". Nada foi alterado. Agora é só criar o webhook na Kiwify com este endereço e este token.`
        : 'O servidor respondeu, mas usou o token geral e não o do produto. Atualize a página e tente de novo.');
    } else if (r.status === 401) {
      mostrar(false, 'A assinatura não confere. O token salvo aqui é diferente do que o servidor usa. Gere um novo token e teste de novo.');
    } else if (r.status === 404) {
      mostrar(false, 'O servidor não encontrou este produto. Confira se o produto está salvo.');
    } else {
      mostrar(false, `O servidor respondeu com erro (${r.status}). Tente de novo em instantes.`);
    }
  } catch (e) {
    mostrar(false, 'Sem conexão com o servidor. Verifique sua internet e tente de novo.');
  } finally {
    setBusy(botao, false);
  }
}

// 5) Últimos avisos recebidos deste produto (mostra se a Kiwify está chegando)
async function bloco5(p) {
  const box = h('div', { class: 'panel' }, h('h2', {}, '5. Últimos avisos recebidos'));
  const corpo = h('div', {});
  const atualizar = btn('Atualizar', 'btn-ghost btn-sm', () => carregar());
  async function carregar() {
    clear(corpo);
    corpo.append(h('p', { class: 'muted' }, 'Carregando...'));
    const r = await db.from('webhook_eventos').select('event_type, email, recebido_em')
      .eq('produto_id', p.id).order('recebido_em', { ascending: false }).limit(8);
    clear(corpo);
    if (r.error) { corpo.append(h('p', { class: 'muted' }, 'Erro ao carregar: ' + r.error.message)); return; }
    if (!r.data || !r.data.length) {
      corpo.append(h('p', { class: 'muted' }, 'Nenhum aviso recebido ainda. Depois de criar o webhook na Kiwify, use o botão Testar Webhook de lá e clique em Atualizar.'));
      return;
    }
    r.data.forEach((e) => corpo.append(h('div', { class: 'event' },
      h('span', { class: 'muted' }, new Date(e.recebido_em).toLocaleString('pt-BR')),
      h('strong', {}, EVENTOS[e.event_type] || e.event_type),
      h('span', { class: 'mono' }, e.email || ''))));
    corpo.append(h('p', { class: 'muted', style: 'margin-top:10px' },
      'O teste da própria Kiwify usa um aluno de mentira (por exemplo, johndoe@example.com). Se ele aparecer, remova-o na aba Alunos.'));
  }
  box.append(h('div', { style: 'margin:6px 0 8px' }, atualizar), corpo);
  await carregar();
  return box;
}

window.TIAdmin = { openModulos, openMateriais, openWebhook };
})();
