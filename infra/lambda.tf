locals {
  common_env = {
    DATA_BUCKET          = aws_s3_bucket.data.id
    SEAL_KEY_PARAM       = aws_ssm_parameter.seal_key.name
    CLAUDE_API_KEY_PARAM = one(aws_ssm_parameter.claude_api_key[*].name)
  }
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = toset(["api", "worker"])
  name              = "/aws/lambda/${var.project}-${each.key}"
  retention_in_days = 7
}

# Serves /api/*: Bee login, conversation listing and selection (runs the Bee CLI).
resource "aws_lambda_function" "api" {
  function_name                  = "${var.project}-api"
  role                           = aws_iam_role.api.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  s3_bucket                      = aws_s3_bucket.artifacts.id
  s3_key                         = aws_s3_object.lambda_zip["api"].key
  source_code_hash               = filebase64sha256("${local.dist}/api.zip")
  memory_size                    = 1024
  timeout                        = 29
  reserved_concurrent_executions = var.api_max_concurrency
  environment {
    variables = merge(local.common_env, {
      WORKER_FUNCTION = aws_lambda_function.worker.function_name
      BEE_CLI_BINARY  = "/var/task/bin/bee"
    })
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

# Runs the extract / compare / render pipeline for one job.
resource "aws_lambda_function" "worker" {
  function_name                  = "${var.project}-worker"
  role                           = aws_iam_role.worker.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  s3_bucket                      = aws_s3_bucket.artifacts.id
  s3_key                         = aws_s3_object.lambda_zip["worker"].key
  source_code_hash               = filebase64sha256("${local.dist}/worker.zip")
  memory_size                    = 512
  timeout                        = 300
  reserved_concurrent_executions = var.worker_max_concurrency
  environment {
    variables = local.common_env
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

# Failed async runs already record "failed" in status.json; don't retry them.
resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name          = aws_lambda_function.worker.function_name
  maximum_retry_attempts = 0
}
