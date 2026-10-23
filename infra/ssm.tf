# Seals each participant's Bee CLI session; only Lambda can read it.
resource "random_bytes" "seal_key" {
  length = 32
}

resource "aws_ssm_parameter" "seal_key" {
  name  = "/${var.project}/seal-key"
  type  = "SecureString"
  value = random_bytes.seal_key.base64
}

# Write-only: the API key is sent to SSM but never kept in Terraform state.
resource "aws_ssm_parameter" "claude_api_key" {
  count            = nonsensitive(var.claude_api_key != "") ? 1 : 0
  name             = "/${var.project}/claude-api-key"
  type             = "SecureString"
  value_wo         = var.claude_api_key
  value_wo_version = 1
}
