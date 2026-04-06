# create-winkel-ms

## Como usar depois de publicar no npm

```bash
npx create-winkel-ms meu-novo-servico
# ou sem nome (pergunta no prompt):
npx create-winkel-ms
```

## Fluxo interativo

```
◆  create-winkel-ms  —  scaffold a new winkel microservice
│
◆  Project name: › meu-servico
│
◆  Select the infrastructure services this project will use:
│  ◼  PostgreSQL    @winkel-arsenal/postgres  —  relational database
│  ◼  MongoDB       @winkel-arsenal/database  —  log / audit storage
│  ◻  Redis         @winkel-arsenal/redis  —  cache
│  ◼  RabbitMQ      @winkel-arsenal/messagebroker  —  message broker
│
◆  Template cloned.
◆  docker-compose.yaml generated.
◆  package.json updated.
│
◇  Project "meu-servico" created! Next steps:
     cd meu-servico
     pnpm install
     docker compose up -d
     pnpm dev
```

## O que a ferramenta faz

- Clona o template do GitHub (`winkelsistemas/winkel-ms-starter-kit`)
- Gera `docker-compose.yaml` com **apenas** os serviços selecionados, com os nomes dos containers baseados no nome do projeto
- Remove do `package.json` as dependências não utilizadas (`@winkel-arsenal/postgres`, `mongodb`, `@winkel-arsenal/redis`, etc.)

## Para publicar no npm

```bash
cd create-winkel-ms
npm publish --access public
```
