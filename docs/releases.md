# Versões e suporte

## Versionamento

O Venda+ segue Semantic Versioning (`MAJOR.MINOR.PATCH`). Enquanto estiver em
`0.x`, mudanças incompatíveis podem ocorrer em versões minor, sempre descritas
no changelog e nas notas da release.

- `PATCH`: correções compatíveis e documentação;
- `MINOR`: funcionalidades, migrations incrementais e possíveis ajustes de API;
- `MAJOR`: estabilidade pública e mudanças incompatíveis excepcionais.

Releases são criadas a partir da `main` depois do CI. Migrations nunca devem ser
alteradas depois de publicadas; correções entram em novos arquivos incrementais.

## Suporte comunitário

- **Discussions:** dúvidas, ideias, instalação e troca de experiências;
- **Issues:** bugs reproduzíveis e funcionalidades aceitas no roadmap;
- **Security Advisories:** vulnerabilidades, sempre em relato privado;
- **Pull requests:** mudanças pequenas, testadas e focadas.

O suporte é comunitário e não possui SLA. Cada operador responde por deploy,
backup, LGPD, custos, segredos e contratos com Supabase, Kommo e Meta.

## Manutenção

Miguel Bastos atua como mantenedor inicial. Novos mantenedores podem ser
convidados conforme histórico de contribuições, responsabilidade com segurança
e participação consistente nas discussões e revisões.
