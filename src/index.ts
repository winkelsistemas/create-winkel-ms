#!/usr/bin/env node

import {
    cancel,
    intro,
    isCancel,
    multiselect,
    outro,
    spinner,
    text,
} from "@clack/prompts";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEMPLATE_REPO = "winkelsistemas/winkel-ms-starter-kit";

interface Services {
    postgres: boolean;
    mongo: boolean;
    redis: boolean;
    rabbitmq: boolean;
    grpc: boolean;
    httpclient: boolean;
}

async function main(): Promise<void> {
    const argProjectName = process.argv[2];

    intro("create-winkel-ms  —  scaffold a new winkel microservice");

    let projectName: string;

    if (argProjectName) {
        projectName = argProjectName;
    } else {
        const result = await text({
            message: "Project name:",
            placeholder: "my-service",
            validate: (v) => (v.trim().length === 0 ? "Name is required." : undefined),
        });

        if (isCancel(result)) {
            cancel("Cancelled.");
            process.exit(0);
        }

        projectName = result as string;
    }

    const selected = await multiselect({
        message: "Select the infrastructure services this project will use:",
        options: [
            {
                value: "postgres",
                label: "PostgreSQL",
                hint: "@winkel-arsenal/postgres  —  relational database",
            },
            {
                value: "mongo",
                label: "MongoDB",
                hint: "@winkel-arsenal/database  —  log / audit storage",
            },
            {
                value: "redis",
                label: "Redis",
                hint: "@winkel-arsenal/redis  —  cache",
            },
            {
                value: "rabbitmq",
                label: "RabbitMQ",
                hint: "@winkel-arsenal/messagebroker  —  message broker",
            },
            {
                value: "grpc",
                label: "gRPC",
                hint: "@winkel-arsenal/grpc  —  gRPC server & client",
            },
            {
                value: "httpclient",
                label: "HTTP Client",
                hint: "@winkel-arsenal/httpclient  —  HTTP client for external APIs",
            },
        ],
        required: false,
    });

    if (isCancel(selected)) {
        cancel("Cancelled.");
        process.exit(0);
    }

    const services: Services = {
        postgres: (selected as string[]).includes("postgres"),
        mongo: (selected as string[]).includes("mongo"),
        redis: (selected as string[]).includes("redis"),
        rabbitmq: (selected as string[]).includes("rabbitmq"),
        grpc: (selected as string[]).includes("grpc"),
        httpclient: (selected as string[]).includes("httpclient"),
    };

    const targetDir = path.resolve(process.cwd(), projectName);

    if (fs.existsSync(targetDir)) {
        cancel(`Directory "${projectName}" already exists.`);
        process.exit(1);
    }

    const s = spinner();

    s.start("Cloning template from GitHub...");
    try {
        execSync(
            `git clone --depth 1 https://github.com/${TEMPLATE_REPO}.git "${projectName}"`,
            { stdio: "pipe" }
        );
        fs.rmSync(path.join(targetDir, ".git"), { recursive: true, force: true });
        s.stop("Template cloned.");
    } catch (err) {
        s.stop("Failed to clone template.");
        cancel(`git clone error: ${(err as Error).message}`);
        process.exit(1);
    }

    s.start("Generating docker-compose.yaml...");
    const compose = buildCompose(projectName, services);
    fs.writeFileSync(path.join(targetDir, "docker-compose.yaml"), compose, "utf-8");
    s.stop("docker-compose.yaml generated.");

    s.start("Updating package.json...");
    updatePackageJson(targetDir, projectName, services);
    s.stop("package.json updated.");

    if (!services.grpc) {
        s.start("Removing gRPC from project...");
        updateMainTs(targetDir);
        updateApplicationComposer(targetDir, services.httpclient);
        removeGrpcFiles(targetDir);
        s.stop("gRPC removed.");
    }

    if (!services.httpclient) {
        s.start("Removing HTTP client from project...");
        removeHttpClientFiles(targetDir);
        updatePackageJsonRemoveHttpClient(targetDir);
        s.stop("HTTP client removed.");
    }

    const noneSelected = !Object.values(services).some(Boolean);

    outro(
        [
            `Project "${projectName}" created successfully!`,
            "",
            "Next steps:",
            `  cd ${projectName}`,
            "  pnpm install",
            noneSelected ? "" : "  docker compose up -d",
            "  pnpm dev",
            "",
            selectedSummary(services),
        ]
            .filter((l) => l !== undefined)
            .join("\n")
    );
}

