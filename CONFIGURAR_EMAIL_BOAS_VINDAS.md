# Configuração do E-mail de Boas-Vindas

O webhook da Kiwify envia automaticamente um e-mail de boas-vindas quando a compra do **Treino Inteligente** for aprovada.

## Pré-requisitos

1. **Conta na Resend**: crie uma conta em https://resend.com/
2. **Domínio verificado**: adicione e verifique o domínio `treinointeligente.com.br` na Resend
3. **Chave de API**: gere uma API Key na Resend (Settings → API Keys)

## Configuração no Supabase

1. Acesse o dashboard do Supabase: https://supabase.com/dashboard/project/ijvedpvkdvwrercnlcth
2. Vá em **Project Settings** → **Edge Functions** → **Manage secrets**
3. Adicione o segredo:
   - Nome: `RESEND_API_KEY`
   - Valor: a chave que começa com `re_...` (copie da Resend)
4. Clique em **Save**

## Verificação do Domínio na Resend

1. Na Resend, vá em **Domains** → **Add Domain**
2. Digite: `treinointeligente.com.br`
3. Adicione os registros DNS fornecidos pela Resend no seu provedor de DNS (Cloudflare, GoDaddy, etc.):
   - Registro **TXT** para verificação
   - Registros **MX**, **TXT (DKIM)** e **CNAME** para envio

Aguarde a propagação (alguns minutos) e verifique o status na Resend.

## Remetentes Permitidos

Após a verificação do domínio, você pode enviar e-mails de qualquer endereço `*@treinointeligente.com.br`.

O e-mail de boas-vindas usa:
- **De**: `Treino Inteligente <acesso@treinointeligente.com.br>`
- **Reply-To**: `suporte@treinointeligente.com.br`

## Testando

Depois de configurar a chave, simule uma compra aprovada enviando um webhook para:
```
https://ijvedpvkdvwrercnlcth.supabase.co/functions/v1/kiwify-webhook?produto=treino-inteligente
```

O e-mail será enviado automaticamente para o e-mail que vier no payload da Kiwify.

## Como Funciona

1. Quando a Kiwify envia `order_approved` do Treino Inteligente, o webhook:
   - Libera o acesso do cliente
   - Verifica se já enviou e-mail para este `order_id`
   - Se não, monta e envia o e-mail via Resend
   - Registra o envio na tabela `emails_enviados`

2. Se o envio falhar, o erro é registrado mas o acesso é liberado normalmente (o e-mail não bloqueia a compra).

3. A Kiwify pode reenviar o mesmo webhook várias vezes. O sistema garante que o e-mail só é enviado uma vez por pedido.

## Troubleshooting

### E-mail não foi enviado
- Verifique se `RESEND_API_KEY` está configurada no Supabase
- Confira os logs da Edge Function no dashboard do Supabase
- Veja a tabela `emails_enviados` para checar se houve erro

### Domínio não verificado
- Aguarde até 24h após adicionar os registros DNS
- Use o verificador DNS da Resend para conferir os registros
- Certifique-se de que os registros foram adicionados corretamente (atenção ao nome e valor)

### E-mail cai no spam
- Certifique-se de que os registros SPF, DKIM e DMARC estão configurados
- Peça aos usuários para adicionarem `acesso@treinointeligente.com.br` aos contatos
- Considere aquecer o domínio enviando poucos e-mails inicialmente
