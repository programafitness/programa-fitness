/* ============================================================================
   TREINO INTELIGENTE - Plataforma do aluno
   Login por código (Supabase Auth) -> Home com produtos -> módulos -> materiais.
   A proteção real dos dados e dos arquivos fica nas regras (RLS) do Supabase.
   ========================================================================== */
(() => {
'use strict';

// ─── Supabase ────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ijvedpvkdvwrercnlcth.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqdmVkcHZrZHZ3cmVyY25sY3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTEyOTQsImV4cCI6MjA5NTY4NzI5NH0.cRQmESefZCdo13pBDeNhhV6Yvqi4A7f8vUkI5eg-SMU';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Só decide se o botão do painel aparece. Quem pode alterar dados é definido no banco (RLS).
const ADMINS = ['covalsqui.arrabal1@gmail.com'];

const MSG = {
  network:  'Sem conexão com o servidor. Verifique sua internet. Se estiver no Wi-Fi, tente pelos dados móveis ou troque o DNS para 8.8.8.8.',
  notFound: 'E-mail não encontrado. Verifique se usou o e-mail da compra.',
  rate:     'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  invalidEmail: 'Digite um e-mail válido.',
  badCode:  'Código inválido ou expirado. Confira o código ou peça um novo.',
  noAccess: 'Seu acesso não está ativo. Fale com o suporte.',
  generic:  'Não foi possível concluir. Tente novamente em instantes.'
};

// ─── Utilidades ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Cria elementos sem usar innerHTML (todo texto vindo do banco entra como texto puro)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(add);
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function slugify(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'produto';
}

// Aceita só links http(s)
function safeLink(u) {
  try {
    const x = new URL(String(u || '').trim());
    return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null;
  } catch { return null; }
}

// Imagens: caminho do próprio site (assets/...) ou link http(s)
function imgUrl(u) {
  const v = String(u || '').trim();
  if (/^assets\/[\w\-./]+$/.test(v) && !v.includes('..')) return v;
  return safeLink(v);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    clear(btn);
    btn.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label ? ' ' + label : '');
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function isNetworkError(error) {
  if (!error) return false;
  return error.name === 'AuthRetryableFetchError'
    || error.status === 0
    || (error.status === undefined && /fetch|network|load failed/i.test(error.message || ''));
}

function errorMessage(error) {
  if (isNetworkError(error)) return MSG.network;
  if (error && error.status === 429) return MSG.rate;
  return MSG.generic;
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ─── Estado ──────────────────────────────────────────────────────────────────
const S = {
  email: null,
  isAdmin: false,
  produtos: [],        // produtos visíveis ao aluno (o admin vê todos)
  acessos: new Set(),  // ids dos produtos que o aluno comprou
  catalogs: {},        // conteúdo (módulos e materiais) por produto
  adminProdutos: [],   // lista completa para o painel
  loadError: false,
  renderToken: 0
};

const isOwned = (p) => S.isAdmin || S.acessos.has(p.id);

// ─── Acesso (login) ──────────────────────────────────────────────────────────
let pendingEmail = null;
let resendTimer = null;

function showAuthError(msg, inputId) {
  const box = $('authError');
  box.textContent = msg;
  box.classList.add('show');
  if (inputId) {
    const inp = $(inputId);
    inp.classList.add('error');
    setTimeout(() => inp.classList.remove('error'), 2500);
  }
}
const clearAuthError = () => $('authError').classList.remove('show');

// Login do aluno: só com o e-mail. A função "entrar" confere a compra e devolve a sessão.
// Para administradores ela responde { codigo: true } e o acesso segue por código enviado ao e-mail.
async function doLogin(ev) {
  ev.preventDefault();
  const email = $('emailInput').value.trim().toLowerCase();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthError(MSG.invalidEmail, 'emailInput');
  clearAuthError();
  const btn = $('loginBtn');
  setBusy(btn, true, 'Entrando');
  try {
    const { data, error } = await db.functions.invoke('entrar', { body: { email } });

    if (error) {
      const status = error.context && error.context.status;
      if (status === 404) return showAuthError(MSG.notFound, 'emailInput');
      if (status === 429) return showAuthError(MSG.rate);
      if (status === 400) return showAuthError(MSG.invalidEmail, 'emailInput');
      if (status) return showAuthError(MSG.generic);
      return showAuthError(MSG.network);
    }

    if (data && data.codigo) {            // administrador: continua com código por e-mail
      const otp = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (otp.error) return showAuthError(errorMessage(otp.error));
      pendingEmail = email;
      return goToCodeStep();
    }

    if (data && data.ok && data.access_token && data.refresh_token) {
      const ses = await db.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (ses.error) return showAuthError(errorMessage(ses.error));
      const result = await enterApp((data.email || email).toLowerCase());
      if (result === 'network') return showAuthError(MSG.network);
      if (result !== 'ok') {
        await db.auth.signOut();
        return showAuthError(MSG.noAccess);
      }
      return;
    }
    showAuthError(MSG.generic);
  } catch (e) {
    showAuthError(MSG.network);
  } finally {
    setBusy(btn, false);
  }
}

function goToCodeStep() {
  $('codeEmailLabel').textContent = pendingEmail;
  $('authStepEmail').hidden = true;
  $('authStepCode').hidden = false;
  $('codeInput').value = '';
  $('codeInput').focus();
  startResendCooldown();
}

function backToEmail() {
  clearAuthError();
  clearInterval(resendTimer);
  pendingEmail = null;
  $('authStepCode').hidden = true;
  $('authStepEmail').hidden = false;
}

function startResendCooldown() {
  const link = $('resendLink');
  let left = 60;
  link.disabled = true;
  link.textContent = `Reenviar código (${left}s)`;
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(resendTimer);
      link.disabled = false;
      link.textContent = 'Reenviar código';
    } else {
      link.textContent = `Reenviar código (${left}s)`;
    }
  }, 1000);
}

