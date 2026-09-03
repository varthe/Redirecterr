import { config } from "../config"
import logger from "../utils/logger"

// Create headers for Seerr API requests
const headers = {
    "X-Api-Key": config.seerr_api_token,
    accept: "application/json",
    "Content-Type": "application/json",
}

// Cookie jar (e.g. connect.sid, _csrf, XSRF-TOKEN) built from Set-Cookie
// responses. Required alongside the CSRF token to bypass CSRF protection on
// state-changing requests (PUT/POST/DELETE).
let cookieJar: string | null = null

// CSRF token from the XSRF-TOKEN cookie.
let csrfToken: string | null = null

// Whether we have successfully obtained a local session.
let authenticated = false

/**
 * Extract a named cookie value from a raw Set-Cookie/Cookie string.
 */
const parseCookie = (header: string | null | undefined, name: string): string | null => {
    if (!header) return null
    for (const part of header.split(";")) {
        const idx = part.indexOf("=")
        if (idx === -1) continue
        if (part.slice(0, idx).trim() === name) {
            return part.slice(idx + 1).trim()
        }
    }
    return null
}

/**
 * Merge new Set-Cookie headers from a response into the cookie jar, and
 * capture the CSRF token value.
 */
const captureCookies = (response: Response): void => {
    const setCookies = response.headers.getSetCookie
        ? response.headers.getSetCookie()
        : []
    if (setCookies.length === 0) {
        const single = response.headers.get("set-cookie")
        if (single) setCookies.push(single)
    }

    for (const setCookie of setCookies) {
        const name = parseCookie(setCookie, "-") ?? setCookie.split("=")[0]?.trim()
        if (!name) continue
        const value = setCookie.split("=").slice(1).join("=").split(";")[0]?.trim()
        if (value === undefined || value === "") continue

        // Remove any prior value for this cookie from the jar.
        cookieJar = (cookieJar ?? "")
            .split("; ")
            .filter((c) => c.split("=")[0] !== name)
            .join("; ")

        cookieJar = [cookieJar, `${name}=${value}`].filter(Boolean).join("; ")

        // Seerr exposes the readable CSRF token via the XSRF-TOKEN cookie.
        if (name === "XSRF-TOKEN") {
            csrfToken = value
        }
    }
}

/**
 * Authenticate against Seerr's local auth endpoint to obtain a session cookie
 * and CSRF token. Required when CSRF protection is enabled, since
 * API-key-only requests would otherwise be rejected with 403 Forbidden.
 */
const authenticate = async (): Promise<void> => {
    // Start a fresh session: drop any stale auth state so the re-auth path
    // doesn't reuse an expired session cookie or CSRF token.
    authenticated = false
    csrfToken = null

    if (!config.seerr_email || !config.seerr_password) {
        throw new Error(
            "CSRF-secured Seerr requires seerr_email and seerr_password in config.yaml to start a local session"
        )
    }

    // 1. Establish session + CSRF cookies with an initial (safe) GET request.
    const initUrl = new URL("/api/v1/settings/public", config.seerr_url)
    const initRes = await fetch(initUrl, { headers: headers })
    captureCookies(initRes)

    // 2. Log in to obtain a connect.sid session cookie, passing the CSRF token.
    const authUrl = new URL("/api/v1/auth/local", config.seerr_url)
    const authRes = await fetch(authUrl, {
        method: "POST",
        headers: sessionHeaders(),
        body: JSON.stringify({
            email: config.seerr_email,
            password: config.seerr_password,
        }),
    })

    if (!authRes.ok) {
        throw new Error(`authentication failed: ${authRes.status} ${authRes.statusText}`)
    }

    captureCookies(authRes)

    if (!cookieJar || !parseCookie(cookieJar, "connect.sid")) {
        throw new Error("authentication succeeded but no session cookie was returned")
    }

    authenticated = true
    logger.info("Session cookie obtained from Seerr")
}

/**
 * Build headers including the cookie jar and CSRF token.
 */
const sessionHeaders = (): Record<string, string> => {
    const base: Record<string, string> = { ...headers }
    if (cookieJar) {
        base["Cookie"] = cookieJar
    }
    if (csrfToken) {
        base["x-xsrf-token"] = csrfToken
    }
    return base
}

/**
 * Resolve the appropriate headers for a request, authenticating first when a
 * local session has been configured (needed to satisfy CSRF protection).
 */
const resolveHeaders = async (): Promise<Record<string, string>> => {
    if (config.seerr_email && config.seerr_password && !authenticated) {
        await authenticate()
    }
    return authenticated ? sessionHeaders() : headers
}

/**
 * Perform a fetch against Seerr, re-authenticating and retrying once when the
 * stored session/CSRF state is stale (Seerr returns 401 on session expiry and
 * 403 on CSRF failures). Retrying is only attempted when CSRF auth has been
 * configured, since otherwise a retry could never succeed.
 */
const requestSeerr = async (url: URL, init: RequestInit = {}): Promise<Response> => {
    const csrfConfigured = Boolean(config.seerr_email && config.seerr_password)

    const doFetch = async (allowRetry: boolean): Promise<Response> => {
        const response = await fetch(url, {
            ...init,
            headers: { ...(init.headers as Record<string, string> | undefined), ...(await resolveHeaders()) },
        })

        if (csrfConfigured && allowRetry && (response.status === 401 || response.status === 403)) {
            logger.warn(`Re-authenticating with Seerr after ${response.status} response`)
            return doFetch(false)
        }

        return response
    }

    return doFetch(true)
}

/**
 * Fetch data from Seerr API
 */
export const fetchFromSeerr = async (endpoint: string): Promise<any> => {
    const url = new URL(endpoint, config.seerr_url)
    const response = await requestSeerr(url)

    if (!response.ok || response.status !== 200) {
        throw new Error(`could not retrieve data from Seerr: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data
}

/**
 * Approve a request in Seerr
 */
export const approveRequest = async (requestId: string): Promise<void> => {
    try {
        const url = new URL(`/api/v1/request/${requestId}/approve`, config.seerr_url)
        const response = await requestSeerr(url, { method: "POST" })

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`)
        }

        logger.info(`Request ID ${requestId} approved successfully`)
    } catch (error) {
        logger.error(`Error approving request: ${error}`)
    }
}

/**
 * Apply configuration to a request in Seerr
 */
export const applyConfig = async (requestId: string, postData: Record<string, any>): Promise<void> => {
    try {
        const url = new URL(`/api/v1/request/${requestId}`, config.seerr_url)
        const response = await requestSeerr(url, {
            method: "PUT",
            body: JSON.stringify(postData),
        })

        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`)
        }

        logger.info(`Configuration applied to request ID ${requestId}`)
    } catch (error) {
        logger.error(`Error applying configuration: ${error}`)
    }
}
