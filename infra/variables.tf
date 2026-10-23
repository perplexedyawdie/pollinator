variable "region" {
  type    = string
  default = "us-east-2"
}

variable "project" {
  type    = string
  default = "pollinator"
}

variable "claude_api_key" {
  description = "Claude API key, stored in SSM. Leave empty to use Amazon Bedrock instead."
  type        = string
  default     = ""
  sensitive   = true
}

variable "api_throttle_rate" {
  description = "Steady-state requests per second allowed by API Gateway (cost and abuse guard)."
  type        = number
  default     = 10
}

variable "api_throttle_burst" {
  type    = number
  default = 20
}

# Reserved concurrency needs headroom: AWS keeps at least 10 executions
# unreserved, so new accounts (limit 10) must leave these at -1 (no cap).
variable "api_max_concurrency" {
  description = "Reserved concurrency cap for the API function; -1 for none."
  type        = number
  default     = -1
}

variable "worker_max_concurrency" {
  description = "Reserved concurrency cap for the pipeline worker; -1 for none."
  type        = number
  default     = -1
}