async function resendCode() {
  if (!pendingEmail) return;
  clearAuthError();
  try {
    const { error } = await db.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true } });
    if (error) return showAuthError(errorMessage(error));
    startResendCooldown();
  } catch (e) {
    showAuthError(MSG.network);
  }
}

async function doVerify(ev) {
  ev.preventDefault();
  const token = $('codeInput').value.replace(/\s/g, '');
  if (!pendingEmail || token.length < 6) return showAuthError(MSG.badCode, 'codeInput');
  clearAuthError();
  const btn = $('verifyBtn');
  setBusy(btn, true, 'Verificando');
  try {
    const { data, error } = await db.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    if (error) {
      const bad = !isNetworkError(error) && error.status !== 429;
      return showAuthError(bad ? MSG.badCode : errorMessage(error), bad ? 'codeInput' : null);
    }
    const email = ((data.user && data.user.email) || pendingEmail).toLowerCase();
    const result = await enterApp(email);
    if (result === 'network') return showAuthError(MSG.network);
    if (result !== 'ok') {
      await db.auth.signOut();
      backToEmail();
      showAuthError(MSG.noAccess);
    }
  } catch (e) {
    showAuthError(MSG.network);
  } finally {
    setBusy(btn, false);
  }
}

// Confirma que o usuário logado é aluno ativo e abre o aplicativo
async function enterApp(email) {
  const { data, error } = await db.from('alunos').select('email, ativo')
    .eq('email', email).eq('ativo', true).maybeSingle();
  if (error) return isNetworkError(error) ? 'network' : 'noaccess';
  if (!data) return 'noaccess';

  S.email = email;
  S.isAdmin = ADMINS.includes(email);
  $('authScreen').style.display = 'none';
  $('mainApp').classList.add('visible');
  $('userEmailDisplay').textContent = email;
  $('adminBtn').hidden = !S.isAdmin;

  await loadCatalogData();
  route();
  return 'ok';
}

async function restoreSession() {
  try {
    const { data } = await db.auth.getSession();
    const email = data && data.session && data.session.user && data.session.user.email;
    if (!email) return;
    const result = await enterApp(email.toLowerCase());
    if (result === 'noaccess') await db.auth.signOut();
  } catch (e) { /* sem rede: permanece na tela de acesso */ }
}

function leaveApp() {
  S.email = null; S.isAdmin = false; S.produtos = []; S.acessos = new Set();
  pendingEmail = null;
  closePdf();
  $('mainApp').classList.remove('visible');
  $('authScreen').style.display = '';
  $('emailInput').value = '';
  $('authStepCode').hidden = true;
  $('authStepEmail').hidden = false;
  clearAuthError();
  clearInterval(resendTimer);
  history.replaceState(null, '', location.pathname + location.search);
}

