# Como contribuir

Obrigado por contribuir com o Venda+. Antes de começar, procure uma issue já
existente e descreva a mudança proposta. Correções pequenas e bem delimitadas
podem ser enviadas diretamente.

Ao participar, você concorda em seguir o [Código de Conduta](CODE_OF_CONDUCT.md).

## Ambiente local

1. Faça um fork e crie uma branch a partir de `main`.
2. Execute `npm ci`.
3. Copie `.env.example` para `.env.local` e use apenas credenciais de teste.
4. Aplique as migrations em um projeto Supabase isolado.
5. Execute `npm test`, `npm run lint` e `npm run build`.

Consulte o [guia de instalação](docs/installation.md) para o ambiente completo.

## Regras para mudanças

- preserve `tenant_id` em consultas, jobs, webhooks e integrações;
- nunca inclua tokens, dados pessoais, dumps ou identificadores de clientes;
- migrations devem ser incrementais e preservar instalações existentes;
- mudanças de banco precisam documentar aplicação e rollback;
- novas variáveis devem entrar em `.env.example` sem valores reais;
- atualize os manuais quando alterar uma configuração ou fluxo operacional;
- inclua testes para regras de segurança, transformação e idempotência.

## Pull requests

Explique o problema, a solução, como validar e qualquer impacto em migrations,
segurança ou compatibilidade. Mantenha o PR focado e não misture refatorações
sem relação com a mudança.

Não envie vulnerabilidades em issues públicas. Siga a
[política de segurança](SECURITY.md).

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela seja licenciada sob a mesma
licença AGPL-3.0 do projeto e declara ter o direito de disponibilizá-la nesses
termos.
