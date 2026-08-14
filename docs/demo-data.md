# Dados demonstrativos

O seed demonstrativo serve para avaliar dashboards e desenvolver a interface
sem copiar dados de clientes ou depender de uma conta Kommo.

## Conteúdo

- 42 contatos e 42 leads inteiramente fictícios;
- todas as etapas, de MQL a venda/perda;
- três campanhas, quatro origens e quatro tipos de conteúdo;
- três responsáveis fictícios;
- valores, datas de fechamento, histórico de qualificação e motivos de perda;
- e-mails no domínio reservado `.example` e telefones inválidos;
- marcação `raw.demo=true` para remoção seletiva.

O conjunto usa datas relativas ao momento da execução para manter os gráficos
recentes. Reexecutar é seguro: IDs `demo-*` e históricos determinísticos tornam
o processo idempotente.

## Proteções

Use uma empresa dedicada à demonstração. O seed recusa execução quando essa
empresa possui Kommo conectado ou Meta CAPI habilitada, evitando jobs e eventos
externos. Ele não cria usuários, não altera memberships e não contém tokens.

O comando exige três confirmações explícitas: project ref, repetição do project
ref e a frase `VENDA_PLUS_DEMO`.

## Inserir

```bash
npm run demo:seed -- \
  --project-ref SEU_PROJECT_REF \
  --confirm-project SEU_PROJECT_REF \
  --tenant-slug empresa-demonstracao \
  --confirm-demo VENDA_PLUS_DEMO
```

## Remover

```bash
npm run demo:clear -- \
  --project-ref SEU_PROJECT_REF \
  --confirm-project SEU_PROJECT_REF \
  --tenant-slug empresa-demonstracao \
  --confirm-demo VENDA_PLUS_DEMO
```

A limpeza remove apenas contatos e leads marcados como demonstração na empresa
informada. Históricos relacionados são removidos pelas chaves estrangeiras.