async function doLogout() {
  try { await db.auth.signOut(); } catch (e) { /* encerra localmente mesmo sem rede */ }
  leaveApp();
}

// ─── Dados: produtos e acessos ───────────────────────────────────────────────
async function loadCatalogData() {
  const [p, a] = await Promise.all([
    db.from('produtos').select('*').order('ordem', { ascending: true }),
    db.from('acessos').select('produto_id, ativo').eq('email', S.email)
  ]);
  S.loadError = !!(p.error || a.error);
  S.produtos = (p.data || []).filter((x) => S.isAdmin || x.ativo);
  S.acessos = new Set((a.data || []).filter((x) => x.ativo).map((x) => x.produto_id));
}

// Catálogo (módulos e materiais) de um produto: vem do banco; o arquivo assets/data/<slug>.json é só reserva
async function getCatalog(slug) {
  if (S.catalogs[slug] !== undefined) return S.catalogs[slug];
  const prod = S.produtos.find((x) => x.slug === slug);
  let cat = null;
  if (prod) {
    try {
      const { data, error } = await db.from('produto_modulos')
        .select('slug, titulo, descricao, capa_url, ordem, boas_vindas, produto_materiais(titulo, descricao, grupo, arquivo, ordem, ativo)')
        .eq('produto_id', prod.id).eq('ativo', true)
        .order('ordem', { ascending: true });
      if (!error && data && data.length) {
        cat = {
          produto: slug,
          modulos: data.map((m) => ({
            id: m.slug, titulo: m.titulo, descricao: m.descricao || '', capa: m.capa_url || '', boasVindas: !!m.boas_vindas,
            materiais: (m.produto_materiais || []).filter((x) => x.ativo !== false)
              .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
              .map((x) => ({ titulo: x.titulo, descricao: x.descricao || '', grupo: x.grupo || '', arquivo: x.arquivo }))
          }))
        };
      }
    } catch (e) { /* usa a reserva abaixo */ }
  }
  if (!cat) {
    try {
      const r = await fetch(`assets/data/${encodeURIComponent(slug)}.json`, { cache: 'no-cache' });
      cat = r.ok ? await r.json() : null;
    } catch (e) { cat = null; }
  }
  S.catalogs[slug] = cat;
  return cat;
}

// ─── Navegação (hash) ────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
  window.scrollTo(0, 0);
  const title = document.querySelector(`#${id} h1`);
  if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
}

async function route() {
  if (!S.email) return;
  closePdf();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const token = ++S.renderToken;

  if (parts[0] === 'admin' && S.isAdmin) { showView('viewAdmin'); renderAdmin(); return; }

  if (parts[0] === 'p' && parts[1]) {
    const p = S.produtos.find((x) => x.slug === parts[1]);
    if (!p || !isOwned(p)) { location.replace('#/home'); return; }
    const cat = await getCatalog(p.slug);
    if (token !== S.renderToken) return;
    const mod = parts[2] && cat ? cat.modulos.find((m) => m.id === parts[2]) : null;
    if (mod) { renderModule(p, mod); showView('viewModule'); return; }
    renderProduct(p, cat);
    showView('viewProduct');
    return;
  }

  renderHome();
  showView('viewHome');
}

// ─── Home: Meus produtos ─────────────────────────────────────────────────────
function renderHome() {
  const grid = $('productsGrid');
  clear(grid);

  if (S.loadError) {
    grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' },
      h('p', {}, 'Não foi possível carregar seus produtos.'),
      retryButton()));
    return;
  }
  if (!S.produtos.length) {
    grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Nenhum produto disponível no momento.'));
    return;
  }
  // Liberados primeiro, bloqueados depois (a ordem de cadastro vale dentro de cada grupo)
  [...S.produtos].sort((a, b) => Number(isOwned(b)) - Number(isOwned(a)))
    .forEach((p) => grid.append(productCard(p)));
}

function retryButton() {
  const b = h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: 'margin-top:12px' }, 'Tentar novamente');
  b.addEventListener('click', async () => { await loadCatalogData(); renderHome(); });
  return b;
}

