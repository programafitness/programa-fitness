# INSTRUÇÕES PARA IMPLEMENTAR AS 4 FUNCIONALIDADES

## STATUS:
✅ Banco de dados atualizado (coluna app_url adicionada e produto configurado)

## ARQUIVOS A MODIFICAR:

### 1. index.html - ADICIONAR na tela de login (após o formulário de código, antes do </div> do auth-card):

```html
      <!-- Produtos disponíveis -->
      <div class="auth-products" id="authProducts">
        <h3>Conheça nossos produtos:</h3>
        <div class="auth-products-grid"></div>
      </div>
```

### 1b. index.html - ADICIONAR na viewProduct (após o <div id="searchResults">):

```html
      <!-- App embutido -->
      <div id="appFrame" class="app-frame" hidden>
        <iframe id="appIframe" title="App" allow="accelerometer; gyroscope" allowfullscreen></iframe>
      </div>
```

### 2. assets/css/app.css - ADICIONAR no final:

```css
/* Cards menores na home */
.product-card { max-width: 320px; margin: 0 auto; }
@media (min-width: 960px) { .products { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); } }

/* Produtos na tela de login */
.auth-products { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border); }
.auth-products h3 { font-size: 15px; font-weight: 600; color: var(--text-2); margin: 0 0 16px; text-align: center; }
.auth-products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.auth-product { text-align: center; text-decoration: none; }
.auth-product-cover { aspect-ratio: 1/1; border-radius: var(--r-md); overflow: hidden; margin-bottom: 8px; border: 1px solid var(--border); }
.auth-product-cover img { width: 100%; height: 100%; object-fit: cover; }
.auth-product-name { font-size: 13px; font-weight: 600; color: var(--text); }

/* App embutido (iframe) */
.app-frame { width: 100%; height: calc(100vh - 180px); min-height: 600px; border-radius: var(--r-lg); overflow: hidden; background: var(--surface); border: 1px solid var(--border); }
.app-frame iframe { width: 100%; height: 100%; border: none; }
```

### 3. assets/js/app.js - MODIFICAR a função renderProduct (linhas ~445):

```javascript
function renderProduct(p, cat) {
  $('productTitle').textContent = p.nome;
  $('productSub').textContent = p.descricao || '';
  const grid = $('modulesGrid');
  const results = $('searchResults');
  const appFrame = $('appFrame');
  const input = $('searchInput');
  
  input.value = '';
  clear(grid); clear(results);
  
  // Se o produto tem app_url, mostra o iframe
  if (p.app_url && safeLink(p.app_url)) {
    results.hidden = true;
    grid.hidden = true;
    appFrame.hidden = false;
    input.disabled = true;
    $('appIframe').src = p.app_url;
    return;
  }
  
  // Senão, mostra módulos normalmente
  appFrame.hidden = true;
  results.hidden = true;
  grid.hidden = false;

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
```

### 4. assets/js/app.js - ADICIONAR após showAuthError (linha ~130):

```javascript
// Carrega produtos para mostrar na tela de login
async function loadAuthProducts() {
  try {
    const { data } = await db.from('produtos').select('slug, nome, link_compra, capa_url').eq('ativo', true).order('ordem');
    if (!data || !data.length) return;
    
    const grid = document.querySelector('.auth-products-grid');
    if (!grid) return;
    
    clear(grid);
    data.forEach((p) => {
      const link = safeLink(p.link_compra);
      if (!link) return;
      
      const card = h('a', { class: 'auth-product', href: link, target: '_blank', rel: 'noopener' },
        h('div', { class: 'auth-product-cover' },
          imgUrl(p.capa_url) ? h('img', { src: imgUrl(p.capa_url), alt: p.nome, loading: 'lazy' }) : null),
        h('div', { class: 'auth-product-name' }, p.nome));
      grid.append(card);
    });
    
    $('authProducts').hidden = false;
  } catch (e) {
    // Falha silenciosa - produtos na tela de login são opcionais
  }
}
```

### 5. assets/js/app.js - CHAMAR loadAuthProducts() no final do arquivo, antes do addEventListener do loginBtn:

```javascript
  // Carrega produtos na tela de login
  loadAuthProducts();
```

### 6. assets/js/admin.js - ADICIONAR no formulário de produto (após o campo pCodigo, linha ~150):

Procure esta linha:
```javascript
<label class="field"><span class="field-label">Código do produto na Kiwify</span>...
```

E adicione DEPOIS dela:
```javascript
<label class="field"><span class="field-label">URL do app embutido (opcional)</span><input class="field-input" id="pAppUrl" type="url" placeholder="https://..." autocomplete="off"><span class="field-hint">Se preenchido, o produto abre este app em iframe ao invés de módulos/materiais.</span></label>
```

### 7. assets/js/admin.js - MODIFICAR a função saveProduto para incluir app_url:

Procure a linha que tem:
```javascript
const row = { nome, descricao, link_compra: link, capa_url: capa, kiwify_product_id: codigo || null, ordem, ativo };
```

E substitua por:
```javascript
const appUrl = $('pAppUrl').value.trim();
const row = { nome, descricao, link_compra: link, capa_url: capa, kiwify_product_id: codigo || null, app_url: safeLink(appUrl) || null, ordem, ativo };
```

### 8. assets/js/admin.js - ADICIONAR no resetProdForm e ao editar produto:

No resetProdForm (linha ~820), adicionar:
```javascript
$('pAppUrl').value = '';
```

Ao carregar produto para edição (função que popula o formulário), adicionar:
```javascript
$('pAppUrl').value = atual.app_url || '';
```

## RESUMO:
- ✅ Banco atualizado
- ⏳ HTML: adicionar 2 seções
- ⏳ CSS: adicionar estilos
- ⏳ app.js: modificar renderProduct + adicionar loadAuthProducts
- ⏳ admin.js: adicionar campo app_url no formulário

## TESTE:
1. Acesse o admin e edite o produto "Treino Inteligente App - Vídeos"
2. Veja que o campo URL do app já está preenchido
3. Na home, clique no produto - deve abrir o app em iframe
4. Na tela de login, deve aparecer a lista de produtos disponíveis com fotos
5. Os cards na home devem estar um pouco menores
