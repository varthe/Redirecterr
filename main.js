const express = require("express")
const axios = require("axios")
const logger = require("./logger")
const { loadConfig } = require("./configBuilder")

// Load configuration
const config = process.env.NODE_ENV !== "test" ? loadConfig() : ""
const app = express()
app.use(express.json())

const axiosInstance = axios.create({
    baseURL: config.overseerr_url,
    headers: {
        accept: "application/json",
        "X-Api-Key": config.overseerr_api_token,
        "Content-Type": "application/json",
    },
})

// Utility functions
const normalizeToArray = (value) => {
    const values = Array.isArray(value) ? value : [value]
    return values.map((x) => String(x).toLowerCase())
}

const isObject = (value) => typeof value === "object" && value !== null

const isObjectArray = (value) => Array.isArray(value) && value.some((item) => isObject(item))

const formatLogEntry = (entry) => {
    if (Array.isArray(entry)) {
        return entry
            .map((item) => (isObject(item) && item.name ? item.name : isObject(item) ? JSON.stringify(item) : item))
            .join(", ")
    }
    if (isObject(entry)) {
        if (entry.name) {
            return entry.name
        }
        return Object.entries(entry)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
            .join(", ")
    }
    return entry
}

const buildLogMessage = (message, details = {}) => {
    const formattedDetails = Object.entries(details)
        .map(([key, value]) => `${key}: ${formatLogEntry(value)}`)
        .join("\n")

    return `${message}\n${formattedDetails}`
}

// Main functions
const matchValue = (filterValue, dataValue) => {
    const arrayValues = normalizeToArray(filterValue)

    if (isObject(dataValue)) {
        for (const [key, value] of Object.entries(dataValue)) {
            if (isObjectArray(value)) {
                if (
                    value.some((item) =>
                        arrayValues.some((filterVal) =>
                            Object.values(item).some((field) => String(field).toLowerCase().includes(filterVal))
                        )
                    )
                ) {
                    return true
                }
            } else {
                if (arrayValues.some((filterVal) => String(value).toLowerCase().includes(filterVal))) {
                    return true
                }
            }
        }
    }

    if (isObjectArray(dataValue)) {
        return dataValue.some((item) =>
            arrayValues.some((value) =>
                Object.values(item).some((field) => String(field).toLowerCase().includes(value))
            )
        )
    }

    return arrayValues.some((value) => String(dataValue).toLowerCase().includes(value))
}

const findMatchingInstances = (webhook, data, filters) => {
    try {
        const matchingFilter = filters.find(({ media_type, conditions }) => {
            if (media_type !== webhook.media?.media_type) return false

            for (const [key, value] of Object.entries(conditions || {})) {
                const requestValue = data[key] || webhook.request?.[key]
                if (!requestValue) {
                    logger.debug(`Filter check skipped - Key "${key}" not found in webhook or data`)
                    return false
                }

                if (logger.isLevelEnabled("debug")) {
                    logger.debug(
                        buildLogMessage("Filter check:", {
                            Field: key,
                            "Filter value": value,
                            "Request value": requestValue,
                        })
                    )
                }

                if (value.exclude ? matchValue(value.exclude, requestValue) : !matchValue(value, requestValue)) {
                    logger.debug(`Filter check for key "${key}" did not match.`)
                    return false
                }
            }
            return true
        })

        if (!matchingFilter) {
            logger.warn("No matching filter found for the current webhook")
            return null
        }

        logger.info(`Found matching filter at index ${filters.indexOf(matchingFilter)}`)
        return matchingFilter.apply
    } catch (error) {
        logger.error(`Error finding matching filter: ${error.message}`)
        return null
    }
}

const getPostData = (requestData) => {
    const { media, extra = [] } = requestData
    const postData = { mediaType: media.media_type }
    if (media.media_type === "tv") {
        const seasons = extra
            .find((item) => item.name === "Requested Seasons")
            ?.value?.split(",")
            .map(Number)
            .filter(Number.isInteger)

        if (seasons?.length > 0) {
            postData["seasons"] = seasons
        }
    }
    return postData
}

const applyConfig = async (requestId, postData) => await axiosInstance.put(`/api/v1/request/${requestId}`, postData)
const approveRequest = async (requestId) => await axiosInstance.post(`/api/v1/request/${requestId}/approve`)

const sendToInstances = async (instances, requestId, media_type, data) => {
    const instancesArray = Array.isArray(instances) ? instances : [instances]
    for (const item of instancesArray) {
        try {
            let postData = { ...data }
            const instance = config.instances[item]
            if (!instance) {
                logger.warn(`Instance "${item}" not found in config`)
                continue
            }
            postData.rootFolder = instance.root_folder
            postData.serverId = instance.server_id
            if (instance.quality_profile_id) postData.profileId = instance.quality_profile_id
            if (instance.series_type && media_type === "tv") postData.seriesType = instance.series_type

            logger.debug({
                message: "Sending configuration to instance",
                instance: item,
                postData: postData,
            })

            await applyConfig(requestId, postData)
            logger.info(`Configuration applied for request ID ${requestId} on instance "${item}"`)

            if (instance.approve ?? true) {
                await approveRequest(requestId)
                logger.info(`Request ID ${requestId} approved for instance "${item}"`)
            }
        } catch (error) {
            logger.warn(`Failed to post request ID ${requestId} to instance "${item}": ${error.message}`)
        }
    }
}

// Webhook route
app.post("/webhook", async (req, res) => {
    try {
        const { notification_type, media, request } = req.body

        if (notification_type === "TEST_NOTIFICATION") {
            logger.info("Test notification received")
            return res.status(200).send()
        }

        if (media.media_type === "music") {
            logger.info("Received music request. Approving")
            await approveRequest(request.request_id)
            return res.status(200).send()
        }

        const { data } = await axiosInstance.get(`/api/v1/${media.media_type}/${media.tmdbId}`)
        logger.info(
            `Received request ID ${request.request_id} for ${media.media_type} "${data?.originalTitle || data?.originalName}"`
        )
        const instances = findMatchingInstances(req.body, data, config.filters)
        const postData = getPostData(req.body)
        if (instances) await sendToInstances(instances, request.request_id, media.media_type, postData)
        return res.status(200).send()
    } catch (error) {
        const message = `Error handling webhook: ${error.message}`
        logger.error(message)
        return res.status(500).send({ error: message })
    }
})

// Server initialization
const PORT = process.env.PORT || 8481
const server = app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`)
})

module.exports = { findMatchingInstances, server }