function buildCompose(projectName: string, services: Services): string {
    const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const sections: string[] = ["services:"];
    const volumes: string[] = [];
    const hasAnyService = Object.values(services).some(Boolean);

    if (services.mongo) {
        sections.push(
            [
                "",
                "  # =========================",
                "  # MongoDB (logs)",
                "  # =========================",
                `  ${slug}-mongo:`,
                "    image: mongo",
                `    container_name: ${slug}-mongo`,
                "    networks:",
                `      - ${slug}-network`,
                "    restart: always",
                "    ports:",
                '      - "27017:27017"',
            ].join("\n")
        );
    }

    if (services.postgres) {
        sections.push(
            [
                "",
                "  # =========================",
                "  # PostgreSQL",
                "  # =========================",
                `  ${slug}-pgdb:`,
                "    image: postgres:16-alpine",
                `    container_name: ${slug}-pgdb`,
                "    networks:",
                `      - ${slug}-network`,
                "    ports:",
                '      - "5432:5432"',
                "    environment:",
                `      POSTGRES_USER: ${slug}`,
                `      POSTGRES_PASSWORD: ${slug}`,
                `      POSTGRES_DB: ${slug}`,
                "    volumes:",
                "      - postgres_data:/var/lib/postgresql/data",
                "      - ./scripts/create-tables.sql:/docker-entrypoint-initdb.d/01-create-tables.sql",
                "    healthcheck:",
                `      test: ["CMD-SHELL", "pg_isready -U ${slug}"]`,
                "      interval: 5s",
                "      timeout: 5s",
                "      retries: 10",
                "    restart: always",
            ].join("\n")
        );
        volumes.push("  postgres_data:");
    }

    if (services.redis) {
        sections.push(
            [
                "",
                "  # =========================",
                "  # Redis (cache)",
                "  # =========================",
                `  ${slug}-redis:`,
                "    image: redis:latest",
                `    container_name: ${slug}-redis`,
                "    networks:",
                `      - ${slug}-network`,
                "    ports:",
                '      - "6379:6379"',
                "    restart: always",
            ].join("\n")
        );
    }

    if (services.rabbitmq) {
        sections.push(
            [
                "",
                "  # =========================",
                "  # RabbitMQ",
                "  # =========================",
                `  ${slug}-rabbitmq:`,
                "    image: rabbitmq:4.0-management",
                `    container_name: ${slug}-rabbitmq`,
                "    networks:",
                `      - ${slug}-network`,
                "    ports:",
                '      - "5672:5672"',
                '      - "15672:15672"',
                "    restart: always",
            ].join("\n")
        );
    }

    if (hasAnyService) {
        sections.push(
            [
                "",
                "# =========================",
                "# Network",
                "# =========================",
                "networks:",
                `  ${slug}-network:`,
                "    driver: bridge",
            ].join("\n")
        );
    }

    if (volumes.length > 0) {
        sections.push(["", "# =========================", "# Volumes", "# =========================", "volumes:", ...volumes].join("\n"));
    }

    return sections.join("\n") + "\n";
}

