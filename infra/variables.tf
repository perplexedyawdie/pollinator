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

variable "api_max_concurrency" {
  description = "Reserved concurrency cap for the API function."
  type        = number
  default     = 10
}

variable "worker_max_concurrency" {
  description = "Reserved concurrency cap for the pipeline worker."
  type        = number
  default     = 5
}
