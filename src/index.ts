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

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n", "utf-8");
}

function selectedSummary(services: Services): string {
    const lines = ["Infrastructure included:"];
    lines.push(`  PostgreSQL   ${services.postgres ? "✔" : "✘"}`);
    lines.push(`  MongoDB      ${services.mongo ? "✔" : "✘"}`);
    lines.push(`  Redis        ${services.redis ? "✔" : "✘"}`);
    lines.push(`  RabbitMQ     ${services.rabbitmq ? "✔" : "✘"}`);
    return lines.join("\n");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