function productCard(p) {
  const owned = isOwned(p);
  const link = safeLink(p.link_compra);
  const src = imgUrl(p.capa_url);
  const href = owned ? `#/p/${encodeURIComponent(p.slug)}` : link;

  const coverInner = [
    src ? h('img', { src, alt: `Capa do produto ${p.nome}`, width: 900, height: 900, loading: 'lazy', decoding: 'async' })
        : h('div', { class: 'noimg' }, p.nome),
    h('span', { class: 'badge ' + (owned ? 'ok' : 'lock') }, owned ? 'Liberado' : '🔒 Bloqueado')
  ];
  const cover = href
    ? h('a', { class: 'product-cover', href, tabindex: '-1', 'aria-hidden': 'true',
               target: owned ? null : '_blank', rel: owned ? null : 'noopener noreferrer' }, coverInner)
    : h('div', { class: 'product-cover' }, coverInner);

  let action;
  if (owned) action = h('a', { class: 'btn btn-primary', href }, 'Acessar produto');
  else if (link) action = h('a', { class: 'btn btn-outline', href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Conhecer produto');
  else action = h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, 'Em breve');

  return h('article', { class: 'product-card' + (owned ? '' : ' locked') },
    cover,
    h('div', { class: 'product-body' },
      h('h2', { class: 'product-name' }, p.nome),
      p.descricao ? h('p', { class: 'product-desc' }, p.descricao) : null,
      action));
}

// ─── Produto: módulos ────────────────────────────────────────────────────────
const moduleHref = (p, m) => `#/p/${encodeURIComponent(p.slug)}/${encodeURIComponent(m.id)}`;

function moduleCard(p, m) {
  const n = m.materiais.length;
  const meta = m.boasVindas ? 'Comece por aqui' : `${n} ${n === 1 ? 'material' : 'materiais'}`;
  return h('a', { class: 'module-card', href: moduleHref(p, m) },
    h('div', { class: 'module-cover' },
      h('img', { src: imgUrl(m.capa) || '', alt: `Capa do módulo ${m.titulo}`, width: 720, height: 1279, loading: 'lazy', decoding: 'async' })),
    h('div', { class: 'module-name' }, m.titulo),
    h('div', { class: 'module-meta' }, meta));
}

function renderProduct(p, cat) {
  $('productTitle').textContent = p.nome;
  $('productSub').textContent = p.descricao || '';
  const grid = $('modulesGrid');
  const results = $('searchResults');
  const input = $('searchInput');
  input.value = '';
  clear(grid); clear(results);
  results.hidden = true; grid.hidden = false;

  if (!cat || !cat.modulos || !cat.modulos.length) {
    grid.hidden = true; results.hidden = false;
    results.append(h('div', { class: 'empty' }, 'O conteúdo deste produto está sendo preparado.'));
    input.disabled = true;
    return;
  }
  input.disabled = false;
  cat.modulos.forEach((m) => grid.append(moduleCard(p, m)));
  input.oninput = debounce(() => runSearch(p, cat, input.value), 120);
}

function runSearch(p, cat, raw) {
  const q = norm(raw);
  const grid = $('modulesGrid');
  const box = $('searchResults');
  clear(box);
  if (q.length < 2) { box.hidden = true; grid.hidden = false; return; }

  const mods = cat.modulos.filter((m) => norm(m.titulo + ' ' + m.descricao).includes(q));
  const mats = [];
  cat.modulos.forEach((m) => m.materiais.forEach((x) => {
    if (norm(x.titulo + ' ' + x.descricao).includes(q)) mats.push({ m, x });
  }));

  grid.hidden = true; box.hidden = false;
  if (!mods.length && !mats.length) {
    box.append(h('div', { class: 'empty' }, `Nada encontrado para “${raw.trim()}”.`));
    return;
  }
  if (mods.length) {
    box.append(h('h2', { class: 'group-title' }, 'Módulos'));
    box.append(h('div', { class: 'modules' }, mods.map((m) => moduleCard(p, m))));
  }
  if (mats.length) {
    box.append(h('h2', { class: 'group-title' }, 'Materiais'));
    box.append(h('div', { class: 'materials' }, mats.map(({ m, x }) => materialCard(x, m.titulo))));
  }
}

// ─── Módulo: materiais ───────────────────────────────────────────────────────
const WELCOME_STEPS = [
  ['Escolha um módulo', 'Na tela do produto, toque na capa do módulo que você quer treinar.'],
  ['Abra o material', 'Toque em “Abrir material” para ver o treino na tela, sem sair da plataforma.'],
  ['Baixe para guardar', 'Toque em “Baixar material” para salvar o arquivo no seu aparelho.']
];

function renderModule(p, m) {
  $('moduleTitle').textContent = m.titulo;
  $('moduleSub').textContent = m.descricao || '';
  const img = $('moduleCover');
  img.src = imgUrl(m.capa) || '';
  img.alt = `Capa do módulo ${m.titulo}`;
  $('backToModules').href = `#/p/${encodeURIComponent(p.slug)}`;

  const body = $('moduleBody');
  clear(body);

  if (m.boasVindas) {
    body.append(h('ol', { class: 'steps' },
      WELCOME_STEPS.map(([t, d]) => h('li', {}, h('div', {}, h('strong', {}, t), h('span', {}, d))))));
    return;
  }
  if (!m.materiais.length) {
    body.append(h('div', { class: 'empty' }, 'Os materiais deste módulo estão sendo preparados.'));
    return;
  }

  // Agrupa por "grupo" quando existir (ex.: Academia / Em casa)
  const grupos = [];
  m.materiais.forEach((x) => {
    const nome = x.grupo || '';
    let g = grupos.find((b) => b.nome === nome);
    if (!g) { g = { nome, itens: [] }; grupos.push(g); }
    g.itens.push(x);
  });
  grupos.forEach((g) => {
    if (g.nome) body.append(h('h2', { class: 'group-title' }, g.nome));
    body.append(h('div', { class: 'materials' }, g.itens.map((x) => materialCard(x))));
  });
}

function materialCard(x, moduloNome) {
  const openBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Abrir material');
  const dlBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Baixar material');
  openBtn.addEventListener('click', () => openMaterial(x, openBtn));
  dlBtn.addEventListener('click', () => downloadMaterial(x, dlBtn));
  return h('div', { class: 'material' },
    h('div', { class: 'material-info' },
      h('div', { class: 'material-title' }, x.titulo),
      x.descricao ? h('div', { class: 'material-desc' }, x.descricao) : null,
      moduloNome ? h('div', { class: 'material-from' }, `Módulo: ${moduloNome}`) : null),
    h('div', { class: 'material-actions' }, openBtn, dlBtn));
}

// ─── Visualizador / download ─────────────────────────────────────────────────
let currentMaterial = null;

async function signedUrl(path, opts) {
  const { data, error } = await db.storage.from('pdfs').createSignedUrl(path, 3600, opts);
  return (error || !data || !data.signedUrl) ? null : data.signedUrl;
}

async function openMaterial(x, btn) {
  setBusy(btn, true, 'Abrindo');
  const url = await signedUrl(x.arquivo);
  setBusy(btn, false);
  if (!url) { alert('Não foi possível abrir este material agora. Tente novamente em instantes.'); return; }

  currentMaterial = x;
  $('pdfTitle').textContent = x.titulo;
  $('pdfLoading').hidden = false;
  const frame = $('pdfFrame');
  frame.onload = () => { $('pdfLoading').hidden = true; };
  frame.src = 'https://docs.google.com/viewer?url=' + encodeURIComponent(url) + '&embedded=true';
  setTimeout(() => { $('pdfLoading').hidden = true; }, 8000);
  $('pdfModal').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('pdfClose').focus();
}

function closePdf() {
  const m = $('pdfModal');
  if (!m.classList.contains('open')) return;
  m.classList.remove('open');
  $('pdfFrame').onload = null;
  $('pdfFrame').src = 'about:blank';
  document.body.style.overflow = '';
  currentMaterial = null;
}

async function downloadMaterial(x, btn) {
  setBusy(btn, true, 'Preparando');
  const filename = x.titulo.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
  const url = await signedUrl(x.arquivo, { download: filename });
  setBusy(btn, false);
  if (!url) { alert('Não foi possível baixar este material agora. Tente novamente em instantes.'); return; }
  const a = h('a', { href: url, download: filename, rel: 'noopener' });
  document.body.appendChild(a); a.click(); a.remove();
}

// ─── Painel Admin ────────────────────────────────────────────────────────────
let editingId = null;
let editingCapa = null;

function adminTab(which) {
  const alunos = which === 'alunos';
  $('tabAlunos').setAttribute('aria-selected', String(alunos));
  $('tabProdutos').setAttribute('aria-selected', String(!alunos));
  $('paneAlunos').hidden = !alunos;
  $('paneProdutos').hidden = alunos;
}

async function renderAdmin() {
  await loadAdminProdutos();
  await loadAdminAlunos();
}

// Lista completa (inclui produtos ocultos), guardada para a edição
async function fetchAllProdutos() {
  const { data } = await db.from('produtos').select('*').order('ordem', { ascending: true });
  S.adminProdutos = data || [];
  return S.adminProdutos;
}

async function loadAdminAlunos() {
  const list = $('alunosList');
  clear(list);
  list.append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' Carregando...'));

  const prods = S.adminProdutos.length ? S.adminProdutos : await fetchAllProdutos();
  const sel = $('newProduto');
  const keep = sel.value;
  clear(sel);
  prods.forEach((p) => sel.append(h('option', { value: p.id }, p.nome + (p.ativo ? '' : ' (oculto)'))));
  if (keep) sel.value = keep;
  const nomeDe = Object.fromEntries(prods.map((p) => [p.id, p.nome]));

  const { data, error } = await db.from('acessos')
    .select('id, email, ativo, origem, criado_em, produto_id').order('criado_em', { ascending: false });
  clear(list);
  if (error || !data) { list.append(h('div', { class: 'empty' }, 'Erro ao carregar dados.')); return; }

  const hoje = new Date().toDateString();
  let hojeN = 0, compraN = 0;
  const ativos = new Set();
  data.forEach((a) => {
    if (a.ativo) ativos.add(a.email);
    if (new Date(a.criado_em).toDateString() === hoje) hojeN++;
    if (a.origem === 'kiwify' || a.origem === 'hotmart') compraN++;
  });
  $('totalCount').textContent = ativos.size;
  $('todayCount').textContent = hojeN;
  $('compraCount').textContent = compraN;

  if (!data.length) { list.append(h('div', { class: 'empty' }, 'Nenhum aluno cadastrado.')); return; }

  data.forEach((a) => {
    const origem = a.origem === 'kiwify' ? h('span', { class: 'tag blue' }, 'Kiwify')
      : a.origem === 'hotmart' ? h('span', { class: 'tag amber' }, 'Hotmart')
      : a.origem === 'admin' ? h('span', { class: 'tag purple' }, 'Admin')
      : h('span', { class: 'tag purple' }, 'Manual');
    const status = a.ativo ? h('span', { class: 'tag green' }, 'Ativo') : h('span', { class: 'tag red' }, 'Inativo');
    let rm = h('span', {});
    if (!ADMINS.includes(a.email)) {
      rm = h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': `Remover acesso de ${a.email}` }, 'Remover');
      rm.addEventListener('click', () => removeAcesso(a, rm));
    }
    list.append(h('div', { class: 'row' },
      h('div', { class: 'mono' }, a.email),
      h('div', {}, nomeDe[a.produto_id] || 'Produto removido',
        h('div', { class: 'muted' }, new Date(a.criado_em).toLocaleDateString('pt-BR'))),
      origem, status, rm));
  });
}

