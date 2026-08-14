# Checklist para publicação pública

## Antes de tornar o repositório público

- [x] Adicionar a licença AGPL-3.0 escolhida pelo proprietário (`LICENSE`).
- [x] Definir nome do mantenedor, canal de suporte e política de versões.
- [x] Confirmar que `.env`, dumps, exports, capturas e arquivos de backup não
  estão versionados.
- [x] Executar busca por domínios, IDs de projeto, IDs de Pixel, tokens, JWTs,
  chaves privadas e nomes de clientes.
- [ ] Revogar e rotacionar qualquer segredo que já tenha sido incluído no
  histórico Git, mesmo que o arquivo tenha sido apagado depois.
- [x] Habilitar secret scanning e proteção de push no provedor Git.
- [x] Revisar migrations destrutivas e documentar ordem/compatibilidade.
- [x] Rodar `npm test`, `npm run lint` e `npm run build`.
- [x] Testar uma instalação limpa em um novo projeto Supabase.
- [x] Confirmar que nenhuma funcionalidade depende da infraestrutura do
  mantenedor original.

## Itens recomendados para colaboração

- [x] `LICENSE`;
- [x] `CONTRIBUTING.md`;
- [x] `SECURITY.md` com canal privado para vulnerabilidades;
- [x] `CODE_OF_CONDUCT.md`;
- [x] templates de issue e pull request;
- [x] CI para testes, lint e build;
- [x] changelog e política de releases;
- [ ] imagens da interface sem dados reais;
- [x] dados demonstrativos ou script de seed sem PII.

## Responsabilidades de cada operador

Cada instalação pública é responsável por:

- custos e disponibilidade do Supabase e do servidor;
- domínio, HTTPS, backups e monitoramento;
- termos da Meta, Kommo e demais provedores;
- base legal, consentimento, retenção e exclusão de dados pessoais;
- proteção e rotação de segredos;
- atualização da Graph API e dependências;
- qualidade e legitimidade dos eventos de conversão enviados.

O Venda+ não deve fornecer um token, banco ou servidor CAPI compartilhado entre
instalações independentes. O isolamento esperado é um ambiente por operador,
com integrações adicionais isoladas por empresa dentro desse ambiente.

## Auditoria rápida de neutralidade

Antes de cada release pública, procure referências específicas:

```bash
rg -n 'SEU_DOMINIO|PROJECT_REF|PIXEL_ID|CLIENTE_REAL' \
  --glob '!package-lock.json' .
git ls-files | rg '(^|/)(\.env|.*secret|.*credential)'
```

Revise manualmente os resultados: nomes como `credentials-form.tsx` são
legítimos; valores reais de credenciais não são.

Consulte também o [relatório da auditoria inicial](open-source-audit.md). Ele
registra o que foi verificado, as limitações da análise e as etapas que ainda
dependem das configurações do GitHub ou de uma instalação limpa.
