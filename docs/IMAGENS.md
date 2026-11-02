# Imagens: origem e licenças

## Política adotada

- **Nenhuma fotografia de pessoas** foi usada nesta versão. Não há depoimentos, clientes, logotipos de terceiros ou resultados comerciais simulados.
- As imagens dos produtos são **ilustrações de interface (mockups) criadas para o projeto**, com dados explicitamente fictícios, geradas pelo script [`scripts/generate-images.js`](../scripts/generate-images.js). Elas devem ser substituídas por **capturas reais das telas** quando os sistemas estiverem prontos.
- Fotografias de pessoas não devem substituir capturas de tela de software.
- Se usar fotografias de bancos de imagens, priorize Pexels, Unsplash ou Pixabay; verifique a licença e as restrições sobre pessoas, marcas e propriedades; baixe o arquivo (não use URLs temporárias); **não apresente a pessoa retratada como cliente** e registre a origem abaixo e no campo "Origem e licença" da biblioteca de mídia. Não faça raspagem automatizada desses sites.
- Não use imagens de buscadores, Pinterest ou redes sociais sem licença clara, nem fotos de pessoas geradas por IA para simular clientes, funcionários ou depoimentos.

## Registro das imagens do projeto

| Arquivo | Descrição | Origem | Autor | Licença | Verificado em |
| --- | --- | --- | --- | --- | --- |
| `frontend/public/assets/images/hero-dashboard.svg` | Ilustração de painel genérico (dados ilustrativos) | Criada para o projeto (`scripts/generate-images.js`) | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/images/og-default.svg` / `.png` | Imagem padrão para compartilhamento (Open Graph), sem logotipo — identidade provisória | Criada para o projeto | Projeto | Própria | 2026-11-02 |
| `frontend/public/assets/images/produtos/churchflow-*.svg` | Mockups de telas do ChurchFlow (dados fictícios) | Criada para o projeto | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/images/produtos/spacecontrol-*.svg` | Mockups de telas do SpaceControl (dados fictícios) | Criada para o projeto | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/images/produtos/fleetmanager-*.svg` | Mockups de telas do FleetManager (dados fictícios) | Criada para o projeto | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/images/produtos/sistemas-personalizados-capa.svg` | Ilustração de etapas de projeto | Criada para o projeto | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/images/produtos/placeholder.svg` | Imagem padrão quando não há capa | Criada para o projeto | Projeto | Própria | 2026-10-26 |
| `frontend/public/assets/icons/favicon.svg` | Quadrado em gradiente da paleta provisória (sem logotipo) | Criada para o projeto | Projeto | Própria | 2026-11-02 |

Ícones de interface: [Bootstrap Icons](https://icons.getbootstrap.com/) (licença MIT), servidos a partir de `node_modules`.

Fonte: [Montserrat](https://github.com/JulietaUla/Montserrat) (SIL Open Font License 1.1), arquivo variável `montserrat-latin-wght-normal.woff2` obtido do pacote `@fontsource-variable/montserrat@5.1.1` e servido em `frontend/public/assets/fonts/montserrat/` junto com a licença (`OFL.txt`).

## Modelo para novas imagens de terceiros

| Arquivo | Descrição | URL original | Repositório | Autor | Licença consultada | Restrições observadas | Verificado em |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `exemplo.jpg` | … | https://www.pexels.com/pt-br/foto/… | Pexels | Nome do fotógrafo | Licença Pexels | Pessoas identificáveis não podem ser apresentadas como endossando o produto | AAAA-MM-DD |

Para regenerar os mockups após alterar o script:

```powershell
npm run images
```