async function addAcesso(ev) {
  ev.preventDefault();
  const msg = $('addMsg');
  msg.className = 'alert';
  const email = $('newEmail').value.trim().toLowerCase();
  const produtoId = $('newProduto').value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Digite um e-mail válido.'; msg.classList.add('show'); return; }
  if (!produtoId) { msg.textContent = 'Escolha um produto.'; msg.classList.add('show'); return; }

  const btn = $('addBtn');
  setBusy(btn, true);
  // 1) cadastra o aluno (sem trocar a origem de quem já existe) e garante o login ativo
  let err = (await db.from('alunos').upsert({ email, origem: 'manual', ativo: true }, { onConflict: 'email', ignoreDuplicates: true })).error;
  if (!err) err = (await db.from('alunos').update({ ativo: true }).eq('email', email)).error;
  // 2) libera o produto escolhido
  if (!err) err = (await db.from('acessos').upsert({ email, produto_id: produtoId, ativo: true, origem: 'manual' }, { onConflict: 'email,produto_id' })).error;
  setBusy(btn, false);

  if (err) { msg.textContent = 'Erro: ' + err.message; msg.classList.add('show'); return; }
  $('newEmail').value = '';
  msg.textContent = 'Acesso liberado.';
  msg.classList.add('show', 'ok');
  loadAdminAlunos();
}

