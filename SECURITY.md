# Política de segurança

## Como relatar uma vulnerabilidade

Não abra uma issue pública e não inclua segredos ou dados pessoais em exemplos.
Use **Security → Report a vulnerability** no repositório GitHub para enviar um
relato privado ao mantenedor.

Inclua, quando possível:

- componente e versão afetados;
- impacto e condições necessárias;
- passos mínimos para reprodução;
- sugestão de correção, se houver;
- confirmação de que nenhum ambiente de terceiros foi acessado sem autorização.

O mantenedor deve confirmar o recebimento pelo mesmo canal, avaliar a gravidade
e coordenar correção e divulgação. Prazos de resposta serão publicados quando o
projeto definir uma equipe permanente de manutenção.

## Escopo prioritário

- isolamento entre empresas e políticas RLS;
- autenticação, setup inicial e gestão de usuários;
- exposição de chaves Supabase, Kommo ou Meta;
- criptografia e rotação de credenciais;
- webhooks, worker, filas e deduplicação;
- injeção, execução remota e acesso indevido a dados.

Cada operador é responsável por manter sua instalação, dependências, backups e
segredos atualizados. Nunca use uma instalação de produção para testar um relato.