function updatePackageJson(targetDir: string, projectName: string, services: Services): void {
    const pkgPath = path.join(targetDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    pkg.name = projectName;

    const deps = pkg.dependencies ?? {};

    if (!services.postgres) {
        delete deps["@winkel-arsenal/postgres"];
        delete deps["pg"];
        delete deps["pg-types"];
        delete pkg.devDependencies?.["@types/pg"];
    }

    if (!services.mongo) {
        delete deps["mongodb"];
        delete pkg.devDependencies?.["@types/mongodb"];
    }

    if (!services.redis) {
        delete deps["@winkel-arsenal/redis"];
        delete deps["redis"];
    }

    if (!services.rabbitmq) {
        delete deps["@winkel-arsenal/messagebroker"];
        delete deps["amqplib"];
        delete pkg.devDependencies?.["@types/amqplib"];
    }

    if (!services.grpc) {
        delete deps["@winkel-arsenal/grpc"];
        delete deps["@grpc/grpc-js"];
        delete deps["@grpc/proto-loader"];
    }

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n", "utf-8");
}

function updateMainTs(targetDir: string): void {
    const mainTsPath = path.join(targetDir, "src", "main.ts");
    const content = `import HttpServerAdapterProvider from "@infra/http/HttpServerAdapterProvider";
import { ApplicationComposer } from "@infra/setup/ApplicationComposer";
import { Logger } from "@winkel-arsenal/core";
import { HttpServer } from "@winkel-arsenal/http";
import { environment } from "environment/env";

environment.load();

const server: HttpServer = new HttpServerAdapterProvider().execute();
const applicationComposer: ApplicationComposer = new ApplicationComposer(server);

applicationComposer.initialize().catch((err) => {
    Logger.error("Error initializing the app:", err);
    process.exit(1);
});

process.on("SIGTERM", async () => {
    Logger.info("SIGTERM received, stopping server...");
    await server.stop();
    process.exit(0);
});

const port = Number(process.env.SERVER_PORT);
server.listen(port);
`;
    fs.writeFileSync(mainTsPath, content, "utf-8");
}

function updateApplicationComposer(targetDir: string, includeHttpClient: boolean): void {
    const composerPath = path.join(targetDir, "src", "infra", "setup", "ApplicationComposer.ts");

    const httpClientImports = includeHttpClient
        ? `import AddressController from "@infra/controller/AddressController";
import PostalCodeAddressGateway from "@infra/gateway/PostalCodeAddressGateway";
`
        : "";

    const httpClientRegisterCall = includeHttpClient
        ? `
        this.registerAddressController();`
        : "";

    const httpClientRegisterMethod = includeHttpClient
        ? `
    private registerAddressController(): void {
        new AddressController(this.server, new PostalCodeAddressGateway());
    }
`
        : "";

    const content = `import CustomerResource from "@application/api/resource/CustomerResource";
import UserAuthTemplateResource from "@application/api/resource/UserAuthTemplateResource";
import CustomerUseCaseFactory from "@application/factory/CustomerUseCaseFactory";
import UserAuthTemplateUseCaseFactory from "@application/factory/UserAuthTemplateUseCaseFactory";
import LogPublisherService from "@application/service/LogPublisherService";
import { ExchangeType, MessagePublisher, RabbitMQMessageBrokerFactory } from "@winkel-arsenal/messagebroker";
import AuthenticationFactory from "@infra/factory/AuthenticationFactory";
import CryptoFactory from "@infra/factory/CryptoFactory";
import SessionFactory from "@infra/factory/SessionFactory";
import LogConsumer from "@infra/messagebroker/LogConsumer";
import { ValidateToken } from "@winkel-arsenal/auth";
import { RequestContextClsHookAdapter } from "@winkel-arsenal/cls";
import { DBClient, DBTransactionManager } from "@winkel-arsenal/database";
import { PostgresDBConnection, PostgresDBConnectionFactory } from "@winkel-arsenal/postgres";
import { RedisDBConnection, RedisDBConnectionFactory } from "@winkel-arsenal/redis";
import CustomerController from "@infra/controller/CustomerController";
import UserAuthTemplateController from "@infra/controller/UserAuthTemplateController";
import { SQL_MODEL_NAME } from "@infra/database/SqlModelName";
import DataBaseCustomerRepository from "@infra/repository/database/DataBaseCustomerRepository";
import DataBaseUserRepository from "@infra/repository/database/DataBaseUserRepository";
import MongoLogRepository from "@infra/repository/mongodb/MongoLogRepository";
import RedisCustomerCacheRepository from "@infra/repository/redis/RedisCustomerCacheRepository";
import RedisTokenCacheRepository from "@infra/repository/redis/RedisTokenCacheRepository";
${httpClientImports}import { ActuatorController } from "@winkel-arsenal/actuator";
import { ServerContext, Session } from "@winkel-arsenal/context-server";
import { HttpServer } from "@winkel-arsenal/http";
import { MongoClient } from "mongodb";

class ApplicationComposer {
    private readonly jose = CryptoFactory.createJose();
    private readonly jwt = CryptoFactory.createJwt();
    private readonly password = CryptoFactory.createPassword();
    private readonly messagePublisher: MessagePublisher;
    private logConsumer: LogConsumer | null = null;

    constructor(private readonly server: HttpServer) {
        const brokerFactory = new RabbitMQMessageBrokerFactory(process.env.RABBITMQ_URL ?? "", [
            { name: "template.log.exchange", type: ExchangeType.TOPIC },
        ]);
        const broker = brokerFactory.create();
        this.messagePublisher = new MessagePublisher(broker);
    }

    public async initialize(): Promise<void> {
        this.initContext();
        this.registerActuatorController();

        const postgresDBConnection = await this.createPostgresDBConnection();
        const dbClient = this.createDBClient(postgresDBConnection);
        const mongoClient = await this.createMongoClient();
        const redisConnection = this.createRedisConnection();

        this.attachSession(postgresDBConnection);
        this.attachAuthentication();

        const logRepository = new MongoLogRepository(mongoClient);
        const logPublisher = new LogPublisherService(this.messagePublisher);

        this.logConsumer = new LogConsumer(
            new RabbitMQMessageBrokerFactory(process.env.RABBITMQ_URL ?? "", [
                { name: "template.log.exchange", type: ExchangeType.TOPIC },
            ]).create(),
            logRepository
        );

        this.registerCustomerController(dbClient, redisConnection, logPublisher);
        this.registerUserAuthTemplateController(dbClient, redisConnection);${httpClientRegisterCall}

        await this.logConsumer.start();
    }

    private initContext(): void {
        ServerContext.createContext(new RequestContextClsHookAdapter("winkel-ms-template"));
        this.server.use(ServerContext.initContext(this.server));
    }

    private async createPostgresDBConnection(): Promise<PostgresDBConnection> {
        const postgresDBConnection = await PostgresDBConnectionFactory.create();
        const dbTransactionManager = new DBTransactionManager();
        postgresDBConnection.attach(dbTransactionManager);
        return postgresDBConnection;
    }

    private createDBClient(postgresDBConnection: PostgresDBConnection): DBClient {
        return new DBClient(postgresDBConnection);
    }

    private async createMongoClient(): Promise<MongoClient> {
        const mongoUrl = process.env.MONGODB_URL ?? "mongodb://localhost:27017";
        const client = new MongoClient(mongoUrl);
        await client.connect();
        return client;
    }

    private createRedisConnection(): RedisDBConnection {
        return RedisDBConnectionFactory.create();
    }

    private attachSession(postgresDBConnection: PostgresDBConnection): void {
        const session: Session = new SessionFactory().create();
        this.server.use(session.start(postgresDBConnection));
    }

    private attachAuthentication(): void {
        const authValidator = new AuthenticationFactory().create();
        this.server.use(authValidator.authenticate(new ValidateToken(this.jwt)));
    }

    private registerActuatorController(): void {
        new ActuatorController(this.server);
    }

    private registerCustomerController(
        dbClient: DBClient,
        redisConnection: RedisDBConnection,
        logPublisher: LogPublisherService
    ): void {
        const customerRepository = new DataBaseCustomerRepository(dbClient);
        const customerCache = new RedisCustomerCacheRepository(redisConnection);
        const useCaseFactory = new CustomerUseCaseFactory(
            customerRepository,
            customerCache,
            logPublisher
        );
        new CustomerController(this.server, new CustomerResource(useCaseFactory));
    }

    private registerUserAuthTemplateController(
        dbClient: DBClient,
        redisConnection: RedisDBConnection
    ): void {
        const userRepository = new DataBaseUserRepository(dbClient, SQL_MODEL_NAME.USER);
        const tokenCache = new RedisTokenCacheRepository(redisConnection);
        const useCaseFactory = new UserAuthTemplateUseCaseFactory(
            userRepository,
            this.jwt,
            this.password,
            this.jose,
            tokenCache
        );
        new UserAuthTemplateController(this.server, new UserAuthTemplateResource(useCaseFactory));
    }
${httpClientRegisterMethod}}

export { ApplicationComposer };
`;
    fs.writeFileSync(composerPath, content, "utf-8");
}

function removeGrpcFiles(targetDir: string): void {
    const filesToRemove = [
        path.join(targetDir, "src", "infra", "controller", "ActuatorGrpcController.ts"),
        path.join(targetDir, "src", "infra", "controller", "CustomerGrpcController.ts"),
        path.join(targetDir, "src", "infra", "controller", "UserAuthTemplateGrpcController.ts"),
        path.join(targetDir, "src", "infra", "controller", "ExternalServiceController.ts"),
        path.join(targetDir, "src", "infra", "gateway", "GrpcTestServiceGateway.ts"),
        path.join(targetDir, "src", "domain", "gateway", "ExternalServiceGateway.ts"),
        path.join(targetDir, "src", "proto", "test.proto"),
    ];

    for (const filePath of filesToRemove) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath);
        }
    }
}