async function removeAcesso(a, btn) {
  if (!confirm(`Remover o acesso de ${a.email} a este produto?`)) return;
  btn.disabled = true;
  const del = await db.from('acessos').delete().eq('id', a.id);
  if (del.error) { btn.disabled = false; alert('Erro ao remover.'); return; }
  // sem nenhum outro acesso ativo, o login também é desativado
  const rest = await db.from('acessos').select('id').eq('email', a.email).eq('ativo', true).limit(1);
  if (!rest.error && (!rest.data || !rest.data.length) && !ADMINS.includes(a.email)) {
    await db.from('alunos').update({ ativo: false }).eq('email', a.email);
  }
  loadAdminAlunos();
}

async function loadAdminProdutos() {
  const list = $('prodList');
  const prods = await fetchAllProdutos();
  clear(list);
  if (!prods.length) { list.append(h('div', { class: 'empty' }, 'Nenhum produto cadastrado.')); return; }
  prods.forEach((p) => {
    const src = imgUrl(p.capa_url);
    const edit = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Editar');
    edit.addEventListener('click', () => startEditProduto(p));
    const mods = h('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Módulos');
    mods.addEventListener('click', () => openAdminSub('openModulos', p));
    const hook = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Webhook');
    hook.addEventListener('click', () => openAdminSub('openWebhook', p));
    list.append(h('div', { class: 'row prod' },
      src ? h('img', { class: 'thumb', src, alt: '', loading: 'lazy', width: 56, height: 56 }) : h('div', { class: 'thumb' }),
      h('div', {}, h('strong', {}, p.nome), h('div', { class: 'muted' }, p.slug)),
      h('div', { class: 'muted mono' }, safeLink(p.link_compra) ? p.link_compra : 'Sem link de compra'),
      p.ativo ? h('span', { class: 'tag green' }, 'Visível') : h('span', { class: 'tag red' }, 'Oculto'),
      h('div', { class: 'row-actions' }, mods, hook, edit)));
  });
}

