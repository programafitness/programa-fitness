/* ============================================================================
   TREINO INTELIGENTE - Modo livro (folhear o PDF como um livro)
   Carregado sob demanda por app.js. Usa PDF.js (Apache-2.0) para desenhar as páginas
   e StPageFlip (MIT) para o efeito de virar a página. Ambos ficam em assets/vendor/.
   ========================================================================== */
(() => {
'use strict';

const VENDOR = 'assets/vendor/';
let libs = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar ' + src));
    document.head.appendChild(s);
  });
}

function carregarLibs() {
  if (!libs) {
    libs = Promise.all([
      carregarScript(VENDOR + 'pdfjs/pdf.min.js'),
      carregarScript(VENDOR + 'pageflip/page-flip.browser.js')
    ]).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.js';
    }).catch((e) => { libs = null; throw e; });
  }
  return libs;
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, v === true ? '' : v);
  }
  kids.forEach((c) => n.append(c));
  return n;
}

const reduzMovimento = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Desenha uma página do PDF numa imagem JPEG (Blob). `larguraAlvo` em pixels reais da tela.
async function paginaParaBlob(pdf, numero, larguraAlvo) {
  const page = await pdf.getPage(numero);
  const base = page.getViewport({ scale: 1 });
  const escala = Math.max(1, Math.min(3, larguraAlvo / base.width));
  const vp = page.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  canvas.width = canvas.height = 0;   // libera a memória do canvas
  page.cleanup();
  return blob;
}

// ─── Livro ───────────────────────────────────────────────────────────────────
let atual = null;   // livro aberto no momento

