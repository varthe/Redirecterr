import { config } from "../config"
import logger from "../utils/logger"

// Create headers for Overseerr API requests
const headers = {
    "X-Api-Key": config.overseerr_api_token,
    accept: "application/json",
    "Content-Type": "application/json",
}

/**
 * Fetch data from Overseerr API
 */
export const fetchFromOverseerr = async (endpoint: string): Promise<any> => {
    const url = new URL(endpoint, config.overseerr_url)
    const response = await fetch(url, { headers: headers })

    if (!response.ok || response.status !== 200) {
        throw new Error(`could not retrieve data from Overseerr: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
}

const formatErrorResponse = async (response: Response): Promise<string> => {
    try {
        const errorData = await response.json()
        const message = errorData?.message || (typeof errorData === "string" ? errorData : "")
        return `${response.status} ${response.statusText}${message ? `: ${message}` : ""}`
    } catch {
        return `${response.status} ${response.statusText}`
    }
}

/**
 * Approve a request in Overseerr
 */
export const approveRequest = async (requestId: string): Promise<boolean> => {
    try {
        const url = new URL(`/api/v1/request/${requestId}/approve`, config.overseerr_url)
        const response = await fetch(url, { method: "POST", headers: headers })

        if (!response.ok) {
            throw new Error(await formatErrorResponse(response))
        }

        logger.info(`Request ID ${requestId} approved successfully`)
        return true
    } catch (error) {
        logger.error(`Error approving request: ${error}`)
        return false
    }
}

/**
 * Apply configuration to a request in Overseerr
 */
export const applyConfig = async (requestId: string, postData: Record<string, any>): Promise<boolean> => {
    try {
        const url = new URL(`/api/v1/request/${requestId}`, config.overseerr_url)
        const response = await fetch(url, {
            method: "PUT",
            headers: headers,
            body: JSON.stringify(postData),
        })

        if (!response.ok) {
            throw new Error(await formatErrorResponse(response))
        }

        logger.info(`Configuration applied to request ID ${requestId}`)
        return true
    } catch (error) {
        logger.error(`Error applying configuration: ${error}`)
        return false
    }
}

/**
 * Create a new request in Overseerr
 */
export const createMediaRequest = async (postData: Record<string, any>): Promise<boolean> => {
    try {
        const url = new URL("/api/v1/request", config.overseerr_url)
        const response = await fetch(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(postData),
        })

        if (!response.ok) {
            throw new Error(await formatErrorResponse(response))
        }

        return true
    } catch (error) {
        logger.error(`Error creating request: ${error}`)
        return false
    }
}
