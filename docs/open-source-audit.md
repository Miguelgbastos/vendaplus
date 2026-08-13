# Auditoria inicial para abertura do repositório

Data da revisão: 13 de agosto de 2026.

## Escopo verificado

- histórico Git completo alcançável por todas as branches remotas;
- arquivos versionados na `main` após o merge do PR #20;
- nomes de arquivos sensíveis e regras de exclusão do `.gitignore`;
- referências específicas a clientes, domínios, e-mails e infraestrutura;
- documentação comunitária, CI e configuração do repositório.

## Resultado

O Gitleaks 8.30.1 analisou o histórico e encontrou uma ocorrência classificada
manualmente como falso positivo: um JWT deliberadamente fictício no teste de
sanitização de erros OAuth. Nenhuma credencial real foi identificada.

A auditoria inicial do npm encontrou cinco vulnerabilidades altas em
dependências. O Next.js foi atualizado de 16.2.12 para 16.3.0 e as dependências
transitivas corrigidas foram renovadas; a nova auditoria terminou sem
vulnerabilidades conhecidas.

O histórico antigo contém um identificador de projeto Supabase que depois foi
substituído por um placeholder. O identificador não é uma credencial e não
permite acesso ao banco sem uma chave, mas se tornará visível quando o histórico
for público. Reescrever o histórico apenas para removê-lo quebraria hashes,
branches e referências de pull requests; por isso, a recomendação é confirmar
que todas as chaves desse projeto estão protegidas e manter a rastreabilidade.

Os metadados dos commits também expõem os nomes e e-mails dos respectivos
autores, como ocorre normalmente em um repositório Git público.

## Pendências antes da mudança de visibilidade

- confirmar o mantenedor e a política inicial de versões;
- testar uma instalação limpa em um projeto Supabase descartável;
- habilitar Discussions, private vulnerability reporting, secret scanning e
  push protection, conforme disponibilidade no plano do GitHub;
- configurar proteção da `main`, exigindo o check `validate` e revisão de pull
  request antes do merge;
- revisar as branches antigas e apagar somente as que o proprietário considerar
  obsoletas, sem presumir que possam ser removidas;
- fazer a confirmação final antes de alterar a visibilidade para pública.

## Limitações

Uma varredura não prova ausência absoluta de segredos. Credenciais armazenadas
fora do Git, configurações do host, conteúdo de issues e pull requests e bancos
externos não fazem parte desta auditoria. Cada operador deve usar credenciais
próprias, manter backups e validar seu ambiente antes de produção.
