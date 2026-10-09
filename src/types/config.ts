export type Condition = string | string[] | ConditionValueObject

export interface ConditionValueObject {
    include?: string | string[]
    exclude?: string | string[]
    require?: string | string[]
}

interface FilterCondition {
    [key: string]: Condition // For dynamic condition keys like "tag", "language" etc.
}

export interface Filter {
    media_type: "movie" | "tv"
    is_4k?: boolean
    conditions?: FilterCondition
    apply: string | string[]
}

interface InstanceConfig {
    server_id: number
    root_folder: string
    quality_profile_id?: number
    approve?: boolean
    is_4k?: boolean
}

export interface Config {
    overseerr_url: string
    overseerr_api_token: string
    approve_on_no_match?: boolean
    instances: {
        [key: string]: InstanceConfig // For dynamic instance names
    }
    filters: Filter[]
}