function removeHttpClientFiles(targetDir: string): void {
    const filesToRemove = [
        path.join(targetDir, "src", "infra", "controller", "AddressController.ts"),
        path.join(targetDir, "src", "infra", "gateway", "PostalCodeAddressGateway.ts"),
        path.join(targetDir, "src", "domain", "gateway", "AddressGateway.ts"),
    ];

    for (const filePath of filesToRemove) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath);
        }
    }
}

function updatePackageJsonRemoveHttpClient(targetDir: string): void {
    const pkgPath = path.join(targetDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = pkg.dependencies ?? {};
    delete deps["@winkel-arsenal/httpclient"];
    delete deps["undici"];
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n", "utf-8");
}

function selectedSummary(services: Services): string {
    const lines = ["Infrastructure included:"];
    lines.push(`  PostgreSQL   ${services.postgres ? "✔" : "✘"}`);
    lines.push(`  MongoDB      ${services.mongo ? "✔" : "✘"}`);
    lines.push(`  Redis        ${services.redis ? "✔" : "✘"}`);
    lines.push(`  RabbitMQ     ${services.rabbitmq ? "✔" : "✘"}`);
    lines.push(`  gRPC         ${services.grpc ? "✔" : "✘"}`);
    lines.push(`  HTTP Client  ${services.httpclient ? "✔" : "✘"}`);
    return lines.join("\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
