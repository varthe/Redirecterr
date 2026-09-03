import fs from "fs"
import yaml from "js-yaml"
import Ajv, { type ErrorObject, type Schema } from "ajv"
import logger from "../utils/logger"
import type { Config } from "../types"

const ajv = new Ajv({ allErrors: true })

const yamlFilePath = process.argv[3] || "./config.yaml"

const schema: Schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
        seerr_url: {
            type: "string",
            minLength: 1,
        },
        seerr_api_token: {
            type: "string",
            minLength: 1,
        },
        overseerr_url: {
            type: "string",
            minLength: 1,
        },
        overseerr_api_token: {
            type: "string",
            minLength: 1,
        },
        seerr_email: {
            type: "string",
            minLength: 1,
        },
        seerr_password: {
            type: "string",
            minLength: 1,
        },
        approve_on_no_match: {
            type: "boolean",
        },
        instances: {
            type: "object",
            patternProperties: {
                ".*": {
                    type: "object",
                    properties: {
                        server_id: {
                            type: "number",
                        },
                        root_folder: {
                            type: "string",
                            minLength: 1,
                        },
                        quality_profile_id: {
                            type: "number",
                        },
                        approve: {
                            type: "boolean",
                        },
                    },
                    required: ["server_id", "root_folder"],
                },
            },
            additionalProperties: false,
        },
        filters: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    media_type: {
                        type: "string",
                        enum: ["movie", "tv"],
                    },
                    is_4k: {
                        type: "boolean",
                    },
                    conditions: {
                        type: "object",
                        additionalProperties: {
                            anyOf: [
                                { type: "string" },
                                { type: "number" },
                                {
                                    type: "array",
                                    items: { type: "string" },
                                    minItems: 1,
                                },
                                {
                                    type: "object",
                                    properties: {
                                        exclude: {
                                            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                                        },
                                    },
                                    required: ["exclude"],
                                    additionalProperties: false,
                                },
                                {
                                    type: "object",
                                    properties: {
                                        require: {
                                            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                                        },
                                    },
                                    required: ["require"],
                                    additionalProperties: false,
                                },
                                {
                                    type: "object",
                                    properties: {
                                        include: {
                                            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                                        },
                                    },
                                    required: ["include"],
                                    additionalProperties: false,
                                },
                            ],
                        },
                    },
                    apply: {
                        anyOf: [
                            { type: "string" },
                            {
                                type: "array",
                                items: { type: "string" },
                                minItems: 1,
                            },
                        ],
                    },
                },
                required: ["media_type", "apply"],
            },
        },
    },
    required: ["instances", "filters"],
    anyOf: [
        {
            required: ["seerr_url", "seerr_api_token"],
        },
        {
            required: ["overseerr_url", "overseerr_api_token"],
        },
    ],
}

/**
 * Format validation errors into a readable string
 */
const formatErrors = (errors: ErrorObject[] | null | undefined): string => {
    if (!errors) return "Unknown validation error"

    return errors
        .map((error) => {
            const path = error.instancePath || "config"
            return `Error at "${path}": ${error.message || "Validation issue"}`
        })
        .join("\n")
}

const validate = ajv.compile<Config>(schema)

/**
 * Load and validate the configuration file
 */
const loadConfig = async (): Promise<Config> => {
    try {
        if (!fs.existsSync(yamlFilePath)) {
            logger.error(`Configuration file not found at: ${yamlFilePath}`)
            process.exit(1)
        }

        const fileContents = fs.readFileSync(yamlFilePath, "utf8")
        const config = yaml.load(fileContents)

        if (!validate(config)) {
            throw new Error(`\n${formatErrors(validate.errors)}`)
        }

        // Backwards compatibility: accept legacy overseerr_* names. seerr_*
        // takes precedence when both are present. Normalize to the canonical
        // seerr_* fields so the rest of the app only reads seerr_*.
        const raw = config as unknown as Record<string, unknown>
        if (!raw.seerr_url && raw.overseerr_url) {
            raw.seerr_url = raw.overseerr_url
        }
        if (!raw.seerr_api_token && raw.overseerr_api_token) {
            raw.seerr_api_token = raw.overseerr_api_token
        }
        delete raw.overseerr_url
        delete raw.overseerr_api_token

        if (logger.isDebugEnabled()) {
            logger.debug("Debug mode enabled")

            const replacer = (key: string, value: any) => {
                if (key === "seerr_api_token" || key === "seerr_password") return "REDACTED"
                return value
            }

            logger.debug(`Loaded config:\n${JSON.stringify(config, replacer, 2)}`)
        }

        return config
    } catch (error: any) {
        let errorMessage = "An unknown error occurred"
        if (error instanceof Error) errorMessage = error.message
        else if (typeof error === "string") errorMessage = error

        logger.error(`Error loading config: ${errorMessage}`)
        process.exit(1)
    }
}

export const config = await loadConfig()
