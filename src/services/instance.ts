import logger from "../utils/logger"
import { config } from "../config"
import { approveRequest, applyConfig, createMediaRequest } from "../api/overseerr"
import { buildDebugLogMessage } from "../utils/helpers"
import type { PostData, Webhook } from "../types"

/**
 * Send request to configured instances
 */
export const sendToInstances = async (
    instances: string | string[],
    webhook: Webhook,
    data: PostData
): Promise<void> => {
    const instancesArray = Array.isArray(instances) ? instances : [instances]
    const requestId = webhook.request.request_id
    const isIncoming4k = webhook.media.status4k === "PENDING"

    if (instancesArray.length === 1) {
        const item = instancesArray[0]
        const instance = config.instances[item]
        if (!instance) {
            logger.warn(`Instance "${item}" not found in config`)
            return
        }

        try {
            let postData = { ...data } as Record<string, any>
            postData.rootFolder = instance.root_folder
            postData.serverId = instance.server_id
            if (instance.quality_profile_id) postData.profileId = instance.quality_profile_id

            if (logger.isDebugEnabled()) {
                logger.debug(buildDebugLogMessage("Sending configuration to instance:", { instance: item, postData }))
            }

            const applied = await applyConfig(requestId, postData)
            if (applied) {
                logger.info(`Configuration applied for request ID ${requestId} on instance "${item}"`)
            }

            if (instance.approve ?? true) {
                const approved = await approveRequest(requestId)
                if (approved) {
                    logger.info(`Request ID ${requestId} approved for instance "${item}"`)
                }
            }
        } catch (error) {
            logger.warn(`Failed to process request ID ${requestId} for instance "${item}": ${error}`)
        }
        return
    }

    const standardItem = instancesArray.find((item) => !config.instances[item]?.is_4k)
    const fourKItem = instancesArray.find((item) => config.instances[item]?.is_4k)

    const primaryItem = isIncoming4k ? fourKItem : standardItem
    const secondaryItem = isIncoming4k ? standardItem : fourKItem

    if (primaryItem) {
        const instance = config.instances[primaryItem]
        if (instance) {
            try {
                let postData = { ...data } as Record<string, any>
                postData.rootFolder = instance.root_folder
                postData.serverId = instance.server_id
                if (instance.quality_profile_id) postData.profileId = instance.quality_profile_id

                if (logger.isDebugEnabled()) {
                    logger.debug(buildDebugLogMessage("Sending configuration to primary instance:", { instance: primaryItem, postData }))
                }

                const applied = await applyConfig(requestId, postData)
                if (applied) {
                    logger.info(`Configuration applied for request ID ${requestId} on instance "${primaryItem}"`)
                }

                if (instance.approve ?? true) {
                    const approved = await approveRequest(requestId)
                    if (approved) {
                        logger.info(`Request ID ${requestId} approved for instance "${primaryItem}"`)
                    }
                }
            } catch (error) {
                logger.warn(`Failed to process request ID ${requestId} for instance "${primaryItem}": ${error}`)
            }
        }
    }

    if (secondaryItem) {
        const instance = config.instances[secondaryItem]
        if (instance) {
            try {
                const is4k = Boolean(instance.is_4k)
                const newRequestPayload: Record<string, any> = {
                    mediaType: webhook.media.media_type,
                    mediaId: Number(webhook.media.tmdbId),
                    serverId: instance.server_id,
                    rootFolder: instance.root_folder,
                    is4k: is4k,
                }
                if (instance.quality_profile_id) newRequestPayload.profileId = instance.quality_profile_id
                if (webhook.media.media_type === "tv") {
                    newRequestPayload.seasons = data.seasons && data.seasons.length > 0 ? data.seasons : "all"
                }

                if (logger.isDebugEnabled()) {
                    logger.debug(buildDebugLogMessage("Creating secondary request for instance:", { instance: secondaryItem, newRequestPayload }))
                }

                const created = await createMediaRequest(newRequestPayload)
                if (created) {
                    logger.info(`Secondary request created for instance "${secondaryItem}"`)
                }
            } catch (error) {
                logger.warn(`Failed to create secondary request for instance "${secondaryItem}": ${error}`)
            }
        }
    }
}
