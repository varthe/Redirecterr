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
        overseerr_url: {
            type: "string",
            minLength: 1,
        },
        overseerr_api_token: {
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
                        is_4k: {
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
    required: ["overseerr_url", "overseerr_api_token", "instances", "filters"],
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

        for (const [index, filter] of config.filters.entries()) {
            const applyList = Array.isArray(filter.apply) ? filter.apply : [filter.apply]

            for (const item of applyList) {
                if (!config.instances[item]) {
                    throw new Error(`Filter at index ${index} references unknown instance "${item}"`)
                }
            }

            if (applyList.length > 1) {
                let standardCount = 0
                let fourKCount = 0

                for (const item of applyList) {
                    if (config.instances[item]?.is_4k) {
                        fourKCount++
                    } else {
                        standardCount++
                    }
                }

                if (standardCount > 1 || fourKCount > 1) {
                    throw new Error(
                        `Filter at index ${index} has invalid 'apply': [${applyList.join(", ")}]. ` +
                        `A single request can at most be routed to one standard and one 4K instance.`
                    )
                }
            }
        }

        if (logger.isDebugEnabled()) {
            logger.debug("Debug mode enabled")

            const replacer = (key: string, value: any) => {
                if (key === "overseerr_api_token") return "REDACTED"
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
