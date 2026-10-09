import logger from "../utils/logger"
import { config } from "../config"
import { approveRequest, fetchFromOverseerr } from "../api/overseerr"
import { getPostData } from "../utils/helpers"
import { findInstances } from "./filter"
import { sendToInstances } from "./instance"
import { buildDebugLogMessage } from "../utils/helpers"
import type { Webhook } from "../types"

/**
 * Create a standardized response
 */
export const createResponse = (status: string, message: string, statusCode: number): Response => {
    if (status === "error") logger.error(message)
    else logger.info(message)

    return new Response(JSON.stringify({ status: status, message: message }), {
        headers: { "Content-Type": "application/json" },
        status: statusCode,
    })
}

/**
 * Handle webhook requests
 */
export const handleWebhook = async (webhook: Webhook): Promise<Response> => {
    if (logger.isDebugEnabled()) {
        logger.debug(`Received webhook event:\n${JSON.stringify(webhook, null, 2)}`)
    }

    // Handle test notifications
    if (webhook.notification_type === "TEST_NOTIFICATION") {
        return createResponse("success", "Test notification received", 200)
    }

    const { media, request } = webhook

    // Auto-approve music requests
    if (media.media_type === "music") {
        await approveRequest(request.request_id)
        return createResponse("success", "Music request approved", 200)
    }

    try {
        // Fetch media data from Overseerr
        const data = await fetchFromOverseerr(`/api/v1/${media.media_type}/${media.tmdbId}`)
        logger.info(
            `Received request ID ${request.request_id} for ${media.media_type} "${data?.originalTitle || data?.originalName}"`
        )
        
        // Log detailed request information in debug mode
        if (logger.isDebugEnabled()) {
            const cleanMetadata = Object.fromEntries(
                Object.entries(data).filter(
                    ([key]) => !["credits", "relatedVideos", "networks", "watchProviders"].includes(key)
                )
            )
            logger.debug(
                buildDebugLogMessage("Request details:", {
                    webhook: JSON.stringify(webhook, null, 2),
                    metadata: JSON.stringify(cleanMetadata, null, 2),
                })
            )
        }

        // Find matching instances based on filters
        const instances = findInstances(webhook, data, config.filters)
        const postData = getPostData(webhook)
        
        // Process request based on filter matches
        if (instances) {
            await sendToInstances(instances, webhook, postData)
            return createResponse("success", `Request processed and sent to instances`, 200)
        } else if (config.approve_on_no_match) {
            logger.info(`Approving unmatched request ID ${request.request_id}`)
            await approveRequest(request.request_id)
            return createResponse("success", "Request approved (no matching filter)", 200)
        }
        
        return createResponse("success", "Request processed (no action taken)", 200)
    } catch (error) {
        return createResponse("error", `Error processing webhook: ${error}`, 500)
    }
}
