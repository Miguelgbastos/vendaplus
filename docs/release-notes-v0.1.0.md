# Venda+ v0.1.0 — primeira versão comunitária

A versão 0.1.0 estabelece a base pública e self-hosted do Venda+, uma aplicação
multiempresa para integrar dados do Kommo, acompanhar o funil comercial e medir
atribuição de marketing.

## Principais recursos

- autenticação Supabase com isolamento por empresa e RLS;
- integração Kommo com OAuth, webhooks, fila e sincronização;
- dashboards comercial e de marketing;
- Meta Conversions API por empresa;
- gestão de empresas, usuários, convites e permissões;
- documentação para instalação self-hosted;
- licença AGPL-3.0, CI e estrutura de contribuição comunitária.

## Instalação e demonstração

- comando único para vincular o Supabase, simular e aplicar migrations e validar
  o banco;
- dados demonstrativos com 42 contatos e 42 leads fictícios;
- carga demo idempotente, reversível e bloqueada quando Kommo ou Meta CAPI
  estiverem ativos;
- guia de início rápido, roadmap e política de suporte comunitário;
- execução do Supabase CLI compatível com Windows, macOS e Linux.

## Migrations e compatibilidade

- as migrations são incrementais e não devem ser alteradas depois de publicadas;
- os contratos internos `tenants`, `tenant_users` e `tenant_id` são preservados;
- cada instalação deve executar o comando de preparação e conferir o resultado
  antes de habilitar integrações;
- atualizar o código ou aplicar migrations não comprova, por si só, que uma
  implantação de produção está saudável.

## Validação

- 84 testes automatizados;
- lint e build de produção aprovados;
- GitHub Actions, Cursor Bugbot e Cursor Security Agent aprovados;
- auditoria de dependências sem vulnerabilidades de nível alto.

## Antes de usar em produção

Cada operador deve configurar seu próprio Supabase e validar migrations, RLS,
backup, segredos e integrações. O suporte é comunitário e não possui SLA.

Consulte o [guia de início rápido](quickstart.md), o [guia de instalação](installation.md)
e o [roadmap](../ROADMAP.md).
