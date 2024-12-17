const fs = require("fs")
const yaml = require("js-yaml")
const Ajv = require("ajv")
const ajv = new Ajv()
const logger = require("./logger")

const yamlFilePath = process.argv[3] || "./config.yaml"

const schema = {
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
                        series_type: {
                            type: "string",
                            enum: ["standard", "anime", "daily"],
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
                    conditions: {
                        type: "object",
                        additionalProperties: {
                            anyOf: [
                                { type: "string" },
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

const formatErrors = (errors) => {
    return errors.map((error) => `"${error.instancePath}": ${error.message || "Validation error"}`).join("\n")
}

const loadConfig = () => {
    try {
        const fileContents = fs.readFileSync(yamlFilePath, "utf8")
        const config = yaml.load(fileContents)
        const validate = ajv.compile(schema)
        const valid = validate(config)
        if (!valid) throw new Error(`\n${formatErrors(validate.errors)}`)
        logger.info(`Validated config`)
        return config
    } catch (error) {
        logger.error(`Error validating config: ${error.message}`)
        process.exit(1)
    }
}

module.exports = { loadConfig }