function resetProdForm() {
  editingId = null; editingCapa = null;
  $('prodForm').reset();
  $('pOrdem').value = String((S.adminProdutos.length + 1) * 10);
  $('pAtivo').checked = true;
  $('prodFormTitle').textContent = 'Novo produto';
  $('pCancel').hidden = true;
  $('pPreview').hidden = true;
  $('prodMsg').className = 'alert';
}

function startEditProduto(p) {
  editingId = p.id; editingCapa = p.capa_url || null;
  $('prodFormTitle').textContent = 'Editar produto';
  $('pNome').value = p.nome || '';
  $('pLink').value = p.link_compra || '';
  $('pDesc').value = p.descricao || '';
  $('pCodigo').value = p.kiwify_product_id || '';
  $('pOrdem').value = p.ordem ?? 0;
  $('pAtivo').checked = !!p.ativo;
  $('pFoto').value = '';
  const src = imgUrl(p.capa_url);
  $('pPreview').hidden = !src;
  if (src) $('pPreview').src = src;
  $('pCancel').hidden = false;
  $('prodMsg').className = 'alert';
  $('prodForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveProduto(ev) {
  ev.preventDefault();
  const msg = $('prodMsg');
  const fail = (t) => { msg.textContent = t; msg.className = 'alert show'; };
  msg.className = 'alert';

  const nome = $('pNome').value.trim();
  const linkRaw = $('pLink').value.trim();
  const link = linkRaw ? safeLink(linkRaw) : null;
  const codigo = $('pCodigo').value.trim() || null;
  const ordem = parseInt($('pOrdem').value, 10);
  const file = $('pFoto').files[0];

  if (!nome) return fail('Informe o nome do produto.');
  if (linkRaw && !link) return fail('O link de compra precisa começar com https://');
  if (codigo && !/^[0-9a-fA-F-]{8,64}$/.test(codigo)) return fail('O código da Kiwify deve conter apenas letras de a a f, números e hífens.');
  if (!Number.isFinite(ordem) || ordem < 0) return fail('Informe uma ordem válida (número).');
  if (file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return fail('A foto deve ser PNG, JPG ou WebP.');
    if (file.size > 3 * 1024 * 1024) return fail('A foto deve ter no máximo 3 MB.');
  }

  const btn = $('pSave');
  setBusy(btn, true, 'Salvando');
  try {
    const atual = editingId ? S.adminProdutos.find((x) => x.id === editingId) : null;
    const slug = atual ? atual.slug : slugify(nome);

    let capa = editingCapa;
    if (file) {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `produtos/${slug}-${Date.now()}.${ext}`;
      const up = await db.storage.from('images').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) return fail('Não foi possível enviar a foto: ' + up.error.message);
      capa = db.storage.from('images').getPublicUrl(path).data.publicUrl;
    }

    const row = {
      nome, descricao: $('pDesc').value.trim() || null, link_compra: link,
      kiwify_product_id: codigo, ordem, ativo: $('pAtivo').checked, capa_url: capa
    };
    let res;
    if (editingId) {
      res = await db.from('produtos').update(row).eq('id', editingId);
    } else {
      res = await db.from('produtos').insert({ ...row, slug });
      if (res.error && res.error.code === '23505' && /slug/.test(res.error.message || '')) {
        res = await db.from('produtos').insert({ ...row, slug: `${slug}-${Date.now().toString(36).slice(-4)}` });
      }
    }
    if (res.error) {
      return fail(res.error.code === '23505' ? 'Já existe um produto com esse código da Kiwify.' : 'Erro: ' + res.error.message);
    }

    await loadCatalogData();
    await loadAdminProdutos();
    resetProdForm();
    msg.textContent = 'Produto salvo.';
    msg.className = 'alert show ok';
    loadAdminAlunos();
  } catch (e) {
    fail(MSG.network);
  } finally {
    setBusy(btn, false);
  }
}