async function abrir(raiz, url) {
  fechar();
  await carregarLibs();

  const pdf = await window.pdfjsLib.getDocument({ url }).promise;
  const total = pdf.numPages;
  const p1 = await pdf.getPage(1);
  const vp1 = p1.getViewport({ scale: 1 });
  const razao = vp1.width / vp1.height;
  p1.cleanup();

  // estrutura da tela
  const palco = el('div', { class: 'book-stage' });
  const info = el('span', { class: 'book-info', 'aria-live': 'polite' });
  const bPrev = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Página anterior' }, '‹ Anterior');
  const bNext = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Próxima página' }, 'Próxima ›');
  const bZoom = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Ampliar');
  const controles = el('div', { class: 'book-controls' }, bPrev, info, bNext, bZoom);
  const carga = el('div', { class: 'book-loading' }, 'Preparando as páginas...');
  const zoomImgs = el('div', { class: 'book-zoom-imgs' });
  const zoomFechar = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '← Voltar ao livro');
  const zoom = el('div', { class: 'book-zoom', hidden: true, role: 'dialog', 'aria-label': 'Página ampliada' },
    el('div', { class: 'book-zoom-bar' }, zoomFechar, el('span', { class: 'muted' }, 'Arraste para ver e use dois dedos para aproximar')),
    el('div', { class: 'book-zoom-scroll' }, zoomImgs));
  raiz.append(palco, controles, carga, zoom);

  const L = Math.max(240, palco.clientWidth || 360);
  const A = Math.max(320, palco.clientHeight || 520);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const duplo = L >= 480;
  const larguraPagina = duplo ? Math.min(L / 2, A * razao) : Math.min(L, A * razao);
  const alvoPx = Math.round(larguraPagina * dpr);

  // uma <div> por página, com imagem preenchida aos poucos
  const paginas = [];
  for (let i = 1; i <= total; i++) {
    const img = el('img', { alt: `Página ${i} de ${total}`, draggable: 'false' });
    const div = el('div', { class: 'livro-pagina', 'data-density': (i === 1 || i === total) ? 'hard' : 'soft' }, img);
    paginas.push({ numero: i, div, img, url: null, pronta: false });
  }

  const St = window.St;
  const flip = new St.PageFlip(palco, {
    width: Math.round(larguraPagina), height: Math.round(larguraPagina / razao),
    size: 'stretch', minWidth: 240, maxWidth: 1100, minHeight: 320, maxHeight: 1600,
    drawShadow: true, maxShadowOpacity: 0.45, showCover: true, usePortrait: true,
    flippingTime: reduzMovimento() ? 1 : 750, mobileScrollSupport: false, swipeDistance: 24,
    autoSize: true, startPage: 0
  });
  flip.loadFromHTML(paginas.map((p) => p.div));

  const estado = { pdf, total, razao, alvoPx, paginas, flip, fila: [], rodando: false, fechado: false, urls: [], teclado: null, raiz, ok: true };
  atual = estado;

  // fila de desenho: as páginas perto de onde o leitor está vão primeiro
  const pedir = (numeros, urgente) => {
    const novos = numeros.filter((n) => n >= 1 && n <= total && !paginas[n - 1].pronta && !estado.fila.includes(n));
    estado.fila = urgente ? novos.concat(estado.fila) : estado.fila.concat(novos);
    if (!estado.rodando) processar();
  };
  async function processar() {
    estado.rodando = true;
    while (estado.fila.length && !estado.fechado) {
      const n = estado.fila.shift();
      const p = paginas[n - 1];
      if (p.pronta) continue;
      try {
        const blob = await paginaParaBlob(pdf, n, alvoPx);
        if (estado.fechado) break;
        p.url = URL.createObjectURL(blob);
        estado.urls.push(p.url);
        p.img.src = p.url;
        p.pronta = true;
        p.div.classList.add('pronta');
      } catch (e) {
        p.div.classList.add('erro');
        p.pronta = true;
      }
      if (n <= 2) carga.hidden = true;
    }
    estado.rodando = false;
    if (!estado.fechado && paginas.every((q) => q.pronta)) carga.hidden = true;
  }

  const indice = () => flip.getCurrentPageIndex();
  const retrato = () => flip.getOrientation() === 'portrait';
  function visiveis() {              // números (1..N) das páginas na tela
    const i = indice();
    if (retrato() || i === 0) return [i + 1];
    const esq = i % 2 === 1 ? i : i - 1;
    return [esq + 1, esq + 2].filter((n) => n <= total);
  }
  function atualizar() {
    const v = visiveis();
    info.textContent = v.length === 2 ? `Páginas ${v[0]}–${v[1]} de ${total}` : `Página ${v[0]} de ${total}`;
    bPrev.disabled = v[0] <= 1;
    bNext.disabled = v[v.length - 1] >= total;
    pedir(v.concat([v[v.length - 1] + 1, v[v.length - 1] + 2, v[0] - 1]), true);
  }
  flip.on('flip', atualizar);
  flip.on('changeOrientation', atualizar);
  bPrev.addEventListener('click', () => flip.flipPrev());
  bNext.addEventListener('click', () => flip.flipNext());

  estado.teclado = (e) => {
    if (zoom.hidden === false) { if (e.key === 'Escape') { zoom.hidden = true; e.stopPropagation(); } return; }
    if (e.key === 'ArrowRight') flip.flipNext();
    else if (e.key === 'ArrowLeft') flip.flipPrev();
  };
  document.addEventListener('keydown', estado.teclado, true);

  // Ampliar: mostra as páginas atuais em alta resolução, com rolagem e zoom por pinça
  bZoom.addEventListener('click', async () => {
    const v = visiveis();
    clear_(zoomImgs);
    zoomImgs.append(el('p', { class: 'muted' }, 'Preparando a página...'));
    zoom.hidden = false;
    try {
      const imgs = [];
      for (const n of v) {
        const blob = await paginaParaBlob(pdf, n, Math.min(2200, Math.round(window.innerWidth * dpr * 1.6)));
        const u = URL.createObjectURL(blob);
        estado.urls.push(u);
        imgs.push(el('img', { src: u, alt: `Página ${n} ampliada` }));
      }
      clear_(zoomImgs);
      imgs.forEach((i) => zoomImgs.append(i));
    } catch (e) {
      clear_(zoomImgs);
      zoomImgs.append(el('p', { class: 'muted' }, 'Não foi possível ampliar esta página.'));
    }
  });
  zoomFechar.addEventListener('click', () => { zoom.hidden = true; });

  atualizar();
  pedir([1, 2, 3, 4], true);
  const resto = []; for (let i = 5; i <= total; i++) resto.push(i);
  pedir(resto, false);
  return { total, duplo };
}

function clear_(n) { while (n.firstChild) n.removeChild(n.firstChild); }

function fechar() {
  const a = atual;
  if (!a) return;
  atual = null;
  a.fechado = true;
  if (a.teclado) document.removeEventListener('keydown', a.teclado, true);
  try { a.flip.destroy(); } catch (e) { /* já destruído */ }
  a.urls.forEach((u) => URL.revokeObjectURL(u));
  try { a.pdf.destroy(); } catch (e) { /* ignorar */ }
  clear_(a.raiz);
}

window.TILivro = { abrir, fechar, aberto: () => !!atual };
})();
