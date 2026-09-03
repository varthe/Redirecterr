import logger from "../utils/logger"
import { config } from "../config"
import { approveRequest, applyConfig } from "../api/seerr"
import { buildDebugLogMessage } from "../utils/helpers"
import type { PostData } from "../types"

/**
 * Send request to configured instances
 */
export const sendToInstances = async (instances: string | string[], requestId: string, data: PostData): Promise<void> => {
    const instancesArray = Array.isArray(instances) ? instances : [instances]
    
    for (const item of instancesArray) {
        try {
            let postData = { ...data } as Record<string, any>
            const instance = config.instances[item]
            
            if (!instance) {
                logger.warn(`Instance "${item}" not found in config`)
                continue
            }
            
            // Add instance-specific configuration
            postData.rootFolder = instance.root_folder
            postData.serverId = instance.server_id
            if (instance.quality_profile_id) postData.profileId = instance.quality_profile_id

            if (logger.isDebugEnabled()) {
                logger.debug(buildDebugLogMessage("Sending configuration to instance:", { instance: item, postData }))
            }

            // Apply configuration to the request
            await applyConfig(requestId, postData)
            logger.info(`Configuration applied for request ID ${requestId} on instance "${item}"`)

            // Approve the request if configured to do so
            if (instance.approve ?? true) {
                await approveRequest(requestId)
                logger.info(`Request ID ${requestId} approved for instance "${item}"`)
            }
        } catch (error) {
            logger.warn(`Failed to process request ID ${requestId} for instance "${item}": ${error}`)
        }
    }
}