// ─── Telas de administração carregadas sob demanda (módulos, materiais, webhook) ──
// O código fica em assets/js/admin.js e só é baixado quando o administrador abre uma delas.
let adminScript = null;

function loadAdminScript() {
  if (window.TIAdmin) return Promise.resolve();
  if (adminScript) return adminScript;
  adminScript = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'assets/js/admin.js?v=1';
    s.onload = resolve;
    s.onerror = () => { adminScript = null; reject(new Error('admin.js')); };
    document.head.appendChild(s);
  });
  return adminScript;
}

async function openAdminSub(fn, produto) {
  try {
    await loadAdminScript();
    window.TIAdmin[fn](produto);
  } catch (e) {
    alert('Não foi possível abrir esta tela agora. Verifique sua conexão e tente novamente.');
  }
}

// Peças que o admin.js reaproveita
window.TI = {
  db, S, h, $, clear, setBusy, safeLink, imgUrl, slugify, MSG, SUPABASE_URL,
  reloadProdutos: async () => { await loadCatalogData(); await loadAdminProdutos(); },
  invalidateCatalogs: () => { S.catalogs = {}; }
};

// ─── Inicialização ───────────────────────────────────────────────────────────
function init() {
  $('authStepEmail').addEventListener('submit', doLogin);
  $('authStepCode').addEventListener('submit', doVerify);
  $('resendLink').addEventListener('click', resendCode);
  $('changeEmailLink').addEventListener('click', backToEmail);
  $('logoutBtn').addEventListener('click', doLogout);
  $('brandBtn').addEventListener('click', () => {
    if (location.hash === '#/home') route(); else location.hash = '#/home';
  });
  $('adminBtn').addEventListener('click', () => { location.hash = '#/admin'; });
  $('pdfClose').addEventListener('click', closePdf);
  $('pdfDownload').addEventListener('click', () => { if (currentMaterial) downloadMaterial(currentMaterial, $('pdfDownload')); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePdf(); });
  window.addEventListener('hashchange', route);

  $('tabAlunos').addEventListener('click', () => adminTab('alunos'));
  $('tabProdutos').addEventListener('click', () => adminTab('produtos'));
  $('addForm').addEventListener('submit', addAcesso);
  $('prodForm').addEventListener('submit', saveProduto);
  $('pCancel').addEventListener('click', resetProdForm);
  $('pFoto').addEventListener('change', () => {
    const f = $('pFoto').files[0];
    if (f) { $('pPreview').src = URL.createObjectURL(f); $('pPreview').hidden = false; return; }
    const s = imgUrl(editingCapa);
    $('pPreview').hidden = !s;
    if (s) $('pPreview').src = s;
  });

  db.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT' && S.email) leaveApp(); });
  resetProdForm();
  restoreSession();
}

init();
})();
