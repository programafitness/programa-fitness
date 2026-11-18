# Deploy das Edge Functions no Supabase

As Edge Functions do Supabase precisam ser implantadas via **Supabase CLI** ou pelo **dashboard**.

## Opção 1: Via Supabase CLI (Recomendado)

### Instalação do CLI

```bash
# Windows (via npm)
npm install -g supabase

# Ou via Chocolatey
choco install supabase
```

### Login no Supabase

```bash
supabase login
```

Isso abrirá o navegador para você autorizar o CLI.

### Deploy da função

```bash
cd c:\Users\Casa\.claude\fitness-site
supabase functions deploy kiwify-webhook
```

O CLI vai:
1. Empacotar a função e as dependências (`_shared/resend.ts`)
2. Fazer o upload para o Supabase
3. Ativar a nova versão

### Verificar o deploy

```bash
supabase functions list
```

## Opção 2: Via Dashboard do Supabase

1. Acesse: https://supabase.com/dashboard/project/ijvedpvkdvwrercnlcth/functions
2. Clique em **kiwify-webhook**
3. Clique em **Edit** ou **Deploy new version**
4. Cole o conteúdo de `supabase/functions/kiwify-webhook/index.ts`
5. Certifique-se de que o módulo `_shared/resend.ts` também está disponível
6. Clique em **Deploy**

**Nota**: O dashboard pode não suportar módulos compartilhados (`_shared`). Por isso, o CLI é a opção mais segura.

## Testando após o deploy

### 1. Teste básico (sem e-mail)

Envie um POST para:
```
https://ijvedpvkdvwrercnlcth.supabase.co/functions/v1/kiwify-webhook?produto=treino-inteligente
```

Com o payload de teste do painel admin (evento `teste_painel`).

### 2. Teste completo (com e-mail)

Simule uma compra aprovada enviando:

```json
{
  "webhook_event_type": "order_approved",
  "order_id": "TEST-001",
  "Customer": {
    "email": "seu-email-de-teste@example.com",
    "first_name": "João"
  },
  "Product": {
    "product_id": "codigo-do-produto-na-kiwify"
  }
}
```

Não esqueça de calcular a assinatura HMAC-SHA1 e incluir como `?signature=...`

### 3. Verificar logs

No dashboard do Supabase:
1. Vá em **Edge Functions** → **kiwify-webhook**
2. Clique em **Logs**
3. Veja se o e-mail foi enviado ou se houve algum erro

### 4. Verificar tabela de e-mails

```sql
SELECT * FROM public.emails_enviados 
ORDER BY enviado_em DESC 
LIMIT 10;
```

## O que está pronto

✅ Código da função com integração Resend
✅ Tabela `emails_enviados` criada no banco
✅ Módulo `_shared/resend.ts` com template de e-mail
✅ Chave `RESEND_API_KEY` configurada no Supabase
✅ Domínio verificado na Resend

## Próximo passo

Fazer o deploy via CLI:
```bash
supabase functions deploy kiwify-webhook
```
